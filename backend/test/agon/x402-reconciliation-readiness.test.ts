import assert from "node:assert/strict";
import test from "node:test";
import { PostgresAgonMarketService } from "../../src/agon/http/service.ts";

const ACTOR = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const INTENT_ID = "00000000-0000-4000-8000-000000000001";
const TX = `0x${"ab".repeat(32)}`;

function receipt(state: string, settlementRef: string | null = null) {
  return { receiptId: "00000000-0000-4000-8000-000000000002", intentId: INTENT_ID, state, settlementRef };
}

function repository(current: ReturnType<typeof receipt>) {
  return {
    getX402CallIntent: async () => ({ intentId: INTENT_ID, actor: ACTOR, listingReference: "arc:0xabc:1" }),
    getX402CallReceipt: async () => current,
  };
}

test("reports a disabled lookup for ambiguous receipts without enabling execution", async () => {
  const service = new PostgresAgonMarketService(repository(receipt("unknown", TX)) as never);
  const result = await service.getX402ReconciliationReadiness(ACTOR, INTENT_ID);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.status, "lookup_disabled");
  assert.equal(result.value.transaction, TX);
  assert.equal(result.value.lookupEnabled, false);
  assert.equal(result.value.executionEnabled, false);
  assert.equal(result.value.nextAction, "enable_receipt_lookup");
});

test("rejects reconciliation mutation while the adapter is disabled", async () => {
  const service = new PostgresAgonMarketService(repository(receipt("settlement_submitted", TX)) as never);
  const result = await service.reconcileX402Receipt(ACTOR, INTENT_ID, { confirmation: "RECONCILE_ARC_TESTNET_X402" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "reconciliation_disabled");
});

test("requires a provider lookup for a submitted receipt and stays read-only", async () => {
  const service = new PostgresAgonMarketService(repository(receipt("settlement_submitted", TX)) as never);
  const result = await service.getX402ReconciliationReadiness(ACTOR, INTENT_ID);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.status, "lookup_disabled");
  assert.equal(result.value.lookupEnabled, false);
  assert.equal(result.value.nextAction, "enable_receipt_lookup");
  assert.equal(result.value.executionEnabled, false);
});

test("reports an enabled read-only lookup without implying settlement or delivery", async () => {
  const service = new PostgresAgonMarketService(repository(receipt("settlement_submitted", TX)) as never, {
    x402ReceiptLookup: { enabled: true, lookup: async () => { throw new Error("not called by readiness"); } },
  });
  const result = await service.getX402ReconciliationReadiness(ACTOR, INTENT_ID);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.lookupEnabled, true);
  assert.equal(result.value.status, "lookup_required");
  assert.equal(result.value.nextAction, "reconcile_receipt");
  assert.equal(result.value.executionEnabled, false);
});

test("reports a missing provider reference separately from a disabled lookup", async () => {
  const service = new PostgresAgonMarketService(repository(receipt("settlement_submitted")) as never, {
    x402ReceiptLookup: { enabled: true, lookup: async () => { throw new Error("not called by readiness"); } },
  });
  const result = await service.getX402ReconciliationReadiness(ACTOR, INTENT_ID);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.lookupEnabled, true);
  assert.equal(result.value.status, "reference_required");
  assert.equal(result.value.nextAction, "record_provider_reference");
});

test("does not expose reconciliation as an action for terminal receipts", async () => {
  const service = new PostgresAgonMarketService(repository(receipt("reconciled", TX)) as never);
  const result = await service.getX402ReconciliationReadiness(ACTOR, INTENT_ID);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.status, "terminal");
  assert.equal(result.value.nextAction, "none");
});

test("uses an explicitly enabled server-side lookup and records matching evidence idempotently", async () => {
  let current = receipt("settlement_submitted", TX) as any;
  current.updatedAt = new Date("2026-08-22T10:00:00.000Z");
  const store = {
    getX402CallIntent: async () => ({ intentId: INTENT_ID, actor: ACTOR, listingReference: "arc:0xabc:1" }),
    getX402CallReceipt: async () => current,
    advanceX402CallReceipt: async (_intentId: string, event: { type: string; settlementRef?: string }) => {
      if (event.type === "settlement_receipt" && event.settlementRef) current = { ...current, settlementRef: event.settlementRef, updatedAt: new Date("2026-08-22T10:01:00.000Z") };
      return current;
    },
  };
  let calls = 0;
  const service = new PostgresAgonMarketService(store as never, {
    x402ReceiptLookup: {
      enabled: true,
      lookup: async (request) => { calls += 1; return { ...request, status: "confirmed" as const, blockNumber: "123" }; },
    },
  });
  const result = await service.reconcileX402Receipt(ACTOR, INTENT_ID, { confirmation: "RECONCILE_ARC_TESTNET_X402" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(calls, 1);
  assert.equal(result.value.status, "confirmed");
  assert.equal(result.value.state, "settlement_submitted");
  assert.equal(result.value.serviceDeliveryPending, true);
  assert.equal(result.value.executionEnabled, false);
});

test("reconciles a Circle provider transfer UUID without pretending it is an on-chain hash", async () => {
  const transferId = "3c90c3cc-0d44-4b50-8888-8dd25736052a";
  let current = receipt("settlement_submitted", null) as any;
  current.providerTransferId = transferId;
  const store = {
    getX402CallIntent: async () => ({ intentId: INTENT_ID, actor: ACTOR, listingReference: "arc:0xabc:1" }),
    getX402CallReceipt: async () => current,
    advanceX402CallReceipt: async (_intentId: string, event: { type: string; providerTransferId?: string }) => {
      if (event.type === "settlement_receipt" && event.providerTransferId) current = { ...current, providerTransferId: event.providerTransferId, updatedAt: new Date("2026-08-22T10:01:00.000Z") };
      return current;
    },
  };
  const service = new PostgresAgonMarketService(store as never, {
    x402ReceiptLookup: {
      enabled: true,
      lookup: async (request) => ({ network: request.network, providerTransferId: request.providerTransferId, transaction: null, status: "confirmed" as const }),
    },
  });
  const result = await service.reconcileX402Receipt(ACTOR, INTENT_ID, { confirmation: "RECONCILE_ARC_TESTNET_X402" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.providerTransferId, transferId);
  assert.equal(result.value.transaction, null);
  assert.equal(result.value.status, "confirmed");
});
