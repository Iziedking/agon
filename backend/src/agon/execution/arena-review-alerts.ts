import { notify } from "../../notifications/index.ts";

/** Raise an operator-visible and Telegram alert for an escalated evaluation. */
export async function alertAgonArenaOperator(input: {
  operator: string;
  intentId: string;
  listingReference: string;
  reasons: readonly string[];
  href?: string;
}): Promise<void> {
  await notify(input.operator, {
    kind: "arena_review_escalation",
    title: "Agon Arena review needs operator attention",
    body: `Evaluation ${input.intentId} was held for review: ${input.reasons.join(", ") || "policy review"}.`,
    href: input.href ?? `/admin?arenaEvaluation=${encodeURIComponent(input.intentId)}`,
    context: { intentId: input.intentId, listingReference: input.listingReference, reasons: input.reasons.slice(0, 16), source: "agon-arena-auto-review" },
  });
}
