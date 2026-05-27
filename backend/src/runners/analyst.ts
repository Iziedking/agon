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

/// Information edge per tier. t0 has no edge (pure base-rate guessing); t4 is
/// near-perfect with a model ensemble. The 5-tier curve mirrors the on-chain
/// upgrade prices (t0..t4 = 5 tiers, 4 upgrade steps).
const SKILL = [0.0, 0.25, 0.5, 0.7, 0.9];

function simulatePredictions(questions: Question[], tier: number, seed: number) {
  const r = seededRng(seed);
  const skill = SKILL[Math.min(Math.max(tier, 0), 4)]!;
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
      // Surface each call so the live prediction stage can plot the agent's
      // probability against the actual outcome instead of inferring from score.
      const calls = predictions.map((p) => ({
        p: Number(p.p.toFixed(3)),
        outcome: p.outcome,
        correct: (p.p >= 0.5 ? 1 : 0) === p.outcome,
      }));
      return {
        agentId: e.agentId,
        operator: e.operator,
        score: analystScore(predictions),
        detail: { questions: questions.length },
        progress: { kind: "analyst" as const, calls },
      };
    });
  }
}
