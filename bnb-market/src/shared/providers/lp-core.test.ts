import { test } from "node:test";
import assert from "node:assert/strict";
import { analyseRange, meanTick, parseLpInput } from "./lp-core.ts";

const input = { positionId: "1", halfWidthSteps: 10, maxDeviationTicks: 100 };
const state = { tick: 0, tickLower: -100, tickUpper: 100, tickSpacing: 10, liquidity: "90071992547409931234", poolLiquidity: "90071992547409931235", twapTick: 0 };
test("upper tick is excluded, lower tick is included", () => {
  assert.equal(analyseRange(input, { ...state, tick: 100, twapTick: 100 }).positionState, "above_range");
  assert.equal(analyseRange(input, { ...state, tick: -100, twapTick: -100 }).positionState, "in_range");
});
test("negative TWAP rounds down rather than toward zero", () => {
  assert.equal(meanTick(0n, -601n, 600), -2);
  assert.equal(meanTick(0n, 601n, 600), 1);
});
test("a proposal uses TWAP and tick alignment, never spot rounding", () => {
  const report = analyseRange(input, { ...state, tick: -101, twapTick: -109 });
  assert.deepEqual(report.proposedRange, { tickLower: -210, tickUpper: -10 });
  assert.equal(report.action, "review_rebalance");
});
test("missing oracle or excessive spot deviation cannot produce a proposal", () => {
  assert.equal(analyseRange(input, { ...state, twapTick: null }).action, "blocked");
  assert.equal(analyseRange(input, { ...state, tick: 101 }).proposedRange, null);
});
test("empty positions and inactive pools cannot look like a live strategy", () => {
  assert.equal(analyseRange(input, { ...state, liquidity: "0" }).action, "blocked");
  assert.equal(analyseRange(input, { ...state, poolLiquidity: "0" }).action, "blocked");
});
test("unsafe numeric IDs, oversized integers and injected options are refused", () => {
  for (const bad of [1, "01", "-1", "1e2", (2n ** 256n).toString()]) assert.throws(() => parseLpInput({ ...input, positionId: bad }));
  assert.throws(() => parseLpInput({ ...input, rpcUrl: "http://127.0.0.1" }));
  assert.throws(() => parseLpInput({ ...input, halfWidthSteps: 0 }));
  assert.throws(() => parseLpInput({ ...input, maxDeviationTicks: 10001 }));
  assert.equal(parseLpInput({ ...input, positionId: "9007199254740993" }).positionId, "9007199254740993");
});
test("invalid spacing, unaligned range and protocol boundaries are refused", () => {
  assert.throws(() => analyseRange(input, { ...state, tickSpacing: 0 }));
  assert.throws(() => analyseRange(input, { ...state, tickLower: -101 }));
  assert.equal(analyseRange(input, { ...state, tick: 887271, twapTick: 887271 }).action, "blocked");
});
test("in-range report makes no trade and no profitability claim", () => {
  const result = analyseRange(input, state);
  assert.equal(result.action, "hold"); assert.equal(result.proposedRange, null);
  assert.equal(result.executed, false);
});
