import assert from "node:assert/strict";
import test from "node:test";
import { keccak256 } from "viem";
import { buildX402ExecutionApproval, X402_EXECUTION_APPROVAL_PHRASE } from "../../src/agon/execution/x402-execution-approval.ts";
import { buildX402ExecutionPlan, type X402ExecutionPlan } from "../../src/agon/execution/x402-facilitator.ts";
import { createX402FacilitatorAdapter, X402_EXECUTION_CONFIRMATION_PHRASE, X402_VERIFY_CONFIRMATION_PHRASE, type X402StoredApprovalEvidence } from "../../src/agon/execution/x402-settlement.ts";
import { createX402ExecutionPolicy } from "../../src/agon/execution/x402-policy.ts";

const ACTOR = "0x1111111111111111111111111111111111111111";
const PAY_TO = "0x2222222222222222222222222222222222222222";
const VERIFYING = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
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
  const planResult = buildX402ExecutionPlan({
    snapshot: {
      x402Version: 2, accepts: [{ scheme: "exact", network: "eip155:5042002", asset: "0x3600000000000000000000000000000000000000", amount: "1000", payTo: PAY_TO, maxTimeoutSeconds: 600, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: VERIFYING } }],
      resource: { url: "https://agon.surf/test", description: "test", mimeType: "application/json" },
    },
    authorization,
    authorizationPayloadHash: `0x${"cd".repeat(32)}`,
    authorizationHash: keccak256(`0x${"12".repeat(65)}`),
    approvedAmountUSDC: "0.01",
    nowSeconds: NOW,
  });
  assert.equal(planResult.ok, true);
  const plan = planResult.value;
  const approvalResult = buildX402ExecutionApproval({ intentId: "00000000-0000-4000-8000-000000000001", actor: ACTOR, plan, request: { planHash: plan.planHash, approvalIdempotencyKey: "approval-001", confirmation: X402_EXECUTION_APPROVAL_PHRASE }, nowSeconds: NOW });
  assert.equal(approvalResult.ok, true);
  const approval = approvalResult.value;
  const stored: X402StoredApprovalEvidence = { ...approval, approvedAt: new Date(approval.approvedAt), expiresAt: new Date(approval.expiresAt) };
  return { plan, approval: stored, signature: `0x${"12".repeat(65)}` };
}

test("disabled adapter validates but never calls an injected facilitator", async () => {
  const input = fixture();
  let calls = 0;
  const adapter = createX402FacilitatorAdapter({ client: { settle: async () => { calls += 1; throw new Error("must not call"); } } });
  const result = await adapter.settle({ ...input, confirmation: X402_EXECUTION_CONFIRMATION_PHRASE, nowSeconds: NOW });
  assert.deepEqual(result, { ok: false, error: { code: "execution_disabled", message: "x402 execution adapter is disabled by policy" } });
  assert.equal(calls, 0);
});

test("disabled verification validates but never calls an injected facilitator", async () => {
  const input = fixture();
  let calls = 0;
  const adapter = createX402FacilitatorAdapter({
    client: {
      verify: async () => { calls += 1; throw new Error("must not call"); },
      settle: async () => { throw new Error("must not call"); },
    },
  });
  const result = await adapter.verify({ ...input, confirmation: X402_VERIFY_CONFIRMATION_PHRASE, nowSeconds: NOW });
  assert.deepEqual(result, { ok: false, error: { code: "execution_disabled", message: "x402 verification adapter is disabled by policy" } });
  assert.equal(calls, 0);
});

test("enabled verification forwards the validated payload and enforces payer identity", async () => {
  const input = fixture();
  let received: unknown;
  const adapter = createX402FacilitatorAdapter({
    enabled: true,
    policy: createX402ExecutionPolicy({ enabled: true, maxAmountBaseUnits: "1000" }),
    client: {
      verify: async (payload, requirements) => {
        received = { payload, requirements };
        return { isValid: true, payer: ACTOR };
      },
      settle: async () => { throw new Error("settlement is not part of verification"); },
    },
  });
  const result = await adapter.verify({ ...input, confirmation: X402_VERIFY_CONFIRMATION_PHRASE, nowSeconds: NOW });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.verified, true);
  assert.equal(result.value.payer, ACTOR);
  assert.equal((received as { payload: { payload: { signature: string } } }).payload.payload.signature, input.signature);

  const rejecting = createX402FacilitatorAdapter({
    enabled: true,
    policy: createX402ExecutionPolicy({ enabled: true, maxAmountBaseUnits: "1000" }),
    client: {
      verify: async () => ({ isValid: true, payer: PAY_TO }),
      settle: async () => { throw new Error("settlement is not part of verification"); },
    },
  });
  const rejected = await rejecting.verify({ ...input, confirmation: X402_VERIFY_CONFIRMATION_PHRASE, nowSeconds: NOW });
  assert.deepEqual(rejected, { ok: false, error: { code: "facilitator_rejected", message: "Circle facilitator payer does not match the authorization owner" } });
});

