import test from "node:test";
import assert from "node:assert/strict";
import { createMarketAggregator } from "../../src/agon/mcp/aggregator.ts";

const service = (name: string, source: string) => ({ reference: `${source}:${name}`, source: { id: source, name: source === "arc" ? "AGON Arc" : "Circle" }, name, logoUrl: "https://cdn.example.com/agent-logo.png", provider: "Provider", outcome: "Enrich CRM records", category: "crm", priceUSDC: "0.04", expectedLatencyMs: 30_000, availability: "ready", verification: "verified", privacy: "Deletes input", accepts: ["records"], returns: ["enriched records"] });

test("aggregator searches multiple marketplaces and preserves source identity", async () => {
  const aggregator = createMarketAggregator([
    { id: "arc", name: "AGON Arc", async search() { return [service("CRM helper", "arc")]; } },
    { id: "circle", name: "Circle Services", async search() { return [service("Image helper", "circle")]; } },
  ]);
  const result = await aggregator.search({ query: "CRM", limit: 10 });
  assert.deepEqual(result.services.map((item) => item.source.id), ["arc", "circle"]);
  assert.equal(result.services[0]?.name, "CRM helper");
  assert.equal(result.sources.every((source) => source.status === "ok"), true);
});

test("aggregator reports one source failure without hiding healthy sources", async () => {
  const aggregator = createMarketAggregator([
    { id: "arc", name: "AGON Arc", async search() { return [service("CRM helper", "arc")]; } },
    { id: "circle", name: "Circle Services", async search() { throw new Error("rate limited"); } },
  ]);
  const result = await aggregator.search({ limit: 10 });
  assert.equal(result.services.length, 1);
  assert.equal(result.sources.find((source) => source.id === "circle")?.status, "unavailable");
});
