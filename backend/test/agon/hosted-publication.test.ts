import test from "node:test";
import assert from "node:assert/strict";

import { canonicalManifestHash, validateManifest } from "../../src/agon/core/manifest.ts";
import { PostgresAgonMarketService, type AgonWriteAdapter } from "../../src/agon/http/service.ts";
import type { AgonListingView } from "../../src/agon/http/api-types.ts";
import { compileProviderManifest } from "../../src/agon/mcp/provider-manifest.ts";
import type { PostgresAgonRepository } from "../../src/agon/store/repository.ts";

const actor = "0x1111111111111111111111111111111111111111";
const registry = "0x2222222222222222222222222222222222222222" as const;
const manifestUri = "https://provider.example/service-v1.json";
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

function makeService(body: unknown) {
  let writes = 0;
  const writer = {
    publishListing: async () => { writes += 1; return { ok: true, value: { operationId: "listing-op" } }; },
    publishListingVersion: async () => { writes += 1; return { ok: true, value: { operationId: "version-op" } }; },
  } as unknown as AgonWriteAdapter;
  const service = new PostgresAgonMarketService({} as PostgresAgonRepository, {
    writer,
    activeServiceRegistryAddress: registry,
    inspectProviderManifest: async (uri) => ({
      uri,
      manifestHash: canonicalManifestHash(body),
      body,
      contentType: "application/json",
      byteLength: 100,
      validation: validateManifest(body),
    }),
  });
  return { service, writes: () => writes };
}

test("generic listing publication anchors only its hosted first version", async () => {
  const compiled = compileProviderManifest(draft, { agentId: "42" });
  const { service, writes } = makeService(compiled.body);
  const request = {
    chainId: "5042002", agentId: "42", serviceKey: compiled.serviceKey,
    manifestHash: compiled.manifestHash, manifestUri, category: "3", paymentRail: "X402" as const,
  };
  assert.equal((await service.publishListing(actor, request)).ok, true);
  assert.equal(writes(), 1);
  assert.equal((await service.publishListing(actor, { ...request, manifestHash: `0x${"a".repeat(64)}` })).ok, false);
  assert.equal((await service.publishListing(actor, { ...request, agentId: "43" })).ok, false);
  assert.equal(writes(), 1);

  const nextVersion = compileProviderManifest(draft, { agentId: "42", serviceKey: compiled.serviceKey, version: "2" });
  const versionService = makeService(nextVersion.body);
  assert.equal((await versionService.service.publishListing(actor, { ...request, manifestHash: nextVersion.manifestHash })).ok, false);
  assert.equal(versionService.writes(), 0);
});

test("generic version publication checks current owner, identity, and next version", async () => {
  const first = compileProviderManifest(draft, { agentId: "42" });
  const second = compileProviderManifest(draft, { agentId: "42", serviceKey: first.serviceKey, version: "2" });
  const current = {
    providerSnapshot: actor, agentId: "42", serviceKey: first.serviceKey, version: "1",
  } as AgonListingView;
  const prepared = makeService(second.body);
  prepared.service.getProviderListingForVersion = async () => ({ ok: true, value: current });
  const request = {
    chainId: "5042002", listingId: "7", manifestHash: second.manifestHash,
    manifestUri: "https://provider.example/service-v2.json", paymentRail: "X402" as const,
  };
  assert.equal((await prepared.service.publishListingVersion(actor, request)).ok, true);
  assert.equal((await prepared.service.publishListingVersion("0x3333333333333333333333333333333333333333", request)).ok, false);
  assert.equal(prepared.writes(), 1);

  const stale = makeService(first.body);
  stale.service.getProviderListingForVersion = async () => ({ ok: true, value: current });
  assert.equal((await stale.service.publishListingVersion(actor, { ...request, manifestHash: first.manifestHash })).ok, false);
  assert.equal(stale.writes(), 0);
});