test("rejects a changed plan, stale approval, or mismatched signature before Circle", async () => {
  const input = fixture();
  let calls = 0;
  const adapter = createX402FacilitatorAdapter({ enabled: true, client: { settle: async () => { calls += 1; throw new Error("must not call"); } } });
  const changed = await adapter.settle({ ...input, plan: { ...input.plan, requirements: { ...input.plan.requirements, amount: "1001" } }, confirmation: X402_EXECUTION_CONFIRMATION_PHRASE });
  assert.equal(changed.ok, false);
  const stale = await adapter.settle({ ...input, nowSeconds: NOW + 301, confirmation: X402_EXECUTION_CONFIRMATION_PHRASE });
  assert.equal(stale.ok, false);
  const mismatched = await adapter.settle({ ...input, signature: `0x${"34".repeat(65)}`, confirmation: X402_EXECUTION_CONFIRMATION_PHRASE });
  assert.equal(mismatched.ok, false);
  assert.equal(calls, 0);
});

test("enabled adapter forwards only the validated in-memory payload to an injected client", async () => {
  const input = fixture();
  let received: unknown;
  const adapter = createX402FacilitatorAdapter({
    enabled: true,
    policy: createX402ExecutionPolicy({ enabled: true, maxAmountBaseUnits: "1000" }),
    client: { settle: async (payload, requirements) => { received = { payload, requirements }; return { success: true, transaction: `0x${"ef".repeat(32)}`, network: "eip155:5042002", payer: ACTOR }; } },
  });
  const result = await adapter.settle({ ...input, confirmation: X402_EXECUTION_CONFIRMATION_PHRASE, nowSeconds: NOW });
  assert.equal(result.ok, true);
  assert.equal((result.value as { executionEnabled: true }).executionEnabled, true);
  assert.equal((received as { payload: { payload: { signature: string } } }).payload.payload.signature, input.signature);
});

test("accepts Circle's transfer UUID as a provider reference without treating it as a tx hash", async () => {
  const input = fixture();
  const transferId = "3c90c3cc-0d44-4b50-8888-8dd25736052a";
  const adapter = createX402FacilitatorAdapter({
    enabled: true,
    policy: createX402ExecutionPolicy({ enabled: true, maxAmountBaseUnits: "1000" }),
    client: { settle: async () => ({ success: true, transaction: transferId, network: "eip155:5042002", payer: ACTOR }) },
  });
  const result = await adapter.settle({ ...input, confirmation: X402_EXECUTION_CONFIRMATION_PHRASE, nowSeconds: NOW });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.transaction, null);
  assert.equal(result.value.providerTransferId, transferId);
});

test("refuses an enabled adapter without an explicit policy", async () => {
  const input = fixture();
  let calls = 0;
  const adapter = createX402FacilitatorAdapter({ enabled: true, client: { settle: async () => { calls += 1; throw new Error("must not call"); } } });
  const result = await adapter.settle({ ...input, confirmation: X402_EXECUTION_CONFIRMATION_PHRASE, nowSeconds: NOW });
  assert.deepEqual(result, { ok: false, error: { code: "execution_disabled", message: "x402 execution requires an explicit spend policy" } });
  assert.equal(calls, 0);
});

test("fails closed when the plan exceeds the policy cap", async () => {
  const input = fixture();
  let calls = 0;
  const adapter = createX402FacilitatorAdapter({
    enabled: true,
    policy: createX402ExecutionPolicy({ enabled: true, maxAmountBaseUnits: "999" }),
    client: { settle: async () => { calls += 1; throw new Error("must not call"); } },
  });
  const result = await adapter.settle({ ...input, confirmation: X402_EXECUTION_CONFIRMATION_PHRASE, nowSeconds: NOW });
  assert.deepEqual(result, { ok: false, error: { code: "execution_not_ready", message: "x402 amount exceeds the configured spend cap" } });
  assert.equal(calls, 0);
});
