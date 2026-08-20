import assert from "node:assert/strict";
import test from "node:test";
import { validateX402Approval } from "../../src/agon/execution/x402-approval.ts";

test("accepts an approval at or below the prepared maximum", () => {
  const result = validateX402Approval("0.010000", { approvedAmountUSDC: "0.01" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.approvedAmountUSDC, "0.01");
});

test("rejects an approval above the prepared maximum", () => {
  const result = validateX402Approval("0.01", { approvedAmountUSDC: "0.010001" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "limit_exceeded");
});

test("rejects zero and malformed approval amounts", () => {
  assert.equal(validateX402Approval("0.01", { approvedAmountUSDC: "0" }).ok, false);
  assert.equal(validateX402Approval("0.01", { approvedAmountUSDC: "1e-3" }).ok, false);
});
