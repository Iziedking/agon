import assert from "node:assert/strict";
import test from "node:test";

import { PostgresAgonMarketService } from "../../src/agon/http/service.ts";
import type { StoredX402CallIntent, StoredX402CallReceipt } from "../../src/agon/store/repository.ts";

const ACTOR = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TARGET = "https://provider.example/x402";
const ASSET = `0x${"11".repeat(20)}` as `0x${string}`;
const PAY_TO = `0x${"22".repeat(20)}` as `0x${string}`;

function quoteHeader() {
  return Buffer.from(JSON.stringify({
    x402Version: 2,
    resource: { url: TARGET, description: "test", mimeType: "application/json" },
    accepts: [{ scheme: "exact", network: "eip155:5042002", asset: ASSET, amount: "0.001", maxTimeoutSeconds: 600, payTo: PAY_TO, extra: { name: "GatewayWalletBatched", version: "1" } }],
  })).toString("base64");
}

function intent(): StoredX402CallIntent {
  return {
    intentId: "00000000-0000-4000-8000-000000000001", actor: ACTOR, idempotencyKey: "quote-test-001",
    listingReference: "5042002:0x3333333333333333333333333333333333333333:1", chainId: 5042002n,
    serviceRegistry: `0x${"33".repeat(20)}`, listingId: 1n, agentId: 42n, version: 1n,
    method: "POST", input: { prompt: "test" }, inputHash: `0x${"44".repeat(32)}`,
    maxAmountUSDC: "0.01", targetUrl: TARGET, state: "prepared", createdAt: new Date("2026-08-20T10:00:00Z"), updatedAt: new Date("2026-08-20T10:00:00Z"),
  };
}

function repositoryStub() {
  let current: StoredX402CallReceipt = {
    receiptId: "00000000-0000-4000-8000-000000000002", intentId: intent().intentId, state: "approved", approvedAmountUSDC: "0.01",
    quoteHash: null, quoteSnapshot: null, authorizationHash: null, settlementRef: null, serviceStatus: null, paymentResponseHash: null, chargedAmountUSDC: null, failureCode: null, failureMessage: null,
    createdAt: new Date("2026-08-20T10:01:00Z"), updatedAt: new Date("2026-08-20T10:01:00Z"),
  };
  return {
    getX402CallIntent: async () => intent(),
    getX402CallReceipt: async () => current,
    advanceX402CallReceipt: async (_id: string, event: { quoteHash: string; quoteSnapshot: unknown }) => {
      current = { ...current, state: "payment_required", quoteHash: event.quoteHash, quoteSnapshot: event.quoteSnapshot, updatedAt: new Date("2026-08-20T10:02:00Z") };
      return current;
    },
  };
}

test("captures one exact 402 quote and returns the durable snapshot on retry", async () => {
  const repository = repositoryStub();
  let calls = 0;
  const service = new PostgresAgonMarketService(repository as never, {
    fetchImpl: async () => { calls += 1; return new Response("", { status: 402, headers: { "PAYMENT-REQUIRED": quoteHeader() } }); },
  });
  const first = await service.captureX402Quote(ACTOR, intent().intentId);
  const second = await service.captureX402Quote(ACTOR, intent().intentId);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(calls, 1);
  if (first.ok && second.ok) assert.equal(first.value.quoteHash, second.value.quoteHash);
});

test("does not mutate the receipt when the provider does not return 402", async () => {
  const repository = repositoryStub();
  const service = new PostgresAgonMarketService(repository as never, {
    fetchImpl: async () => new Response("", { status: 200 }),
  });
  const result = await service.captureX402Quote(ACTOR, intent().intentId);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "validation_failed");
});
