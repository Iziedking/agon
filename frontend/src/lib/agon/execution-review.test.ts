import assert from "node:assert/strict";
import test from "node:test";

import { executionReadinessLabel, executionReadinessTone, formatExecutionTimestamp, formatUSDCBaseUnits } from "./execution-review.ts";

test("formats integer USDC base units without floating point math", () => {
  assert.equal(formatUSDCBaseUnits("0"), "0 USDC");
  assert.equal(formatUSDCBaseUnits("1"), "0.000001 USDC");
  assert.equal(formatUSDCBaseUnits("1000"), "0.001 USDC");
  assert.equal(formatUSDCBaseUnits("12500000"), "12.5 USDC");
  assert.equal(formatUSDCBaseUnits("not-a-number"), "not-a-number base units");
});

test("maps readiness states to honest UI labels and tones", () => {
  assert.equal(executionReadinessLabel("approval_required"), "APPROVAL REQUIRED");
  assert.equal(executionReadinessLabel("approved_but_disabled"), "APPROVED · ADAPTER OFF");
  assert.equal(executionReadinessLabel("approval_expired"), "APPROVAL EXPIRED");
  assert.equal(executionReadinessTone("approval_required"), "warn");
  assert.equal(executionReadinessTone("approved_but_disabled"), "ok");
  assert.equal(executionReadinessTone("approval_expired"), "err");
});

test("keeps invalid timestamps visible and normalizes valid UTC timestamps", () => {
  assert.equal(formatExecutionTimestamp("not-a-date"), "not-a-date");
  assert.equal(formatExecutionTimestamp("2026-08-20T12:00:00.000Z"), "2026-08-20 12:00:00 UTC");
});
