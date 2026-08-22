import { getAddress, keccak256, stringToHex } from "viem";
import type { AgonPrizeEscrowWriteIntent, AgonPrizeEscrowWritePreflightResult } from "./escrow-write-preflight.ts";
import type { AgonEscrowWriteOperation } from "./escrow-write-preflight.ts";

export const AGON_ESCROW_TRANSACTION_APPROVAL_PHRASES = {
  fund: "APPROVE_FUND_ARC_TESTNET_ESCROW",
  release: "APPROVE_RELEASE_ARC_TESTNET_ESCROW",
  refund: "APPROVE_REFUND_ARC_TESTNET_ESCROW",
} as const;

const APPROVAL_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const MAX_APPROVAL_SECONDS = 300;

export type AgonEscrowTransactionApprovalRequest = {
  intentId: string;
  actor: string;
  operation: AgonEscrowWriteOperation;
  approvalIdempotencyKey: string;
  confirmation: string;
};

export type AgonEscrowTransactionApproval = {
  approvalHash: `0x${string}`;
  intentId: string;
  actor: `0x${string}`;
  operation: AgonEscrowWriteOperation;
  intentHash: `0x${string}`;
  approvalIdempotencyKey: string;
  testnetOnly: true;
  approvedAt: string;
  expiresAt: string;
  executionEnabled: false;
  nextAction: "transaction_adapter_not_enabled";
};

export type AgonEscrowTransactionApprovalError = {
  code: "approval_not_ready";
  message: string;
};

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
      .join(",")}}`;
  }
  throw new Error("escrow approval evidence must be JSON-compatible");
}

function fail(message: string): { ok: false; error: AgonEscrowTransactionApprovalError } {
  return { ok: false, error: { code: "approval_not_ready", message } };
}

function expectedPhrase(operation: AgonEscrowWriteOperation): string {
  return AGON_ESCROW_TRANSACTION_APPROVAL_PHRASES[operation];
}

function safeIntentId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value);
}

function safeActor(value: string): `0x${string}` | null {
  try {
    if (!/^0x[0-9a-fA-F]{40}$/.test(value)) return null;
    return getAddress(value).toLowerCase() as `0x${string}`;
  } catch {
    return null;
  }
}

/** Hash every field that a future signer or writer would use. */
export function hashAgonEscrowWriteIntent(intent: AgonPrizeEscrowWriteIntent): `0x${string}` {
  return keccak256(stringToHex(canonicalize({
    network: intent.network,
    escrowAddress: intent.escrowAddress,
    controller: intent.controller,
    asset: intent.asset,
    operation: intent.operation,
    functionName: intent.functionName,
    poolId: intent.poolId,
    amountBaseUnits: intent.amountBaseUnits,
    participant: intent.participant,
    args: intent.args,
    data: intent.data,
    execution: intent.execution,
  })));
}

export function hashAgonEscrowTransactionApproval(input: {
  intentId: string;
  actor: string;
  operation: AgonEscrowWriteOperation;
  intentHash: string;
  approvalIdempotencyKey: string;
  approvedAt: string;
  expiresAt: string;
}): `0x${string}` {
  return keccak256(stringToHex(canonicalize(input)));
}

/**
 * Creates explicit human approval evidence for a preflighted intent. This is
 * still not a wallet signature and cannot enable execution.
 */
export function buildAgonEscrowTransactionApproval(input: {
  preflight: AgonPrizeEscrowWritePreflightResult;
  request: AgonEscrowTransactionApprovalRequest;
  nowSeconds?: number;
}): { ok: true; value: AgonEscrowTransactionApproval } | { ok: false; error: AgonEscrowTransactionApprovalError } {
  if (input.preflight.status !== "preflight_passed" || !input.preflight.codePresent || !input.preflight.controllerAuthorized) return fail("a successful read-only PrizeEscrow preflight is required");
  if (!safeIntentId(input.request.intentId)) return fail("intentId must be 8-128 safe characters");
  const actor = safeActor(input.request.actor);
  if (!actor) return fail("authenticated actor is not a valid EVM address");
  if (input.request.operation !== input.preflight.intent.operation) return fail("approval operation does not match the preflighted intent");
  if (input.request.confirmation !== expectedPhrase(input.request.operation)) return fail("explicit Arc Testnet escrow approval phrase is required");
  if (!APPROVAL_KEY.test(input.request.approvalIdempotencyKey)) return fail("approvalIdempotencyKey must be 8-128 safe characters");
  try {
    const now = Math.floor(input.nowSeconds ?? Date.now() / 1000);
    if (!Number.isSafeInteger(now) || now < 0) return fail("approval time is invalid");
    const intentHash = hashAgonEscrowWriteIntent(input.preflight.intent);
    const approvedAt = new Date(now * 1000).toISOString();
    const expiresAt = new Date((now + MAX_APPROVAL_SECONDS) * 1000).toISOString();
    const approvalHash = hashAgonEscrowTransactionApproval({
      intentId: input.request.intentId,
      actor,
      operation: input.request.operation,
      intentHash,
      approvalIdempotencyKey: input.request.approvalIdempotencyKey,
      approvedAt,
      expiresAt,
    });
    return {
      ok: true,
      value: {
        approvalHash,
        intentId: input.request.intentId,
        actor,
        operation: input.request.operation,
        intentHash,
        approvalIdempotencyKey: input.request.approvalIdempotencyKey,
        testnetOnly: true,
        approvedAt,
        expiresAt,
        executionEnabled: false,
        nextAction: "transaction_adapter_not_enabled",
      },
    };
  } catch {
    return fail("escrow approval contains invalid preflight evidence");
  }
}

export function validateAgonEscrowTransactionApproval(input: {
  approval: AgonEscrowTransactionApproval;
  preflight: AgonPrizeEscrowWritePreflightResult;
  intentId: string;
  actor: string;
  nowSeconds?: number;
}): { ok: true } | { ok: false; error: AgonEscrowTransactionApprovalError } {
  const actor = safeActor(input.actor);
  if (!actor || actor !== input.approval.actor) return fail("approval actor does not match the authenticated actor");
  if (input.intentId !== input.approval.intentId) return fail("approval intent does not match the requested intent");
  if (input.approval.operation !== input.preflight.intent.operation) return fail("approval operation does not match the preflighted intent");
  if (!input.approval.testnetOnly || input.approval.executionEnabled) return fail("only disabled Arc Testnet approvals are accepted");
  if (input.approval.intentHash.toLowerCase() !== hashAgonEscrowWriteIntent(input.preflight.intent).toLowerCase()) return fail("approval is bound to a different transaction intent");
  const expiresAt = Date.parse(input.approval.expiresAt);
  const approvedAt = Date.parse(input.approval.approvedAt);
  const now = (input.nowSeconds ?? Date.now() / 1000) * 1000;
  if (!Number.isFinite(expiresAt) || !Number.isFinite(approvedAt) || expiresAt <= approvedAt || now >= expiresAt) return fail("escrow transaction approval is expired");
  const approvalHash = hashAgonEscrowTransactionApproval({
    intentId: input.approval.intentId,
    actor: input.approval.actor,
    operation: input.approval.operation,
    intentHash: input.approval.intentHash,
    approvalIdempotencyKey: input.approval.approvalIdempotencyKey,
    approvedAt: input.approval.approvedAt,
    expiresAt: input.approval.expiresAt,
  });
  if (approvalHash.toLowerCase() !== input.approval.approvalHash.toLowerCase()) return fail("escrow transaction approval hash is invalid");
  return { ok: true };
}
