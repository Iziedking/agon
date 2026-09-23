import test from "node:test";
import assert from "node:assert/strict";
import { createMcpAccessAdapter } from "../../src/agon/mcp/adapter.ts";
import { createMemoryProviderDraftStore } from "../../src/agon/mcp/provider-draft-store.ts";
import { compileProviderManifest, verifyHostedProviderManifest } from "../../src/agon/mcp/provider-manifest.ts";
import { validateManifest } from "../../src/agon/core/manifest.ts";

const actor = "0x1111111111111111111111111111111111111111";
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

test("provider draft persistence is actor scoped", async () => {
  const store = createMemoryProviderDraftStore();
  await store.create(actor, "draft-1", draft);
  assert.equal((await store.get(actor, "draft-1"))?.draft.name, "CRM helper");
  assert.equal(await store.get(other, "draft-1"), null);
});

test("MCP publication prepares an exact listing write after manifest compilation", async () => {
  const calls: unknown[] = [];
  const adapter = createMcpAccessAdapter({
    async listListings() { return { ok: true, value: { items: [], nextCursor: null } }; },
    async getListing() { return { ok: false, error: { code: "not_found", message: "unused" } }; },
    async getProviderListingForVersion() {
      return { ok: true, value: { agentId: "42", providerSnapshot: actor, serviceKey: `0x${"a".repeat(64)}`, version: "1" } as any };
    },
    async prepareX402Call() { return { ok: false, error: { code: "unused", message: "unused" } }; },
    async publishProviderDraft(_actor, input, compiled, manifestUri) {
      calls.push({ input, compiled, manifestUri });
      return { ok: true, value: { operationId: "op-1", state: "prepared", transaction: { chainId: "5042002", to: `0x${"1".repeat(40)}` as `0x${string}`, data: "0x1234" as const, functionName: "publish" as const, args: [] }, txHash: null, resultReference: null, proof: null } };
    },
    async publishProviderDraftVersion(_actor, _input, compiled, _manifestUri, listingId) {
      calls.push({ listingId, compiled });
      return { ok: true, value: { operationId: "op-version", state: "prepared", transaction: { chainId: "5042002", to: `0x${"1".repeat(40)}` as `0x${string}`, data: "0x5678" as const, functionName: "publishVersion" as const, args: [listingId] }, txHash: null, resultReference: null, proof: null } };
    },
    async confirmOperation(_actor, operationId, txHash) {
      return {
        ok: true,
        value: {
          operationId,
          state: "confirmed",
          transaction: { chainId: "5042002", to: `0x${"1".repeat(40)}`, data: "0x", functionName: "publish", args: [] },
          txHash,
          resultReference: "5042002:registry:7",
          proof: { blockNumber: "10", logIndex: 0 },
        },
      };
    },
  }, { providerDraftStore: createMemoryProviderDraftStore() });
  const started = await adapter.startListing(actor, draft);
  assert.equal(started.ok, true);
  if (!started.ok) return;
  const compiled = await adapter.compileListing(actor, { draftId: started.value.draftId, agentId: "42", manifestUri: "https://provider.example/manifest.json" });
  assert.equal(compiled.ok, true);
  const published = await adapter.publishListing(actor, { draftId: started.value.draftId, approval: "approve" });
  assert.equal(published.ok, true);
  if (published.ok) {
    assert.equal(published.value.status, "prepared");
    assert.equal(published.value.operationId, "op-1");
    assert.equal(published.value.transaction?.data, "0x1234");
  }
  const confirmed = await adapter.confirmListing(actor, { draftId: started.value.draftId, operationId: "op-1", txHash: `0x${"a".repeat(64)}` });
  assert.equal(confirmed.ok, true);
  if (confirmed.ok) {
    assert.equal(confirmed.value.status, "published");
    assert.deepEqual(confirmed.value.evidence, { txHash: `0x${"a".repeat(64)}`, blockNumber: "10", logIndex: 0 });
  }
  const confirmedAgain = await adapter.confirmListing(actor, { draftId: started.value.draftId, operationId: "op-1", txHash: `0x${"a".repeat(64)}` });
  assert.equal(confirmedAgain.ok, true);
  if (confirmedAgain.ok) assert.deepEqual(confirmedAgain.value.evidence, { txHash: `0x${"a".repeat(64)}`, blockNumber: "10", logIndex: 0 });
  const wrongReceipt = await adapter.confirmListing(actor, { draftId: started.value.draftId, operationId: "op-1", txHash: `0x${"b".repeat(64)}` });
  assert.deepEqual(wrongReceipt, { ok: false, code: "operation_mismatch", message: "The transaction hash does not match the confirmed publication." });
  const status = await adapter.getListingPublication(actor, started.value.draftId);
  assert.equal(status.ok, true);
  if (status.ok) assert.equal(status.value.nextAction, "wait_for_listing_checks");
  if (status.ok) assert.deepEqual(status.value.evidence, { txHash: `0x${"a".repeat(64)}`, blockNumber: "10", logIndex: 0 });
  assert.equal(calls.length, 1);

  const versionStarted = await adapter.startListing(actor, { ...draft, name: "CRM helper v2" });
  assert.equal(versionStarted.ok, true);
  if (versionStarted.ok) {
    const versionCompiled = await adapter.compileListing(actor, { draftId: versionStarted.value.draftId, agentId: "42", listingId: "7", manifestUri: "https://provider.example/manifest-v2.json" });
    assert.equal(versionCompiled.ok, true);
    if (versionCompiled.ok) {
      assert.equal(versionCompiled.value.body.service.version, "2");
      assert.equal(versionCompiled.value.serviceKey, `0x${"a".repeat(64)}`);
    }
    const versionPrepared = await adapter.publishListingVersion(actor, { draftId: versionStarted.value.draftId, approval: "approve" });
    assert.equal(versionPrepared.ok, true);
    if (versionPrepared.ok) {
      assert.equal(versionPrepared.value.operationId, "op-version");
      assert.equal(versionPrepared.value.transaction?.data, "0x5678");
    }
  }
});

