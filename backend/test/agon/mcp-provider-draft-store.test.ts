import test from "node:test";
import assert from "node:assert/strict";
import { createMcpAccessAdapter } from "../../src/agon/mcp/adapter.ts";
import { createMemoryProviderDraftStore } from "../../src/agon/mcp/provider-draft-store.ts";

const actor = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const draft = {
  name: "CRM helper",
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
    async prepareX402Call() { return { ok: false, error: { code: "unused", message: "unused" } }; },
    async publishProviderDraft(_actor, input, compiled, manifestUri) {
      calls.push({ input, compiled, manifestUri });
      return { ok: true, value: { operationId: "op-1", reference: "prepared-reference" } };
    },
    async publishProviderDraftVersion(_actor, _input, _compiled, _manifestUri, listingId) {
      calls.push({ listingId });
      return { ok: true, value: { operationId: "op-version", reference: `version:${listingId}` } };
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
  }
  const confirmed = await adapter.confirmListing(actor, { draftId: started.value.draftId, operationId: "op-1", txHash: `0x${"a".repeat(64)}` });
  assert.equal(confirmed.ok, true);
  if (confirmed.ok) assert.equal(confirmed.value.status, "published");
  const status = await adapter.getListingPublication(actor, started.value.draftId);
  assert.equal(status.ok, true);
  if (status.ok) assert.equal(status.value.nextAction, "wait_for_listing_checks");
  assert.equal(calls.length, 1);

  const versionStarted = await adapter.startListing(actor, { ...draft, name: "CRM helper v2" });
  assert.equal(versionStarted.ok, true);
  if (versionStarted.ok) {
    const versionCompiled = await adapter.compileListing(actor, { draftId: versionStarted.value.draftId, agentId: "42", listingId: "7", manifestUri: "https://provider.example/manifest-v2.json" });
    assert.equal(versionCompiled.ok, true);
    const versionPrepared = await adapter.publishListingVersion(actor, { draftId: versionStarted.value.draftId, approval: "approve" });
    assert.equal(versionPrepared.ok, true);
    if (versionPrepared.ok) assert.equal(versionPrepared.value.operationId, "op-version");
  }
});
