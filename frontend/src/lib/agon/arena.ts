import { decodeEventLog, getAddress, type TransactionReceipt } from "viem";

import { agonArenaAbi } from "./abi.ts";
import type { AgonArenaEvaluationView } from "./types.ts";

export type AgonArenaPrimaryAction =
  | "submit_request"
  | "wait_for_evaluator"
  | "submit_evidence"
  | "finalizing"
  | "complete"
  | "retry_reconciliation";

/** Accept an evaluation id only from the canonical Arena and exact request. */
export function arenaEvaluationIdFromReceipt(
  receipt: Pick<TransactionReceipt, "status" | "logs">,
  arenaAddress: `0x${string}`,
  validationRequestHash: `0x${string}`,
): string {
  if (receipt.status !== "success") throw new Error("The Arena request reverted onchain.");
  const expectedArena = getAddress(arenaAddress);
  const expectedRequest = validationRequestHash.toLowerCase();
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== expectedArena) continue;
    try {
      const decoded = decodeEventLog({ abi: agonArenaAbi, data: log.data, topics: log.topics });
      if (decoded.eventName !== "EvaluationRequested") continue;
      if (decoded.args.validationRequestHash.toLowerCase() !== expectedRequest) continue;
      return decoded.args.evaluationId.toString();
    } catch {
      // Unrelated logs are ignored; the exact Arena event remains mandatory.
    }
  }
  throw new Error("The confirmed transaction did not contain the expected Arena request.");
}

export function arenaPrimaryAction(evaluation: AgonArenaEvaluationView): AgonArenaPrimaryAction {
  switch (evaluation.state) {
    case "prepared": return "submit_request";
    case "request_submitted": return "wait_for_evaluator";
    case "evidence_ready": return "submit_evidence";
    case "evidence_submitted": return "finalizing";
    case "verified": return evaluation.marketplaceVerification.state === "confirmed" ? "complete" : "finalizing";
    case "rejected":
    case "expired":
    case "revoked": return "complete";
    case "unknown": return "retry_reconciliation";
  }
}

export function arenaProgressPercent(evaluation: AgonArenaEvaluationView | null): number {
  if (!evaluation) return 0;
  switch (evaluation.state) {
    case "prepared": return 25;
    case "request_submitted": return 50;
    case "evidence_ready": return 70;
    case "evidence_submitted": return 85;
    case "verified": return evaluation.marketplaceVerification.state === "confirmed" ? 100 : 95;
    case "rejected":
    case "expired":
    case "revoked": return 100;
    case "unknown": return 50;
  }
}
