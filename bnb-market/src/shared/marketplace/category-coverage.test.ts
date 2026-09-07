import assert from "node:assert/strict";
import test from "node:test";
import { categoryCoverage, categoryCoverageGaps } from "./category-coverage.ts";

test("reports all four buyer outcomes without treating descriptions as provider categories", () => {
  const coverage = categoryCoverage([
    { category: "rebalancing", outcomeMatches: [{ category: "rebalancing", source: "provider", reason: "declared" }] },
    { category: null, outcomeMatches: [{ category: "grid-trading", source: "description", reason: "matched" }] },
  ]);
  assert.deepEqual(coverage.map((entry) => entry.matches), [1, 1, 0, 0]);
  assert.equal(coverage[0].providerCategories, 1);
  assert.equal(coverage[1].providerCategories, 0);
  assert.equal(coverage[1].descriptionMatches, 1);
  assert.deepEqual(categoryCoverageGaps(coverage), ["yield-optimisation", "health-factor"]);
});

test("does not invent coverage for an empty live catalog", () => {
  const coverage = categoryCoverage([]);
  assert.equal(coverage.length, 4);
  assert.deepEqual(categoryCoverageGaps(coverage), ["rebalancing", "grid-trading", "yield-optimisation", "health-factor"]);
});
