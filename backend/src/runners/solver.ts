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

/// Five-tier solver curve. Accuracy climbs and per-puzzle wall-clock shrinks
/// so a maxed t4 agent answers fast AND right. Tier 0 still beats random.
const ACCURACY = [0.5, 0.6, 0.7, 0.8, 0.92];
const MS_PER_PUZZLE = [1600, 1200, 900, 600, 350];

function simulateSolve(puzzles: Puzzle[], tier: number, seed: number) {
  const r = seededRng(seed);
  const idx = Math.min(Math.max(tier, 0), 4);
  const acc = ACCURACY[idx]!;
  const msPer = MS_PER_PUZZLE[idx]!;
  let correct = 0;
  let elapsedMs = 0;
  // Per-puzzle outcome so the live stage can render a grid of cells, one per
  // puzzle, lit when the agent got that puzzle right. Deterministic for a
  // given (contestId, agentId) so every preview frame agrees with the final.
  const perPuzzle: boolean[] = [];
  // Per-puzzle wall-clock so the live stage can rank agents by "fastest" when
  // accuracy ties. Also deterministic.
  const perPuzzleMs: number[] = [];
  for (const p of puzzles) {
    const got = r() < acc ? p.answer : (p.answer + 1 + pick(r, p.choices - 1)) % p.choices;
    const isCorrect = got === p.answer;
    if (isCorrect) correct++;
    perPuzzle.push(isCorrect);
    const thisMs = Math.round(msPer * (0.7 + 0.6 * r()));
    perPuzzleMs.push(thisMs);
    elapsedMs += thisMs;
  }
  return { correct, total: puzzles.length, elapsedMs, perPuzzle, perPuzzleMs };
}

export class SolverRunner implements Runner {
  readonly kind = "solver" as const;
  constructor(private readonly puzzleCount = 5) {}

  async run(contestId: number, entries: ContestEntryInput[]): Promise<AgentResult[]> {
    const puzzles = generatePuzzles(contestId, this.puzzleCount);
    const puzzleKinds = puzzles.map((p) => p.kind);
    return entries.map((e) => {
      const res = simulateSolve(puzzles, e.tier, contestId * 1000 + e.agentId);
      const { perPuzzle, perPuzzleMs, ...detail } = res;
      return {
        agentId: e.agentId,
        operator: e.operator,
        score: solverScore(res),
        detail: { ...detail, puzzles: puzzles.length },
        progress: {
          kind: "solver" as const,
          correct: perPuzzle,
          total: puzzles.length,
          perPuzzleMs,
          puzzleKinds,
        },
      };
    });
  }
}
