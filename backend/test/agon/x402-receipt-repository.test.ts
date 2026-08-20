import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { PostgresAgonRepository, type X402CallIntentProjection, type X402CallReceiptProjection } from "../../src/agon/store/repository.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

let database: AgonTestDatabase;
let repository: PostgresAgonRepository;

before(async () => {
  database = await createAgonTestDatabase("x402receipts");
  repository = new PostgresAgonRepository(database.pool);
});

after(async () => {
  if (database) await database.close();
});

const intent: X402CallIntentProjection = {
  intentId: "00000000-0000-4000-8000-000000000011",
  actor: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  idempotencyKey: "receipt-001",
  listingReference: "5042002:0x3333333333333333333333333333333333333333:1",
  chainId: 5042002n,
  serviceRegistry: "0x3333333333333333333333333333333333333333",
  listingId: 1n,
  agentId: 42n,
  version: 1n,
  method: "POST",
  input: { query: "arc" },
  inputHash: `0x${"11".repeat(32)}`,
  maxAmountUSDC: "0.01",
  state: "prepared",
};

function receipt(overrides: Partial<X402CallReceiptProjection> = {}): X402CallReceiptProjection {
  return {
    receiptId: "00000000-0000-4000-8000-000000000012",
    intentId: intent.intentId,
    state: "prepared",
    quoteHash: null,
    authorizationHash: null,
    settlementRef: null,
    serviceStatus: null,
    paymentResponseHash: null,
    chargedAmountUSDC: null,
    failureCode: null,
    failureMessage: null,
    ...overrides,
  };
}

test("creates one receipt per intent and reuses it on retry", async () => {
  await repository.prepareX402CallIntent(intent);
  const first = await repository.createX402CallReceipt(receipt());
  const retry = await repository.createX402CallReceipt(receipt({ receiptId: "00000000-0000-4000-8000-000000000013" }));
  assert.equal(retry.receiptId, first.receiptId);
  assert.equal(retry.state, "prepared");
  const rows = await database.pool.query("select count(*)::int as count from agon_x402_call_receipts");
  assert.equal(rows.rows[0]?.count, 1);
});

test("approves the receipt atomically and reuses the same approval on retry", async () => {
  const first = await repository.approveX402CallReceipt(intent.intentId, "0.01");
  const retry = await repository.approveX402CallReceipt(intent.intentId, "0.01");
  assert.equal(first.receiptId, retry.receiptId);
  assert.equal(first.state, "approved");
  assert.equal(retry.approvedAmountUSDC, "0.01");
  await assert.rejects(
    () => repository.approveX402CallReceipt(intent.intentId, "0.009"),
    /different spend limit/,
  );
});

test("persists evidence through the lifecycle and retains opaque settlement refs", async () => {
  const quoteHash = `0x${"22".repeat(32)}`;
  const authHash = `0x${"33".repeat(32)}`;
  const responseHash = `0x${"44".repeat(32)}`;
  let current = await repository.advanceX402CallReceipt(intent.intentId, { type: "payment_required", quoteHash, quoteSnapshot: { x402Version: 2, accepts: [] } });
  current = await repository.advanceX402CallReceipt(current.intentId, { type: "authorization_submitted", authorizationHash: authHash });
  current = await repository.advanceX402CallReceipt(current.intentId, { type: "settlement_submitted", settlementRef: "gateway-settlement-001" });
  assert.equal(current.settlementRef, "gateway-settlement-001");
  current = await repository.advanceX402CallReceipt(current.intentId, { type: "service_delivered", serviceStatus: 200, paymentResponseHash: responseHash });
  current = await repository.advanceX402CallReceipt(current.intentId, { type: "reconcile" });
  assert.equal(current.state, "reconciled");
  assert.equal(current.quoteHash, quoteHash);
  assert.equal(current.authorizationHash, authHash);
  assert.equal(current.paymentResponseHash, responseHash);
});
