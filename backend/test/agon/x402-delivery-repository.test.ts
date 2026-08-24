import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PostgresAgonRepository, type X402CallIntentProjection } from "../../src/agon/store/repository.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

let database: AgonTestDatabase;
let repository: PostgresAgonRepository;
const intent: X402CallIntentProjection = {
  intentId: "00000000-0000-4000-8000-000000000031",
  actor: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  idempotencyKey: "delivery-031",
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

before(async () => {
  database = await createAgonTestDatabase("x402delivery");
  repository = new PostgresAgonRepository(database.pool);
  await repository.prepareX402CallIntent(intent);
  await repository.createX402CallReceipt({
    receiptId: "00000000-0000-4000-8000-000000000032",
    intentId: intent.intentId,
    state: "prepared",
    quoteHash: null,
    authorizationHash: null,
    settlementRef: "gateway-settlement-031",
    serviceStatus: null,
    paymentResponseHash: null,
    chargedAmountUSDC: null,
    failureCode: null,
    failureMessage: null,
  });
  await repository.advanceX402CallReceipt(intent.intentId, { type: "approve", approvedAmountUSDC: "0.01" });
  await repository.advanceX402CallReceipt(intent.intentId, { type: "payment_required", quoteHash: `0x${"22".repeat(32)}`, quoteSnapshot: { x402Version: 2, accepts: [] } });
  await repository.advanceX402CallReceipt(intent.intentId, { type: "authorization_ready", authorizationPayloadHash: `0x${"33".repeat(32)}`, authorizationPayload: { x402Version: 2 } });
  await repository.advanceX402CallReceipt(intent.intentId, { type: "authorization_submitted", authorizationHash: `0x${"44".repeat(32)}` });
  await repository.advanceX402CallReceipt(intent.intentId, { type: "settlement_submitted", settlementRef: "gateway-settlement-031" });
});

after(async () => {
  if (database) await database.close();
});

test("records provider delivery evidence atomically and replays the same evidence", async () => {
  const input = {
    deliveryId: "00000000-0000-4000-8000-000000000033",
    intentId: intent.intentId,
    receiptId: "00000000-0000-4000-8000-000000000032",
    provider: "0x3333333333333333333333333333333333333333",
    listingReference: intent.listingReference,
    serviceStatus: 200,
    latencyMs: 91,
    responseHash: `0x${"55".repeat(32)}`,
    resultAttestationHash: `0x${"66".repeat(32)}`,
    chargedAmountUSDC: "0.01",
    deliveredAt: new Date("2026-08-24T08:00:00.000Z"),
  };
  const first = await repository.recordX402DeliveryEvidence(input);
  const retry = await repository.recordX402DeliveryEvidence(input);
  assert.equal(first.evidenceHash, retry.evidenceHash);
  assert.equal((await repository.getX402CallReceipt(intent.intentId))?.state, "service_delivered");
  assert.equal((await repository.getLatestX402DeliveryEvidence(intent.intentId))?.latencyMs, 91);
  await assert.rejects(
    () => repository.recordX402DeliveryEvidence({ ...input, deliveryId: "00000000-0000-4000-8000-000000000034", latencyMs: 92 }),
    /cannot move receipt from service_delivered/,
  );
});
