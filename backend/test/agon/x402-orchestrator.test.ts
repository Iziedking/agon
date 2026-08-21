import assert from "node:assert/strict";
import test from "node:test";
import { keccak256 } from "viem";
import { buildX402ExecutionApproval, X402_EXECUTION_APPROVAL_PHRASE } from "../../src/agon/execution/x402-execution-approval.ts";
import { buildX402ExecutionPlan } from "../../src/agon/execution/x402-facilitator.ts";
import { createX402ExecutionPolicy } from "../../src/agon/execution/x402-policy.ts";
import { createX402SettlementOrchestrator } from "../../src/agon/execution/x402-orchestrator.ts";
import type { X402SettlementRequest } from "../../src/agon/execution/x402-settlement.ts";
import { transitionX402Receipt, type X402ReceiptEvent } from "../../src/agon/execution/x402-receipt.ts";
import type { StoredX402CallReceipt } from "../../src/agon/store/repository.ts";

const ACTOR = "0x1111111111111111111111111111111111111111";
const PAY_TO = "0x2222222222222222222222222222222222222222";
const VERIFYING = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const NOW = 1_800_000_000;
const TX = `0x${"ef".repeat(32)}` as const;

function inputAndReceipt(): { input: X402SettlementRequest; receipt: StoredX402CallReceipt } {
  const authorization = {
    x402Version: 2 as const,
    domain: { name: "GatewayWalletBatched" as const, version: "1" as const, chainId: 5042002, verifyingContract: VERIFYING as `0x${string}` },
    types: { TransferWithAuthorization: [
      { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
    ] } as const,
    primaryType: "TransferWithAuthorization" as const,
    message: { from: ACTOR as `0x${string}`, to: PAY_TO as `0x${string}`, value: "1000", validAfter: String(NOW - 60), validBefore: String(NOW + 600), nonce: `0x${"ab".repeat(32)}` as `0x${string}` },
  };
  const built = buildX402ExecutionPlan({
    snapshot: { x402Version: 2, accepts: [{ scheme: "exact", network: "eip155:5042002", asset: "0x3600000000000000000000000000000000000000", amount: "1000", payTo: PAY_TO, maxTimeoutSeconds: 600, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: VERIFYING } }], resource: { url: "https://agon.surf/test", description: "test", mimeType: "application/json" } },
    authorization,
    authorizationPayloadHash: `0x${"cd".repeat(32)}`,
    authorizationHash: keccak256(`0x${"12".repeat(65)}`),
    approvedAmountUSDC: "0.01",
    nowSeconds: NOW,
  });
  assert.equal(built.ok, true);
  const approval = buildX402ExecutionApproval({ intentId: "00000000-0000-4000-8000-000000000001", actor: ACTOR, plan: built.value, request: { planHash: built.value.planHash, approvalIdempotencyKey: "approval-001", confirmation: X402_EXECUTION_APPROVAL_PHRASE }, nowSeconds: NOW });
  assert.equal(approval.ok, true);
  const input: X402SettlementRequest = { approval: { ...approval.value, approvedAt: new Date(approval.value.approvedAt), expiresAt: new Date(approval.value.expiresAt) }, plan: built.value, signature: `0x${"12".repeat(65)}`, confirmation: "EXECUTE_ARC_TESTNET_X402", nowSeconds: NOW };
  return { input, receipt: { receiptId: "00000000-0000-4000-8000-000000000002", intentId: input.approval.intentId, state: "authorization_submitted", approvedAmountUSDC: "0.01", quoteHash: `0x${"01".repeat(32)}`, quoteSnapshot: {}, authorizationPayloadHash: `0x${"cd".repeat(32)}`, authorizationPayload: {}, authorizationHash: input.approval.authorizationHash, settlementRef: null, serviceStatus: null, paymentResponseHash: null, chargedAmountUSDC: null, failureCode: null, failureMessage: null, createdAt: new Date(), updatedAt: new Date() } };
}

function fakeStore(initial: StoredX402CallReceipt) {
  let current = initial;
  return {
    getX402CallReceipt: async () => current,
    advanceX402CallReceipt: async (_intentId: string, event: X402ReceiptEvent) => {
      const transition = transitionX402Receipt(current.state, event);
      current = { ...current, state: transition.to, settlementRef: transition.patch.settlementRef ?? current.settlementRef, failureCode: transition.patch.failureCode ?? current.failureCode, failureMessage: transition.patch.failureMessage ?? current.failureMessage, updatedAt: new Date() };
      return current;
    },
    get current() { return current; },
  };
}

