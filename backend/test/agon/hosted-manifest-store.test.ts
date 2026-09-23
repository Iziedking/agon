import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";

import { createPostgresHostedManifestStore, HostedManifestError } from "../../src/agon/hosted-manifest-store.ts";
import { createAgonRoutes, type AgonMarketService, type AgonRouteVariables } from "../../src/agon/http/routes.ts";
import { createMcpAccessAdapter } from "../../src/agon/mcp/adapter.ts";
import { createMemoryProviderDraftStore } from "../../src/agon/mcp/provider-draft-store.ts";
import { compileProviderManifest } from "../../src/agon/mcp/provider-manifest.ts";
import { createAgonTestDatabase } from "./database-test-helper.ts";

const owner = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const draft = {
  name: "CRM helper",
  logoUrl: "https://provider.example/logo.png",
  outcome: "Enrich a bounded CRM list",
  category: "3",
  inputs: ["records"],
  outputs: ["enriched records"],
  priceUSDC: "0.04",
  expectedLatencyMs: 90_000,
  privacy: "Deletes input after delivery",
  failurePolicy: "Retry delivery without another charge when safe",
  endpoint: "https://provider.example/execute",
};

test("AGON hosts immutable version-specific files and reads exact canonical bytes after restart", async () => {
  const database = await createAgonTestDatabase("hosted_manifest");
  try {
    const options = { publicApiUrl: "https://api.agon.example", isAgentOwner: async (actor: string, agentId: string) => actor === owner && agentId === "42" };
    const store = createPostgresHostedManifestStore(database.pool, options);
    const first = compileProviderManifest(draft, { agentId: "42" });
    const file = await store.put(owner, first.body, first.manifestHash);
    assert.equal(file.manifestHash, first.manifestHash);
    assert.equal(file.uri, `https://api.agon.example/agon/manifests/42/${first.serviceKey}/1/${first.manifestHash}.json`);
    assert.equal((await store.put(owner, first.body, first.manifestHash)).uri, file.uri);
    await assert.rejects(store.put(other, first.body), (error: unknown) => error instanceof HostedManifestError && error.code === "manifest_owner_mismatch");
    await assert.rejects(store.put(owner, first.body, `0x${"a".repeat(64)}`), (error: unknown) => error instanceof HostedManifestError && error.code === "manifest_hash_mismatch");

    const revised = compileProviderManifest({ ...draft, outcome: "A new reviewed outcome" }, { agentId: "42" });
    const revisedFile = await store.put(owner, revised.body, revised.manifestHash);
    assert.notEqual(revisedFile.uri, file.uri);
    const secondVersion = compileProviderManifest(draft, { agentId: "42", serviceKey: first.serviceKey, version: "2" });
    assert.notEqual((await store.put(owner, secondVersion.body)).uri, file.uri);

    const reopened = createPostgresHostedManifestStore(database.pool, options);
    assert.equal((await reopened.inspect(file.uri)).manifestHash, first.manifestHash);
    assert.equal((await reopened.get("42", first.serviceKey, "1", first.manifestHash))?.canonicalJson, file.canonicalJson);
    assert.equal((await reopened.get("42", first.serviceKey, "1", revised.manifestHash))?.uri, revisedFile.uri);

    await database.pool.query(`update agon_hosted_manifests set canonical_json = '{}' where manifest_hash = $1`, [first.manifestHash]);
    await assert.rejects(reopened.get("42", first.serviceKey, "1", first.manifestHash), (error: unknown) => error instanceof HostedManifestError && error.code === "manifest_corrupt");
  } finally {
    await database.close();
  }
});

test("public service-file route caches immutable bytes and MCP compile hosts without a self-fetch", async () => {
  const database = await createAgonTestDatabase("hosted_route");
  try {
    const hostedManifestStore = createPostgresHostedManifestStore(database.pool, {
      publicApiUrl: "https://api.agon.example",
      isAgentOwner: async (actor, agentId) => actor === owner && agentId === "42",
    });
    const service = {
      async listListings() { return { ok: true, value: { items: [], nextCursor: null } }; },
      async getListing() { return { ok: false, error: { code: "not_found", message: "unused" } }; },
      async prepareX402Call() { return { ok: false, error: { code: "unused", message: "unused" } }; },
    } as AgonMarketService;
    const adapter = createMcpAccessAdapter(service, { providerDraftStore: createMemoryProviderDraftStore(), hostedManifestStore });
    const started = await adapter.startListing(owner, draft);
    assert.equal(started.ok, true);
    if (!started.ok) return;
    const compiled = await adapter.compileListing(owner, { draftId: started.value.draftId, agentId: "42" });
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;
    assert.ok(compiled.value.manifestUri?.startsWith("https://api.agon.example/agon/manifests/42/"));
    const inspected = await hostedManifestStore.inspect(compiled.value.manifestUri!);
    assert.equal(inspected.manifestHash, compiled.value.manifestHash);

    const app = new Hono<{ Variables: AgonRouteVariables }>();
    app.route("/agon", createAgonRoutes({
      service,
      verifyMcpToken: async () => null,
      requireAuth: async (context, next) => { context.set("address", context.req.header("x-actor") ?? owner); await next(); },
      hostedManifestStore,
    }));
    const path = new URL(compiled.value.manifestUri!).pathname;
    const response = await app.request(path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.equal(response.headers.get("etag"), `"${compiled.value.manifestHash}"`);
    assert.equal(await response.text(), (await hostedManifestStore.get("42", compiled.value.serviceKey, "1", compiled.value.manifestHash))?.canonicalJson);
    const cached = await app.request(path, { headers: { "if-none-match": `"${compiled.value.manifestHash}"` } });
    assert.equal(cached.status, 304);
    const upload = await app.request("/agon/manifests", { method: "POST", headers: { "content-type": "application/json", "x-actor": owner }, body: JSON.stringify({ manifest: compiled.value.body, expectedHash: compiled.value.manifestHash }) });
    assert.equal(upload.status, 201);
    assert.equal((await upload.json()).manifestUri, compiled.value.manifestUri);
    const denied = await app.request("/agon/manifests", { method: "POST", headers: { "content-type": "application/json", "x-actor": other }, body: JSON.stringify({ manifest: compiled.value.body, expectedHash: compiled.value.manifestHash }) });
    assert.equal(denied.status, 403);
  } finally {
    await database.close();
  }
});
