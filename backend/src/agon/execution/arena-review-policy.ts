export type AgonArenaReviewDecision = "auto_accept" | "auto_reject" | "escalate";

export type AgonArenaReviewInput = {
  score: number;
  confidence: number;
  evidenceComplete: boolean;
  providerResponseValid: boolean;
  reconciliation: "confirmed" | "unknown" | "mismatch";
  policyFlags?: readonly string[];
};

export type AgonArenaReviewResult = {
  decision: AgonArenaReviewDecision;
  reasons: string[];
};

/**
 * Automatic review policy. Normal, high-confidence evaluations complete
 * without a person. Only ambiguous evidence, chain state, or policy signals
 * page the operator for a decision.
 */
export function decideAgonArenaReview(input: AgonArenaReviewInput): AgonArenaReviewResult {
  const reasons: string[] = [];
  if (!Number.isInteger(input.score) || input.score < 0 || input.score > 100) reasons.push("score_invalid");
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) reasons.push("confidence_invalid");
  if (!input.evidenceComplete) reasons.push("evidence_incomplete");
  if (!input.providerResponseValid) reasons.push("provider_response_invalid");
  if (input.reconciliation === "unknown") reasons.push("reconciliation_unknown");
  if (input.reconciliation === "mismatch") reasons.push("reconciliation_mismatch");
  for (const flag of input.policyFlags ?? []) if (flag.trim()) reasons.push(`policy_${flag.trim().slice(0, 64)}`);
  if (reasons.length > 0 || input.confidence < 0.85) {
    if (reasons.length === 0) reasons.push("confidence_below_auto_threshold");
    return { decision: "escalate", reasons };
  }
  return input.score >= 50 ? { decision: "auto_accept", reasons: [] } : { decision: "auto_reject", reasons: [] };
}
