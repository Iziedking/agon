import { CATEGORY_GUIDANCE, CATEGORIES, type AgentSummary, type Category } from "../types.ts";

export type CategoryCoverage = {
  id: Category;
  label: string;
  question: string;
  description: string;
  matches: number;
  providerCategories: number;
  descriptionMatches: number;
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
