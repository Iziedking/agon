import assert from "node:assert/strict";
import test from "node:test";

import { buildX402Authorization } from "../../src/agon/execution/x402-authorization.ts";
import { buildX402ExecutionPlan } from "../../src/agon/execution/x402-facilitator.ts";
import { buildX402ExecutionApproval, X402_EXECUTION_APPROVAL_PHRASE } from "../../src/agon/execution/x402-execution-approval.ts";
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
    assert.match(plan.value.planHash, /^0x[0-9a-f]{64}$/);
    assert.equal(plan.value.executionEnabled, false);
    assert.equal(plan.value.nextAction, "explicit_execution_approval");
    const approval = buildX402ExecutionApproval({
      intentId: "00000000-0000-4000-8000-000000000001",
      actor: ACTOR,
      plan: plan.value,
      request: { planHash: plan.value.planHash, approvalIdempotencyKey: "approval-001", confirmation: X402_EXECUTION_APPROVAL_PHRASE },
      nowSeconds: 1_787_240_000,
    });
    assert.equal(approval.ok, true);
    if (approval.ok) {
      assert.equal(approval.value.testnetOnly, true);
      assert.equal(approval.value.executionEnabled, false);
      assert.equal(approval.value.nextAction, "execution_adapter_not_enabled");
    }
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

test("rejects an approval whose plan fingerprint or confirmation does not match", () => {
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
  if (!plan.ok) return;
  assert.equal(buildX402ExecutionApproval({
    intentId: "00000000-0000-4000-8000-000000000001",
    actor: ACTOR,
    plan: plan.value,
    request: { planHash: `0x${"ff".repeat(32)}`, approvalIdempotencyKey: "approval-002", confirmation: X402_EXECUTION_APPROVAL_PHRASE },
    nowSeconds: 1_787_240_000,
  }).ok, false);
  assert.equal(buildX402ExecutionApproval({
    intentId: "00000000-0000-4000-8000-000000000001",
    actor: ACTOR,
    plan: plan.value,
    request: { planHash: plan.value.planHash, approvalIdempotencyKey: "approval-003", confirmation: "NOPE" as typeof X402_EXECUTION_APPROVAL_PHRASE },
    nowSeconds: 1_787_240_000,
  }).ok, false);
});
