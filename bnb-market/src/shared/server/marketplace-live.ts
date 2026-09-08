import type { BnbChain, AgentSummary, EndpointProof, MarketplaceLiveStatus } from "../types.ts";
import { categoryCoverage, liveCategoryCoverage, liveCategoryCoverageGaps } from "../marketplace/category-coverage.ts";
import { catalog, probeAgent } from "./catalog.ts";

const MAX_AGENTS_PER_GOAL = 3;
const MAX_PROBES = 12;

function probeCandidates(agents: readonly AgentSummary[]): AgentSummary[] {
  const selected = new Map<string, AgentSummary>();
  for (const category of ["rebalancing", "grid-trading", "yield-optimisation", "health-factor"] as const) {
    const matches = agents
      .filter((agent) => agent.outcomeMatches.some((match) => match.category === category))
      .sort((left, right) => Number(right.category === category) - Number(left.category === category) || left.id.localeCompare(right.id));
    for (const agent of matches.slice(0, MAX_AGENTS_PER_GOAL)) selected.set(agent.id, agent);
  }
  return [...selected.values()].slice(0, MAX_PROBES);
}

export async function marketplaceLiveStatus(chainId: BnbChain): Promise<MarketplaceLiveStatus> {
  const page = await catalog(chainId, 0);
  const candidates = probeCandidates(page.items);
  const proofs: Array<Pick<EndpointProof, "agentId" | "status" | "supportedCategories">> = [];
  const warnings = [...page.warnings];

  for (const agent of candidates) {
    try {
      proofs.push(await probeAgent(chainId, agent.id));
    } catch (error) {
      proofs.push({ agentId: agent.id, status: "unavailable", supportedCategories: [] });
      warnings.push(`${agent.id}: live check could not be completed.`);
      if (error instanceof Error) console.warn(JSON.stringify({ event: "bnb_marketplace_probe_failed", chainId, agentId: agent.id, reason: error.message }));
    }
  }

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
