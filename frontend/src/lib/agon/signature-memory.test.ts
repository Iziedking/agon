import assert from "node:assert/strict";
import test from "node:test";
import { forgetX402Signature, readX402Signature, rememberX402Signature } from "./signature-memory.ts";

test("keeps the x402 signature transient and intent-scoped", () => {
  const intentId = "intent-signature-test";
  const signature = `0x${"11".repeat(65)}` as `0x${string}`;
  forgetX402Signature(intentId);
  assert.equal(readX402Signature(intentId), null);
  rememberX402Signature(intentId, signature);
  assert.equal(readX402Signature(intentId), signature);
  assert.equal(readX402Signature("other-intent"), null);
  forgetX402Signature(intentId);
  assert.equal(readX402Signature(intentId), null);
});
