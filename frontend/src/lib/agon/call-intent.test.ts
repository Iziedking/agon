import assert from "node:assert/strict";
import test from "node:test";

import { assessX402Readiness, buildCallIntentRequest, parseCallInput } from "./call-intent.ts";
import { AGON_PREVIEW_LISTINGS } from "./preview.ts";

test("keeps preview listings fail-closed unless every x402 gate passes", () => {
  const verified = AGON_PREVIEW_LISTINGS.find((item) => item.verification.status === "Verified" && item.payment.directX402);
  const provider = AGON_PREVIEW_LISTINGS[1];
  assert.ok(verified);
  assert.equal(assessX402Readiness(verified).eligible, true);
  assert.match(assessX402Readiness(provider).reason, /Agon test/i);
});

test("validates JSON object input and preserves a bounded spend cap", () => {
  assert.deepEqual(parseCallInput('{"query":"arc"}'), { input: { query: "arc" } });
  assert.match(String((parseCallInput("[]") as { error: string }).error), /object/i);
  assert.deepEqual(buildCallIntentRequest("agon-call-12345678", "POST", '{"query":"arc"}', "0.01"), {
    idempotencyKey: "agon-call-12345678",
    method: "POST",
    input: { query: "arc" },
    maxAmountUSDC: "0.01",
  });
  assert.match(String((buildCallIntentRequest("agon-call-12345678", "POST", "{}", "0") as { error: string }).error), /positive/i);
});
