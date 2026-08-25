import assert from "node:assert/strict";
import test from "node:test";
import { decodePaymentSignatureHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { keccak256 } from "viem";

import { buildX402ExecutionApproval, X402_EXECUTION_APPROVAL_PHRASE } from "../../src/agon/execution/x402-execution-approval.ts";
import { buildX402ExecutionPlan } from "../../src/agon/execution/x402-facilitator.ts";
import { createX402ExecutionPolicy } from "../../src/agon/execution/x402-policy.ts";
import { createX402ProviderExecutionAdapter } from "../../src/agon/execution/x402-provider-execution.ts";
import { X402_EXECUTION_CONFIRMATION_PHRASE, type X402StoredApprovalEvidence } from "../../src/agon/execution/x402-settlement.ts";

const ACTOR = "0x1111111111111111111111111111111111111111";
const PAY_TO = "0x2222222222222222222222222222222222222222";
const VERIFYING = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const URL = "https://agent.example.com/review";
const NOW = 1_800_000_000;

function fixture() {
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
  const plan = buildX402ExecutionPlan({
    snapshot: {
      x402Version: 2,
      accepts: [{ scheme: "exact", network: "eip155:5042002", asset: "0x3600000000000000000000000000000000000000", amount: "1000", payTo: PAY_TO, maxTimeoutSeconds: 600, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: VERIFYING } }],
      resource: { url: URL, description: "code review", mimeType: "application/json" },
    },
    authorization,
    authorizationPayloadHash: `0x${"cd".repeat(32)}`,
    authorizationHash: keccak256(`0x${"12".repeat(65)}`),
    approvedAmountUSDC: "0.01",
    nowSeconds: NOW,
  });
  assert.equal(plan.ok, true);
  const approval = buildX402ExecutionApproval({ intentId: "00000000-0000-4000-8000-000000000001", actor: ACTOR, plan: plan.value, request: { planHash: plan.value.planHash, approvalIdempotencyKey: "approval-001", confirmation: X402_EXECUTION_APPROVAL_PHRASE }, nowSeconds: NOW });
  assert.equal(approval.ok, true);
  return {
    approval: { ...approval.value, approvedAt: new Date(approval.value.approvedAt), expiresAt: new Date(approval.value.expiresAt) } as X402StoredApprovalEvidence,
    plan: plan.value,
    signature: `0x${"12".repeat(65)}`,
    confirmation: X402_EXECUTION_CONFIRMATION_PHRASE,
    nowSeconds: NOW,
    delivery: { targetUrl: URL, method: "POST" as const, input: { repository: "agon" } },
  };
}

test("replays the exact reviewed payment to the provider and returns bounded delivery evidence", async () => {
  let observed: { url: string; payload: ReturnType<typeof decodePaymentSignatureHeader>; body: unknown } | null = null;
  const adapter = createX402ProviderExecutionAdapter({
    enabled: true,
    policy: createX402ExecutionPolicy({ enabled: true, maxAmountBaseUnits: "1000" }),
    fetchImpl: async (url, init) => {
      const headers = new Headers(init?.headers);
      observed = { url: String(url), payload: decodePaymentSignatureHeader(headers.get("payment-signature")!), body: JSON.parse(String(init?.body)) };
      return new Response(JSON.stringify({ verdict: "pass" }), {
        status: 200,
        headers: { "content-type": "application/json", "payment-response": encodePaymentResponseHeader({ success: true, transaction: `0x${"ef".repeat(32)}`, network: "eip155:5042002", payer: ACTOR, amount: "1000" }) },
      });
    },
  });
  const result = await adapter.settle(fixture());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(observed?.url, URL);
  assert.deepEqual(observed?.body, { repository: "agon" });
  assert.equal(observed?.payload.accepted.amount, "1000");
  assert.equal((observed?.payload.payload as { signature: string }).signature, `0x${"12".repeat(65)}`);
  assert.deepEqual(result.value.delivery?.result, { verdict: "pass" });
  assert.match(result.value.delivery?.responseHash ?? "", /^0x[0-9a-f]{64}$/);
});

test("fails before the provider call when disabled or the resource URL drifts", async () => {
  let calls = 0;
  const disabled = createX402ProviderExecutionAdapter({
    policy: createX402ExecutionPolicy({ enabled: true, maxAmountBaseUnits: "1000" }),
    fetchImpl: async () => { calls += 1; throw new Error("must not call"); },
  });
  assert.equal((await disabled.settle(fixture())).ok, false);
  const enabled = createX402ProviderExecutionAdapter({
    enabled: true,
    policy: createX402ExecutionPolicy({ enabled: true, maxAmountBaseUnits: "1000" }),
    fetchImpl: async () => { calls += 1; throw new Error("must not call"); },
  });
  assert.equal((await enabled.settle({ ...fixture(), delivery: { ...fixture().delivery, targetUrl: "https://evil.example.com" } })).ok, false);
  assert.equal(calls, 0);
});

test("requires successful exact Arc settlement proof from the provider", async () => {
  const adapter = createX402ProviderExecutionAdapter({
    enabled: true,
    policy: createX402ExecutionPolicy({ enabled: true, maxAmountBaseUnits: "1000" }),
    fetchImpl: async () => new Response("{}", { status: 200 }),
  });
  const result = await adapter.settle(fixture());
  assert.deepEqual(result, { ok: false, error: { code: "facilitator_rejected", message: "provider omitted the x402 PAYMENT-RESPONSE settlement proof" } });
});
