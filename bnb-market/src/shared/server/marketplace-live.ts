import type { BnbChain, AgentSummary, CatalogSource, EndpointProof, MarketplaceLiveStatus } from "../types.ts";
import { categoryCoverage, liveCategoryCoverage, liveCategoryCoverageGaps } from "../marketplace/category-coverage.ts";
import { catalog, probeAgent } from "./catalog.ts";

const MAX_AGENTS_PER_GOAL = 5;
const MAX_PROBES = 20;
const MAX_CATALOG_PAGES = 10;
const REQUIRED_CATEGORIES = ["rebalancing", "grid-trading", "yield-optimisation", "health-factor"] as const;

function probeCandidates(agents: readonly AgentSummary[]): AgentSummary[] {
  const selected = new Map<string, AgentSummary>();
  for (const category of REQUIRED_CATEGORIES) {
    const matches = agents
      .filter((agent) => agent.outcomeMatches.some((match) => match.category === category))
      .sort((left, right) => Number(right.category === category) - Number(left.category === category) || left.id.localeCompare(right.id));
    for (const agent of matches.slice(0, MAX_AGENTS_PER_GOAL)) selected.set(agent.id, agent);
  }
  return [...selected.values()].slice(0, MAX_PROBES);
}

async function liveCatalog(chainId: BnbChain) {
  const items = new Map<string, AgentSummary>();
  const warnings: string[] = [];
  let offset = 0;
  let source: CatalogSource = "8004scan";
  let total = 0;
  for (let pageNumber = 0; pageNumber < MAX_CATALOG_PAGES; pageNumber += 1) {
    const page = await catalog(chainId, offset);
    source = page.source;
    total = page.total;
    warnings.push(...page.warnings);
    for (const item of page.items) items.set(item.id, item);
    const agents = [...items.values()];
    const enoughCandidates = REQUIRED_CATEGORIES.every((category) =>
      agents.some((agent) => agent.outcomeMatches.some((match) => match.category === category)));
    if (page.nextOffset === null || enoughCandidates) break;
    offset = page.nextOffset;
  }
  return { items: [...items.values()], warnings, source, total };
}

export async function marketplaceLiveStatus(chainId: BnbChain): Promise<MarketplaceLiveStatus> {
  const page = await liveCatalog(chainId);
  const candidates = probeCandidates(page.items);
  const proofs: Array<Pick<EndpointProof, "agentId" | "status" | "supportedCategories">> = [];
  const warnings = [...page.warnings];

  const checked = await Promise.all(candidates.map(async (agent) => {
    try {
      return await probeAgent(chainId, agent.id);
    } catch (error) {
      warnings.push(`${agent.id}: live check could not be completed.`);
      if (error instanceof Error) console.warn(JSON.stringify({ event: "bnb_marketplace_probe_failed", chainId, agentId: agent.id, reason: error.message }));
      return { agentId: agent.id, status: "unavailable" as const, supportedCategories: [] };
    }
  }));
  proofs.push(...checked);

  const liveCoverage = liveCategoryCoverage(page.items, proofs);
  return {
    chainId,
    catalogSource: page.source,
    checkedAt: new Date().toISOString(),
    indexedProfiles: page.total,
    loadedProfiles: page.items.length,
    attemptedAgents: candidates.length,
    coverage: categoryCoverage(page.items),
    liveCoverage,
    gaps: liveCategoryCoverageGaps(liveCoverage),
    status: !page.items.length ? "empty" : liveCoverage.some((entry) => entry.reachable > 0) ? "available" : "incomplete",
    warnings,
  };
}