test("hosted publication file must validate and match the compiled hash", async () => {
  const compiled = compileProviderManifest(draft, { agentId: "42" });
  const inspected = {
    uri: "https://provider.example/version-1.json",
    manifestHash: compiled.manifestHash,
    body: compiled.body,
    contentType: "application/json",
    byteLength: 100,
    validation: validateManifest(compiled.body),
  };
  await verifyHostedProviderManifest(inspected.uri, compiled, async () => inspected);
  await assert.rejects(
    verifyHostedProviderManifest(inspected.uri, compiled, async () => ({ ...inspected, manifestHash: `0x${"b".repeat(64)}` as `0x${string}` })),
    /differs from the reviewed version/,
  );
  await assert.rejects(
    verifyHostedProviderManifest(inspected.uri, compiled, async () => ({ ...inspected, validation: validateManifest({}) })),
    /hosted service file is invalid/,
  );
});

test("MCP pause exposes signing data and only confirms the matching listing receipt", async () => {
  const reference = `5042002:0x${"1".repeat(40)}:7`;
  const txHash = `0x${"a".repeat(64)}` as `0x${string}`;
  const transaction = { chainId: "5042002", to: `0x${"1".repeat(40)}` as `0x${string}`, data: "0xabcd" as const, functionName: "setStatus" as const, args: ["7", "1"] };
  const adapter = createMcpAccessAdapter({
    async listListings() { return { ok: true, value: { items: [], nextCursor: null } }; },
    async getListing() { return { ok: false, error: { code: "not_found", message: "unused" } }; },
    async prepareX402Call() { return { ok: false, error: { code: "unused", message: "unused" } }; },
    async pauseProviderListing() { return { ok: true, value: { operationId: "op-pause", state: "prepared", transaction, txHash: null, resultReference: null, proof: null } }; },
    async confirmOperation() { return { ok: true, value: { operationId: "op-pause", state: "confirmed", transaction, txHash, resultReference: reference, proof: { blockNumber: "11", logIndex: 2 } } }; },
  });
  const prepared = await adapter.pauseListing(actor, { reference, approval: "approve" });
  assert.equal(prepared.ok, true);
  if (prepared.ok) assert.deepEqual(prepared.value.transaction, transaction);
  const wrong = await adapter.confirmPause(actor, { reference: `5042002:0x${"1".repeat(40)}:8`, operationId: "op-pause", txHash });
  assert.deepEqual(wrong, { ok: false, code: "operation_mismatch", message: "The receipt does not match the requested listing pause." });
  const confirmed = await adapter.confirmPause(actor, { reference, operationId: "op-pause", txHash });
  assert.equal(confirmed.ok, true);
  if (confirmed.ok) {
    assert.equal(confirmed.value.status, "paused");
    assert.deepEqual(confirmed.value.evidence, { txHash, blockNumber: "11", logIndex: 2 });
  }
});
