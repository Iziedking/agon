import assert from "node:assert/strict";
import test from "node:test";

import { buildX402Authorization } from "../../src/agon/execution/x402-authorization.ts";
import { buildX402ExecutionPlan } from "../../src/agon/execution/x402-facilitator.ts";
import type { X402QuoteSnapshot } from "../../src/agon/execution/x402-quote.ts";

const ACTOR = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const snapshot: X402QuoteSnapshot = {
  x402Version: 2,
  resource: { url: "https://provider.example/x402" },
  accepts: [{
    scheme: "exact", network: "eip155:5042002", asset: `0x${"11".repeat(20)}`,
    amount: "1000", maxTimeoutSeconds: 604900, payTo: `0x${"22".repeat(20)}`,
    extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: `0x${"33".repeat(20)}` },
  }],
};

test("builds a redacted Arc Testnet Circle settlement plan", () => {
  const built = buildX402Authorization(ACTOR, "5042002", snapshot, 1_787_240_000);
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const plan = buildX402ExecutionPlan({
    snapshot,
    authorization: built.value.payload,
    authorizationPayloadHash: built.value.payloadHash,
    authorizationHash: `0x${"aa".repeat(32)}`,
    approvedAmountUSDC: "0.01",
    nowSeconds: 1_787_240_000,
  });
  assert.equal(plan.ok, true);
  if (plan.ok) {
    assert.equal(plan.value.testnetOnly, true);
    assert.equal(plan.value.settlementEndpoint, "https://gateway-api-testnet.circle.com/v1/x402/settle");
    assert.equal(plan.value.paymentPayloadPreview.payload.signature, null);
    assert.equal(plan.value.executionEnabled, false);
    assert.equal(plan.value.nextAction, "explicit_execution_approval");
  }
});

test("fails closed for wrong network, contract, recipient, amount, or expiry", () => {
  const built = buildX402Authorization(ACTOR, "5042002", snapshot, 1_787_240_000);
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const base = {
    snapshot,
    authorization: built.value.payload,
    authorizationPayloadHash: built.value.payloadHash,
    authorizationHash: `0x${"aa".repeat(32)}`,
    approvedAmountUSDC: "0.01",
    nowSeconds: 1_787_240_000,
  };
  assert.equal(buildX402ExecutionPlan({ ...base, snapshot: { ...snapshot, accepts: [{ ...snapshot.accepts[0]!, network: "eip155:84532" }] } }).ok, false);
  assert.equal(buildX402ExecutionPlan({ ...base, authorization: { ...built.value.payload, message: { ...built.value.payload.message, to: ACTOR } } }).ok, false);
  assert.equal(buildX402ExecutionPlan({ ...base, nowSeconds: 1_800_000_000 }).ok, false);
});
