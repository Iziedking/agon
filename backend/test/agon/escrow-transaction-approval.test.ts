import assert from "node:assert/strict";
import test from "node:test";
import {
  AGON_ESCROW_TRANSACTION_APPROVAL_PHRASES,
  buildAgonEscrowTransactionApproval,
  validateAgonEscrowTransactionApproval,
} from "../../src/agon/execution/escrow-transaction-approval.ts";
import { AGON_PRIZE_ESCROW_CONTROLLER_ROLE } from "../../src/agon/execution/escrow-reconciliation.ts";
import { buildAgonPrizeEscrowWriteIntent, type AgonPrizeEscrowWritePreflightResult } from "../../src/agon/execution/escrow-write-preflight.ts";

const ESCROW = "0x1111111111111111111111111111111111111111";
const CONTROLLER = "0x2222222222222222222222222222222222222222";
const PARTICIPANT = "0x3333333333333333333333333333333333333333";
const ACTOR = "0x4444444444444444444444444444444444444444";
const USDC = "0x3600000000000000000000000000000000000000";

function preflight(operation: "fund" | "release" | "refund" = "fund"): AgonPrizeEscrowWritePreflightResult {
  const intent = buildAgonPrizeEscrowWriteIntent({ network: "eip155:5042002", escrowAddress: ESCROW, controller: CONTROLLER, operation, poolId: "7", amountBaseUnits: "1000000", participant: PARTICIPANT, expectedAsset: USDC });
  return {
    status: "preflight_passed",
    codePresent: true,
    controllerAuthorized: true,
    controllerRole: AGON_PRIZE_ESCROW_CONTROLLER_ROLE,
    requiredMutatingSignatures: [] as never,
    requiredMutatingSelectors: [],
    intent,
  };
}

function approval(overrides: Record<string, unknown> = {}) {
  return buildAgonEscrowTransactionApproval({
    preflight: preflight(),
    request: {
      intentId: "escrow-intent-001",
      actor: ACTOR,
      operation: "fund",
      approvalIdempotencyKey: "approval-001",
      confirmation: AGON_ESCROW_TRANSACTION_APPROVAL_PHRASES.fund,
      ...overrides,
    },
    nowSeconds: 1_700_000_000,
  });
}

test("builds explicit approval bound to the exact preflighted calldata", () => {
  const result = approval();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.executionEnabled, false);
  assert.equal(result.value.nextAction, "transaction_adapter_not_enabled");
  assert.equal(result.value.testnetOnly, true);
  assert.equal(validateAgonEscrowTransactionApproval({ approval: result.value, preflight: preflight(), intentId: "escrow-intent-001", actor: ACTOR, nowSeconds: 1_700_000_001 }).ok, true);
});

test("requires the operation-specific phrase and exact operation binding", () => {
  assert.equal(approval({ confirmation: "APPROVE_ARC_TESTNET_ESCROW" }).ok, false);
  assert.equal(approval({ operation: "release", confirmation: AGON_ESCROW_TRANSACTION_APPROVAL_PHRASES.release }).ok, false);
});

test("rejects changed calldata, actor, intent, and expired approval", () => {
  const result = approval();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(validateAgonEscrowTransactionApproval({ approval: result.value, preflight: preflight("release"), intentId: result.value.intentId, actor: ACTOR, nowSeconds: 1_700_000_001 }).ok, false);
  assert.equal(validateAgonEscrowTransactionApproval({ approval: result.value, preflight: preflight(), intentId: result.value.intentId, actor: PARTICIPANT, nowSeconds: 1_700_000_001 }).ok, false);
  assert.equal(validateAgonEscrowTransactionApproval({ approval: result.value, preflight: preflight(), intentId: "escrow-intent-002", actor: ACTOR, nowSeconds: 1_700_000_001 }).ok, false);
  assert.equal(validateAgonEscrowTransactionApproval({ approval: result.value, preflight: preflight(), intentId: result.value.intentId, actor: ACTOR, nowSeconds: 1_700_000_301 }).ok, false);
});

test("tampered approval hash fails closed before any transaction adapter exists", () => {
  const result = approval();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const tampered = { ...result.value, approvalHash: `0x${"00".repeat(32)}` as `0x${string}` };
  const checked = validateAgonEscrowTransactionApproval({ approval: tampered, preflight: preflight(), intentId: result.value.intentId, actor: ACTOR, nowSeconds: 1_700_000_001 });
  assert.equal(checked.ok, false);
});
