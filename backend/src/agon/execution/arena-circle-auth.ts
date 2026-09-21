import { buildAgonArenaEvidencePlan, buildAgonArenaRequestPlan, type AgonArenaEvaluation } from "./arena-verification.ts";

const REQUEST_SIGNATURE = "requestEvaluation(bytes32,uint256,bytes32,bytes32,bytes32,uint64)";
const EVIDENCE_SIGNATURE = "submitEvidence(uint256,bytes32)";

export type ArenaCircleExecutionInput = {
  evaluation: AgonArenaEvaluation | null;
  operator: string;
  contractAddress: string;
  abiFunctionSignature: string;
  abiParameters: ReadonlyArray<unknown>;
};

export type ArenaCircleExecutionResult =
  | { ok: true }
  | { ok: false; message: string };

function normalize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return /^0x[0-9a-f]+$/i.test(value) ? value.toLowerCase() : value;
  if (Array.isArray(value)) return value.map(normalize);
  return value;
}

function sameArgs(actual: ReadonlyArray<unknown>, expected: ReadonlyArray<unknown>): boolean {
  return JSON.stringify(normalize(actual)) === JSON.stringify(normalize(expected));
}

/**
 * Fail-closed authorization for Circle-signed Arena provider calls.
 *
 * The Circle execute endpoint is shared by several product surfaces. Arena
 * calls must be bound to a prepared, provider-owned evaluation intent so an
 * authenticated Circle session cannot turn the contract allowlist into a
 * generic signing oracle.
 */
export function authorizeArenaCircleExecution(input: ArenaCircleExecutionInput): ArenaCircleExecutionResult {
  const evaluation = input.evaluation;
  if (!evaluation) return { ok: false, message: "prepared Arena evaluation was not found" };
  if (evaluation.actor.toLowerCase() !== input.operator.toLowerCase()) {
    return { ok: false, message: "only the listing provider may sign this Arena evaluation" };
  }
  if (evaluation.arenaContract.toLowerCase() !== input.contractAddress.toLowerCase()) {
    return { ok: false, message: "Arena contract does not match the prepared evaluation" };
  }

  try {
    const plan = input.abiFunctionSignature === REQUEST_SIGNATURE
      ? buildAgonArenaRequestPlan(evaluation)
      : input.abiFunctionSignature === EVIDENCE_SIGNATURE
        ? buildAgonArenaEvidencePlan(evaluation)
        : null;
    if (!plan) return { ok: false, message: "Arena function is not an approved provider action" };
    if (plan.to.toLowerCase() !== input.contractAddress.toLowerCase() || plan.functionName !== input.abiFunctionSignature.split("(")[0]) {
      return { ok: false, message: "Arena call does not match the prepared evaluation" };
    }
    if (!sameArgs(input.abiParameters, plan.args)) {
      return { ok: false, message: "Arena call arguments do not match the prepared evaluation" };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Arena call is not ready" };
  }
}

export const AGON_ARENA_REQUEST_SIGNATURE = REQUEST_SIGNATURE;
export const AGON_ARENA_EVIDENCE_SIGNATURE = EVIDENCE_SIGNATURE;
