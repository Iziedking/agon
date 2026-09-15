import assert from "node:assert/strict";
import test from "node:test";
import { decideAgonArenaReview } from "../../src/agon/execution/arena-review-policy.ts";

const good = { score: 92, confidence: 0.97, evidenceComplete: true, providerResponseValid: true, reconciliation: "confirmed" as const };

test("high-confidence reconciled evaluations complete automatically", () => {
  assert.deepEqual(decideAgonArenaReview(good), { decision: "auto_accept", reasons: [] });
  assert.deepEqual(decideAgonArenaReview({ ...good, score: 42 }), { decision: "auto_reject", reasons: [] });
});

test("uncertain evidence and chain outcomes escalate to the operator", () => {
  const result = decideAgonArenaReview({ ...good, reconciliation: "unknown", policyFlags: ["duplicate_output"] });
  assert.equal(result.decision, "escalate");
  assert.deepEqual(result.reasons, ["reconciliation_unknown", "policy_duplicate_output"]);
});

test("confidence below threshold raises an alarm without blocking normal scoring forever", () => {
  const result = decideAgonArenaReview({ ...good, confidence: 0.7 });
  assert.deepEqual(result, { decision: "escalate", reasons: ["confidence_below_auto_threshold"] });
});
