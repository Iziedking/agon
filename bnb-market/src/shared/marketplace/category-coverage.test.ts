import assert from "node:assert/strict";
import test from "node:test";
import { categoryCoverage, categoryCoverageGaps, liveCategoryCoverage, liveCategoryCoverageGaps } from "./category-coverage.ts";

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

test("separates responding services from indexed category matches", () => {
  const agents = [
    { id: "2177", category: "rebalancing" as const, outcomeMatches: [{ category: "rebalancing" as const, source: "provider" as const, reason: "declared" }] },
    { id: "2202", category: null, outcomeMatches: [{ category: "grid-trading" as const, source: "description" as const, reason: "matched" }] },
    { id: "2175", category: null, outcomeMatches: [{ category: "yield-optimisation" as const, source: "description" as const, reason: "matched" }] },
  ];
  const coverage = liveCategoryCoverage(agents, [
    { agentId: "2177", status: "reachable" },
    { agentId: "2202", status: "unavailable" },
  ]);
  assert.deepEqual(coverage.map((entry) => entry.reachable), [1, 0, 0, 0]);
  assert.equal(coverage[1].attempted, 1);
  assert.deepEqual(liveCategoryCoverageGaps(coverage), ["grid-trading", "yield-optimisation", "health-factor"]);
});
