import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../MarketExperience.tsx", import.meta.url), "utf8");

test("category controls update the current market without a document reload", () => {
  const categoryNavigation = source.match(/<nav aria-label="Choose an agent category"[\s\S]*?<\/nav>/)?.[0];
  assert.ok(categoryNavigation, "Category navigation is present");
  assert.match(categoryNavigation, /<button/);
  assert.match(categoryNavigation, /onClick=/);
  assert.doesNotMatch(categoryNavigation, /<a/);
});

test("discovery follows one category-first path", () => {
  const discovery = source.match(/export function MarketDiscovery[\s\S]*?\n}\n\nfunction ServiceFacts/)?.[0];
  assert.ok(discovery, "Market discovery is present");
  assert.match(discovery, /Step 1/);
  assert.match(discovery, /Choose what you need/);
  assert.match(discovery, /Step 2/);
  assert.match(discovery, /Choose an agent/);
  assert.match(discovery, /readMarketplaceLiveStatus/);
  assert.doesNotMatch(discovery, /Search agents/);
  assert.doesNotMatch(discovery, /Sort loaded results/);
  assert.doesNotMatch(discovery, /Include other services/);
  assert.doesNotMatch(discovery, /Find responding agents/);
  assert.doesNotMatch(discovery, /Compare selection/);
  assert.doesNotMatch(discovery, /Load more agents/);
});

test("each discovery result has one primary next action", () => {
  const agentRow = source.match(/function AgentRow[\s\S]*?\n}\n\nexport function MarketDiscovery/)?.[0];
  assert.ok(agentRow, "Agent row is present");
  assert.match(agentRow, /View agent →/);
  assert.doesNotMatch(agentRow, /Compare/);
});
