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

test("requires a provider lookup for a submitted receipt and stays read-only", async () => {
  const service = new PostgresAgonMarketService(repository(receipt("settlement_submitted", TX)) as never);
  const result = await service.getX402ReconciliationReadiness(ACTOR, INTENT_ID);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.status, "lookup_required");
  assert.equal(result.value.nextAction, "reconcile_receipt");
  assert.equal(result.value.executionEnabled, false);
});

test("does not expose reconciliation as an action for terminal receipts", async () => {
  const service = new PostgresAgonMarketService(repository(receipt("reconciled", TX)) as never);
  const result = await service.getX402ReconciliationReadiness(ACTOR, INTENT_ID);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.status, "terminal");
  assert.equal(result.value.nextAction, "none");
});
