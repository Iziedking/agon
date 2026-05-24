import type { AgentResult, ContestEntryInput, Runner } from "./types.js";
import { pick, seededRng } from "./rng.js";
import { solverScore } from "../scoring/index.js";

/// SolverRunner: every agent in a contest faces the same seeded puzzle set
/// (so results are comparable and reproducible), and is graded on correctness
/// and speed. v0 ships three puzzle families. The per-agent solve is simulated
/// from tier here; later this delegates to the real agent runtime.

type Puzzle =
  | { kind: "gas"; prompt: string; choices: number; answer: number }
  | { kind: "classify"; prompt: string; choices: number; answer: number }
  | { kind: "route"; prompt: string; choices: number; answer: number };

export function generatePuzzles(seed: number, count: number): Puzzle[] {
  const r = seededRng(seed);
  const puzzles: Puzzle[] = [];
  for (let i = 0; i < count; i++) {
    const kind = pick(r, 3);
    if (kind === 0) {
      const opts = Array.from({ length: 4 }, () => 10_000 + pick(r, 90_000));
      const answer = opts.indexOf(Math.min(...opts));
      puzzles.push({ kind: "gas", prompt: "Pick the lowest-gas option", choices: opts.length, answer });
    } else if (kind === 1) {
      const labels = 4;
      puzzles.push({ kind: "classify", prompt: "Classify the transaction", choices: labels, answer: pick(r, labels) });
    } else {
      const routes = 3;
      puzzles.push({ kind: "route", prompt: "Pick the best-output route", choices: routes, answer: pick(r, routes) });
    }
  }
  return puzzles;
}

const ACCURACY = [0.55, 0.78, 0.92];
const MS_PER_PUZZLE = [1400, 900, 500];

function simulateSolve(puzzles: Puzzle[], tier: number, seed: number) {
  const r = seededRng(seed);
  const idx = Math.min(Math.max(tier, 0), 2);
  const acc = ACCURACY[idx]!;
  const msPer = MS_PER_PUZZLE[idx]!;
  let correct = 0;
  let elapsedMs = 0;
  for (const p of puzzles) {
    const got = r() < acc ? p.answer : (p.answer + 1 + pick(r, p.choices - 1)) % p.choices;
    if (got === p.answer) correct++;
    elapsedMs += Math.round(msPer * (0.7 + 0.6 * r()));
  }
  return { correct, total: puzzles.length, elapsedMs };
}

export class SolverRunner implements Runner {
  readonly kind = "solver" as const;
  constructor(private readonly puzzleCount = 5) {}

  async run(contestId: number, entries: ContestEntryInput[]): Promise<AgentResult[]> {
    const puzzles = generatePuzzles(contestId, this.puzzleCount);
    return entries.map((e) => {
      const res = simulateSolve(puzzles, e.tier, contestId * 1000 + e.agentId);
      return {
        agentId: e.agentId,
        operator: e.operator,
        score: solverScore(res),
        detail: { ...res, puzzles: puzzles.length },
      };
    });
  }
}
