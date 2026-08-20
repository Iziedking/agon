import { getAddress, keccak256, stringToHex } from "viem";
import { hashX402ExecutionPlan, type X402ExecutionPlan } from "./x402-facilitator.ts";

export const X402_EXECUTION_APPROVAL_PHRASE = "APPROVE_ARC_TESTNET_X402" as const;
const APPROVAL_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export type X402ExecutionApprovalRequest = {
  planHash: string;
  approvalIdempotencyKey: string;
  confirmation: typeof X402_EXECUTION_APPROVAL_PHRASE;
};

export type X402ExecutionApproval = {
  approvalHash: `0x${string}`;
  intentId: string;
  actor: `0x${string}`;
  planHash: `0x${string}`;
  approvalIdempotencyKey: string;
  authorizationHash: `0x${string}`;
  testnetOnly: true;
  approvedAt: string;
  expiresAt: string;
  executionEnabled: false;
  nextAction: "execution_adapter_not_enabled";
};

export type X402ExecutionApprovalError = {
  code: "execution_not_ready";
  message: string;
};

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
      .join(",")}}`;
  }
  throw new Error("approval evidence must be JSON-compatible");
}

function fail(message: string): { ok: false; error: X402ExecutionApprovalError } {
  return { ok: false, error: { code: "execution_not_ready", message } };
}

export function buildX402ExecutionApproval(input: {
  intentId: string;
  actor: string;
  plan: X402ExecutionPlan;
  request: X402ExecutionApprovalRequest;
  nowSeconds?: number;
}): { ok: true; value: X402ExecutionApproval } | { ok: false; error: X402ExecutionApprovalError } {
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.actor)) return fail("authenticated actor is not a valid EVM address");
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.request.planHash)) return fail("plan hash must be a bytes32 value");
  if (input.request.planHash.toLowerCase() !== hashX402ExecutionPlan(input.plan).toLowerCase()) return fail("approval plan hash does not match the prepared plan");
  if (input.request.confirmation !== X402_EXECUTION_APPROVAL_PHRASE) return fail("explicit Arc Testnet approval phrase is required");
  if (!APPROVAL_KEY.test(input.request.approvalIdempotencyKey)) return fail("approvalIdempotencyKey must be 8-128 safe characters");
  if (!input.plan.testnetOnly || input.plan.executionEnabled) return fail("only disabled Arc Testnet plans may be approved");
  try {
    const actor = getAddress(input.actor).toLowerCase() as `0x${string}`;
    const now = Math.floor(input.nowSeconds ?? Date.now() / 1000);
    const validBefore = Number(input.plan.authorization.validBefore);
    if (!Number.isSafeInteger(validBefore) || now >= validBefore) return fail("authorization is expired and cannot be approved");
    const approvedAt = new Date(now * 1000).toISOString();
    const expiresAt = new Date(Math.min(validBefore, now + 300) * 1000).toISOString();
    const approvalHash = keccak256(stringToHex(canonicalize({
      actor,
      approvalIdempotencyKey: input.request.approvalIdempotencyKey,
      approvedAt,
      expiresAt,
      intentId: input.intentId,
      planHash: input.plan.planHash,
    })));
    return {
      ok: true,
      value: {
        approvalHash,
        intentId: input.intentId,
        actor,
        planHash: input.plan.planHash,
        approvalIdempotencyKey: input.request.approvalIdempotencyKey,
        authorizationHash: input.plan.authorizationHash,
        testnetOnly: true,
        approvedAt,
        expiresAt,
        executionEnabled: false,
        nextAction: "execution_adapter_not_enabled",
      },
    };
  } catch {
    return fail("execution approval contains invalid authorization fields");
  }
}