const policy = createX402ExecutionPolicy({ enabled: true, maxAmountBaseUnits: "1000" });

test("disabled policy does not mutate a receipt or call the adapter", async () => {
  const { input, receipt } = inputAndReceipt();
  const store = fakeStore(receipt);
  let calls = 0;
  const orchestrator = createX402SettlementOrchestrator({ store, policy: createX402ExecutionPolicy({ enabled: false, maxAmountBaseUnits: "1000" }), adapter: { settle: async () => { calls += 1; throw new Error("must not call"); } } });
  const result = await orchestrator.settle(input);
  assert.deepEqual(result, { ok: false, error: { code: "execution_disabled", message: "x402 execution is disabled by policy" }, receipt });
  assert.equal(calls, 0);
  assert.equal(store.current.state, "authorization_submitted");
});

test("records a submitted marker and trusted transaction without claiming delivery", async () => {
  const { input, receipt } = inputAndReceipt();
  const store = fakeStore(receipt);
  let calls = 0;
  const orchestrator = createX402SettlementOrchestrator({ store, policy, adapter: { settle: async () => { calls += 1; return { ok: true, value: { intentId: input.approval.intentId, approvalHash: input.approval.approvalHash as `0x${string}`, transaction: TX, network: "eip155:5042002", payer: ACTOR as `0x${string}`, executionEnabled: true } }; } } });
  const result = await orchestrator.settle(input);
  assert.equal(result.ok, true);
  assert.equal(result.receipt.state, "settlement_submitted");
  assert.equal(result.receipt.settlementRef, TX);
  assert.equal(result.serviceDeliveryPending, true);
  assert.equal(calls, 1);
});

test("retries are idempotent after a durable submission marker", async () => {
  const { input, receipt } = inputAndReceipt();
  const store = fakeStore(receipt);
  let calls = 0;
  const orchestrator = createX402SettlementOrchestrator({ store, policy, adapter: { settle: async () => { calls += 1; return { ok: true, value: { intentId: input.approval.intentId, approvalHash: input.approval.approvalHash as `0x${string}`, transaction: TX, network: "eip155:5042002", payer: null, executionEnabled: true } }; } } });
  await orchestrator.settle(input);
  const retry = await orchestrator.settle(input);
  assert.equal(retry.ok, true);
  assert.equal(calls, 1);
  assert.equal(retry.receipt.settlementRef, TX);
});

test("ambiguous facilitator failure becomes unknown and blocks duplicate settlement", async () => {
  const { input, receipt } = inputAndReceipt();
  const store = fakeStore(receipt);
  let calls = 0;
  const orchestrator = createX402SettlementOrchestrator({ store, policy, adapter: { settle: async () => { calls += 1; return { ok: false, error: { code: "facilitator_unavailable", message: "timeout" } }; } } });
  const first = await orchestrator.settle(input);
  assert.equal(first.ok, false);
  assert.equal(first.error.code, "settlement_unknown");
  assert.equal(first.receipt?.state, "unknown");
  const retry = await orchestrator.settle(input);
  assert.equal(retry.ok, false);
  assert.equal(retry.error.code, "reconciliation_required");
  assert.equal(calls, 1);
});

test("reconciliation accepts only a matching Arc Testnet transaction", async () => {
  const { input, receipt } = inputAndReceipt();
  const store = fakeStore(receipt);
  const orchestrator = createX402SettlementOrchestrator({ store, policy, adapter: { settle: async () => ({ ok: true, value: { intentId: input.approval.intentId, approvalHash: input.approval.approvalHash as `0x${string}`, transaction: TX, network: "eip155:5042002", payer: null, executionEnabled: true } }) } });
  await store.advanceX402CallReceipt(input.approval.intentId, { type: "mark_unknown", failureCode: "timeout", failureMessage: "ambiguous" });
  const wrongNetwork = await orchestrator.reconcile(input.approval.intentId, { status: "confirmed", network: "eip155:1", transaction: TX });
  assert.equal(wrongNetwork.ok, false);
  const confirmed = await orchestrator.reconcile(input.approval.intentId, { status: "confirmed", network: "eip155:5042002", transaction: TX });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.receipt.state, "settlement_submitted");
  assert.equal(confirmed.receipt.settlementRef, TX);
});
