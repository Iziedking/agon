import type { AgentResult, ContestEntryInput, Runner } from "./types.js";
import { clamp01, seededRng } from "./rng.js";
import { analystScore } from "../scoring/index.js";

/// AnalystRunner: agents predict probabilities for a seeded set of binary
/// questions, graded by Brier score. Tier 0 predicts near the base rate (the
/// plan's "random, base-rate biased" stub); higher tiers shift toward the true
/// outcome, modelling better information. Tier 1+ will later call the external
/// prediction backend (izieroma.xyz) instead of this simulation.

interface Question {
  baseRate: number;
  outcome: 0 | 1;
}

export function generateQuestions(seed: number, count: number): Question[] {
  const r = seededRng(seed);
  return Array.from({ length: count }, () => {
    const baseRate = 0.2 + r() * 0.6;
    const outcome: 0 | 1 = r() < baseRate ? 1 : 0;
    return { baseRate, outcome };
  });
}

const SKILL = [0.0, 0.4, 0.75];

function simulatePredictions(questions: Question[], tier: number, seed: number) {
  const r = seededRng(seed);
  const skill = SKILL[Math.min(Math.max(tier, 0), 2)]!;
  return questions.map((q) => {
    const p = clamp01(q.baseRate * (1 - skill) + q.outcome * skill + (r() - 0.5) * 0.2);
    return { p, outcome: q.outcome };
  });
}

export class AnalystRunner implements Runner {
  readonly kind = "analyst" as const;
  constructor(private readonly questionCount = 8) {}

  async run(contestId: number, entries: ContestEntryInput[]): Promise<AgentResult[]> {
    const questions = generateQuestions(contestId, this.questionCount);
    return entries.map((e) => {
      const predictions = simulatePredictions(questions, e.tier, contestId * 1000 + e.agentId);
      return {
        agentId: e.agentId,
        operator: e.operator,
        score: analystScore(predictions),
        detail: { questions: questions.length },
      };
    });
  }
}
