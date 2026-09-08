import { CATEGORY_GUIDANCE, CATEGORIES, type AgentSummary, type Category, type EndpointProof } from "../types.ts";

export type CategoryCoverage = {
  id: Category;
  label: string;
  question: string;
  description: string;
  matches: number;
  providerCategories: number;
  descriptionMatches: number;
};

export type CategoryAvailability = {
  state: "responding" | "listed" | "matched" | "unavailable";
  label: "SERVICE RESPONDS" | "LISTED" | "MATCH FOUND" | "NOT AVAILABLE";
  detail: string;
};

export type LiveCategoryCoverage = CategoryCoverage & {
  attempted: number;
  reachable: number;
  unavailable: number;
  attemptedAgentIds: string[];
  reachableAgentIds: string[];
};

export function categoryCoverage(agents: readonly Pick<AgentSummary, "category" | "outcomeMatches">[]): CategoryCoverage[] {
  return CATEGORIES.map(({ id }) => {
    const matching = agents.filter((agent) => agent.outcomeMatches.some((match) => match.category === id));
    return {
      id,
      ...CATEGORY_GUIDANCE[id],
      matches: matching.length,
      providerCategories: matching.filter((agent) => agent.category === id).length,
      descriptionMatches: matching.filter((agent) => agent.outcomeMatches.some((match) => match.category === id && match.source === "description")).length,
    };
  });
}

export function categoryCoverageGaps(coverage: readonly CategoryCoverage[]): Category[] {
  return coverage.filter((entry) => entry.matches === 0).map((entry) => entry.id);
}

export function categoryAvailability(
  entry: CategoryCoverage,
  live?: Pick<LiveCategoryCoverage, "attempted" | "reachable">,
): CategoryAvailability {
  if (live?.reachable) return { state: "responding", label: "SERVICE RESPONDS", detail: "A matching service returned its current service details." };
  if (live?.attempted) return { state: "listed", label: "LISTED", detail: "A listed service needs another check." };
  if (entry.providerCategories) return { state: "listed", label: "LISTED", detail: "A provider has listed this goal." };
  if (entry.descriptionMatches) return { state: "matched", label: "MATCH FOUND", detail: "This goal appears in a service description." };
  return { state: "unavailable", label: "NOT AVAILABLE", detail: "No matching service is listed yet." };
}

export function liveCategoryCoverage(
  agents: readonly Pick<AgentSummary, "id" | "category" | "outcomeMatches">[],
  proofs: readonly Pick<EndpointProof, "agentId" | "status" | "supportedCategories">[],
): LiveCategoryCoverage[] {
  const proofByAgent = new Map(proofs.map((proof) => [proof.agentId, proof]));
  return categoryCoverage(agents).map((entry) => {
    const matchingAgents = agents.filter((agent) => agent.outcomeMatches.some((match) => match.category === entry.id));
    const attemptedAgents = matchingAgents.filter((agent) => proofByAgent.has(agent.id));
    const reachableAgents = attemptedAgents.filter((agent) => {
      const proof = proofByAgent.get(agent.id);
      return proof?.status === "reachable" && proof.supportedCategories.includes(entry.id);
    });
    return {
      ...entry,
      attempted: attemptedAgents.length,
      reachable: reachableAgents.length,
      unavailable: attemptedAgents.length - reachableAgents.length,
      attemptedAgentIds: attemptedAgents.map((agent) => agent.id),
      reachableAgentIds: reachableAgents.map((agent) => agent.id),
    };
  });
}

export function liveCategoryCoverageGaps(coverage: readonly LiveCategoryCoverage[]): Category[] {
  return coverage.filter((entry) => entry.reachable === 0).map((entry) => entry.id);
}
