import test from "node:test";
import assert from "node:assert/strict";
import { createMcpAccessAdapter } from "../../src/agon/mcp/adapter.ts";

const listing = {
  id: "5042002:0x1111111111111111111111111111111111111111:3",
  chainId: "5042002", serviceRegistry: "0x1111111111111111111111111111111111111111", listingId: "3", agentId: "42", serviceKey: `0x${"a".repeat(64)}`, category: "3", version: "1",
  manifest: { hash: `0x${"b".repeat(64)}`, uri: "https://provider.example/manifest.json", body: { service: { name: "CRM helper", description: "Enrich a bounded CRM list", tags: ["crm"] }, invocation: { endpoint: "https://provider.example/execute", timeoutMs: 30_000, privacy: { description: "Deletes input after delivery" } }, pricing: { amountUSDC: "0.04" } } },
  providerSnapshot: `0x${"c".repeat(64)}`, status: "Listed", verification: { status: "Verified", scope: { agentId: "42", listingId: "3", version: "1", category: "3" } }, risk: { unverified: false, warning: null, quarantineReason: null }, endpointQa: { status: "passed", checkedAt: new Date().toISOString(), endpointStatus: 200, evidenceHash: `0x${"d".repeat(64)}`, reason: "ok", attempts: 1, passedAttempts: 1, successRate: 100, endpointUrl: "https://provider.example/execute" }, payment: { rail: "X402", directX402: true, escrowEligible: false }, provenance: { sourceBlockNumber: "1", sourceTxHash: `0x${"e".repeat(64)}`, sourceLogIndex: 1 },
} as const;

test("MCP search returns plain service terms and filters by price", async () => {
  const adapter = createMcpAccessAdapter({
    async listListings() { return { ok: true, value: { items: [listing], nextCursor: null } }; },
    async getListing() { return { ok: true, value: listing }; },
    async prepareX402Call() { return { ok: true, value: { intentId: "intent-1", actor: "0x1", idempotencyKey: "mcp-test-001", listingReference: listing.id, listingVersion: "1", inputHash: `0x${"1".repeat(64)}`, maxAmountUSDC: "0.04", state: "prepared", executionEnabled: false, nextAction: "execution_adapter_not_enabled" } }; },
  });
  const found = await adapter.searchServices({ query: "CRM", maxPriceUSDC: "0.05" });
  assert.equal(found.ok, true);
  if (found.ok) assert.equal(found.value.services[0]?.name, "CRM helper");
});

test("MCP preview binds terms to the provider price and input", async () => {
  const adapter = createMcpAccessAdapter({
    async listListings() { return { ok: true, value: { items: [], nextCursor: null } }; },
    async getListing() { return { ok: true, value: listing }; },
    async prepareX402Call(_actor, _reference, request) { return { ok: true, value: { intentId: "intent-1", actor: "buyer", idempotencyKey: request.idempotencyKey, listingReference: listing.id, listingVersion: "1", inputHash: `0x${"1".repeat(64)}`, maxAmountUSDC: request.maxAmountUSDC, state: "prepared", executionEnabled: false, nextAction: "execution_adapter_not_enabled" } }; },
  });
  const preview = await adapter.previewHire("buyer", { serviceReference: listing.id, input: { records: [] } });
  assert.equal(preview.ok, true);
  if (preview.ok) {
    assert.equal(preview.value.terms.priceUSDC, "0.04");
    assert.equal(preview.value.terms.service.name, "CRM helper");
  }
});

test("MCP authorization and work status stay task-oriented", async () => {
  const adapter = createMcpAccessAdapter({
    async listListings() { return { ok: true, value: { items: [], nextCursor: null } }; },
    async getListing() { return { ok: true, value: listing }; },
    async prepareX402Call() { return { ok: true, value: { intentId: "intent-1", actor: "buyer", idempotencyKey: "mcp-test-001", listingReference: listing.id, listingVersion: "1", inputHash: `0x${"1".repeat(64)}`, maxAmountUSDC: "0.04", state: "prepared", executionEnabled: false, nextAction: "execution_adapter_not_enabled" } }; },
    async approveX402Call() { return { ok: true, value: { state: "approved" } }; },
    async getX402SettlementReadiness() { return { ok: true, value: { receiptId: "receipt-1", intentId: "intent-1", state: "service_delivery_pending", network: "eip155:5042002", settlementRef: null, providerTransferId: null, status: "service_delivery_pending", reason: "provider delivery pending", executionEnabled: false, nextAction: "deliver_service", checkedAt: new Date().toISOString() } }; },
  });
  const preview = await adapter.previewHire("buyer", { serviceReference: listing.id, input: { records: [] } });
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  const approved = await adapter.authorizeHire("buyer", "intent-1", { termsDigest: preview.value.terms.termsDigest, approval: "approve", idempotencyKey: "hire-test-001" });
  assert.equal(approved.ok, true);
  const work = await adapter.getWork("buyer", "intent-1");
  assert.equal(work.ok, true);
  if (work.ok) assert.equal(work.value.status, "working");
});

test("MCP provider draft returns a stable draft and pre-publication checks", async () => {
  const adapter = createMcpAccessAdapter({
    async listListings() { return { ok: true, value: { items: [], nextCursor: null } }; },
    async getListing() { return { ok: false, error: { code: "not_found", message: "unused" } }; },
    async prepareX402Call() { return { ok: false, error: { code: "unused", message: "unused" } }; },
  });
  const draft = { name: "CRM helper", outcome: "Enrich a bounded CRM list", category: "crm", inputs: ["records"], outputs: ["enriched records"], priceUSDC: "0.04", expectedLatencyMs: 90_000, privacy: "Deletes input after delivery", failurePolicy: "Retry delivery without another charge when safe", endpoint: "https://provider.example/execute" };
  const checked = adapter.checkListing(draft);
  assert.equal(checked.ok, true);
  if (checked.ok) {
    assert.match(checked.value.draftId, /^draft-/);
    assert.equal(checked.value.checks[0]?.status, "passed");
    assert.equal(checked.value.nextAction, "review_and_approve_publication");
    const rechecked = adapter.checkListing({ draftId: checked.value.draftId });
    assert.equal(rechecked.ok, true);
    const published = await adapter.publishListing("provider", { draftId: checked.value.draftId, approval: "approve" });
    assert.equal(published.ok, true);
    if (published.ok) assert.equal(published.value.nextAction, "connect_provider_wallet");
    const paused = await adapter.pauseListing("provider", { reference: listing.id, approval: "approve" });
    assert.equal(paused.ok, true);
    if (paused.ok) assert.equal(paused.value.nextAction, "operator_pause_required");
    const compiled = adapter.compileListing({ draftId: checked.value.draftId, agentId: "42" });
    assert.equal(compiled.ok, true);
    if (compiled.ok) {
      assert.equal(compiled.value.body.identity.agentId, "42");
      assert.match(compiled.value.manifestHash, /^0x[0-9a-f]{64}$/);
    }
  }
});
