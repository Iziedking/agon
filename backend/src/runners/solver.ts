import type { AgentResult, ContestEntryInput, Runner } from "./types.js";
import { seededRng, pick } from "./rng.js";
import { solverScore } from "../scoring/index.js";
import { generatePuzzles, type Puzzle, type PuzzleKind } from "./puzzles/index.js";
import { judge } from "./judge.js";
import {
  callModel,
  llmConfigured,
  recordLlmRun,
  DailyKillError,
  type CallResult,
} from "./llm/client.js";
import { resolveRuntimeParams, type RuntimeParams } from "./llm/tierConfig.js";

/// SolverRunner: every agent in a contest faces the same seeded puzzle set
/// (deterministic from contestId), and is graded on correctness and speed.
///
/// Tier no longer swaps the model. Every LLM-enabled tier uses the same
/// model (config.llm.model, default Haiku 4.5). Tier defines what TOOLS
/// the agent can attach to the call, how many tokens it can spend, and
/// whether it gets retries. The cost ladder is:
///   tier 0/1 - $0 (no LLM, random guess; LUCK still nudges)
///   tier 2   - ~$0.002/puzzle (LLM only)
///   tier 3   - ~$0.005/puzzle (LLM + code_execution)
///   tier 4   - ~$0.02/puzzle  (LLM + code_execution + web_search)
///
/// Fallback: when ANTHROPIC_API_KEY is unset (local dev, CI), every agent
/// drops to the random-guess path regardless of tier. The coordinator
/// pipeline doesn't notice; the demo loses tier differentiation locally
/// but the contracts and broadcast keep working.

const FALLBACK_ACCURACY = [0.5, 0.55, 0.62, 0.7, 0.8];
const FALLBACK_MS_PER_PUZZLE = [1800, 1500, 1200, 900, 700];

/// Re-exported so existing imports of `generatePuzzles` from this module
/// keep working.
export { generatePuzzles } from "./puzzles/index.js";

interface SolveOutcome {
  correct: number;
  total: number;
  elapsedMs: number;
  perPuzzle: boolean[];
  perPuzzleMs: number[];
  /// Total $ this agent spent in LLM calls (0 on guess and fallback paths).
  costUsd: number;
}

export class SolverRunner implements Runner {
  readonly kind = "solver" as const;
  constructor(private readonly puzzleCount = 5) {}

  async run(contestId: number, entries: ContestEntryInput[]): Promise<AgentResult[]> {
    const puzzles = generatePuzzles(contestId, this.puzzleCount);
    const puzzleKinds = puzzles.map((p) => p.kind);
    const real = llmConfigured();

    const results = await Promise.all(
      entries.map(async (e) => {
        const params = real ? await resolveRuntimeParams(e.agentId, e.tier).catch(() => null) : null;
        const solve = params
          ? await runWithCapabilities(contestId, e, puzzles, params)
          : guessOnlySolve(puzzles, e.tier, contestId * 1000 + e.agentId);

        const { perPuzzle, perPuzzleMs, costUsd: _unused, ...detail } = solve;
        return {
          agentId: e.agentId,
          operator: e.operator,
          score: solverScore(solve),
          detail: { ...detail, puzzles: puzzles.length },
          progress: {
            kind: "solver" as const,
            correct: perPuzzle,
            total: puzzles.length,
            perPuzzleMs,
            puzzleKinds,
          },
        };
      }),
    );

    return results;
  }
}

/// Runs the per-agent solve honoring the tier's capability gates. Tier 0/1
/// (llmEnabled=false) skip the LLM and just guess; tier 2+ call the model
/// with the tier-attached tools. Audit rows are written for every puzzle
/// regardless of path so the demo "see the real solves" surface has
/// complete coverage.
async function runWithCapabilities(
  contestId: number,
  entry: ContestEntryInput,
  puzzles: Puzzle[],
  params: RuntimeParams,
): Promise<SolveOutcome> {
  if (!params.llmEnabled) {
    return runGuessPath(contestId, entry, puzzles, params);
  }
  return runLlmPath(contestId, entry, puzzles, params);
}

/// Tier 0 / Tier 1: no LLM call. Random guess per puzzle with kind-aware
/// probability (4-way classify => 25% baseline, 3-way routing => 33%, etc.).
/// LUCK adds a small additive bonus on tier 1. Audit rows still get
/// written so the contest detail page can show "agent guessed" alongside
/// "agent ran the calculator" for narrative comparison.
async function runGuessPath(
  contestId: number,
  entry: ContestEntryInput,
  puzzles: Puzzle[],
  params: RuntimeParams,
): Promise<SolveOutcome> {
  const r = seededRng(contestId * 1000 + entry.agentId);
  const perPuzzle: boolean[] = [];
  const perPuzzleMs: number[] = [];
  let correct = 0;
  let elapsedMs = 0;

  for (let i = 0; i < puzzles.length; i++) {
    const puzzle = puzzles[i]!;
    const baseP = baselineGuessProb(puzzle.kind);
    const p = Math.min(1, baseP + params.luckBonus);
    const ok = r() < p;
    if (ok) correct++;
    perPuzzle.push(ok);
    const ms = 800 + Math.round(400 * r());
    perPuzzleMs.push(ms);
    elapsedMs += ms;

    await recordLlmRun({
      contestId,
      agentId: entry.agentId,
      operator: entry.operator,
      roundIdx: 0,
      puzzleIdx: i,
      kind: "solver",
      model: "guess",
      prompt: puzzle.prompt,
      response: ok ? puzzle.expected : "(guess)",
      expected: puzzle.expected,
      verdict: ok ? "correct" : "wrong",
      latencyMs: ms,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    }).catch(() => { /* audit row best-effort */ });
  }

  return { correct, total: puzzles.length, elapsedMs, perPuzzle, perPuzzleMs, costUsd: 0 };
}

function baselineGuessProb(kind: PuzzleKind): number {
  // What a uniform random guess gets right by chance.
  switch (kind) {
    case "classify": return 0.25; // 4 labels
    case "routing":  return 0.33; // 3 pools
    case "arithmetic":
    case "pattern":
    case "wordcount":
      return 0.05; // essentially zero on free-form integer answers
  }
}

/// Tier 2+: real LLM call with the tier's attached tools.
async function runLlmPath(
  contestId: number,
  entry: ContestEntryInput,
  puzzles: Puzzle[],
  params: RuntimeParams,
): Promise<SolveOutcome> {
  const perPuzzle: boolean[] = [];
  const perPuzzleMs: number[] = [];
  let correct = 0;
  let elapsedMs = 0;
  let costUsd = 0;

  for (let i = 0; i < puzzles.length; i++) {
    const puzzle = puzzles[i]!;
    const systemPrompt = buildSystemPrompt(params);
    const userPrompt = puzzle.prompt;

    let response = "";
    let extracted = "";
    let verdict: "correct" | "wrong" | "skipped" | "error" = "skipped";
    let latencyMs = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let cost = 0;

    const attempts = 1 + params.retries;
    let didCall = false;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const out: CallResult = await callModel({
          model: params.model,
          systemPrompt,
          userPrompt,
          maxTokens: params.maxTokens,
          temperature: params.temperature,
          tools: params.tools,
        });
        didCall = true;
        response = out.text;
        latencyMs += out.latencyMs;
        inputTokens += out.inputTokens;
        outputTokens += out.outputTokens;
        cost += out.costUsd;

        const v = judge(puzzle, out.text);
        extracted = v.extracted;
        verdict = v.verdict;
        if (verdict === "correct" || verdict === "wrong") break; // verdict known; no retry
        // verdict === "error" -> try again
      } catch (err) {
        verdict = "error";
        response = err instanceof Error ? err.message : String(err);
        if (err instanceof DailyKillError) {
          verdict = "skipped";
          break;
        }
      }
    }

    if (verdict === "correct") correct++;
    perPuzzle.push(verdict === "correct");
    perPuzzleMs.push(latencyMs || 1500);
    elapsedMs += latencyMs || 1500;
    costUsd += cost;

    await recordLlmRun({
      contestId,
      agentId: entry.agentId,
      operator: entry.operator,
      roundIdx: 0,
      puzzleIdx: i,
      kind: "solver",
      model: params.model,
      prompt: userPrompt,
      response,
      expected: puzzle.expected,
      verdict,
      latencyMs,
      inputTokens,
      outputTokens,
      costUsd: cost,
    }).catch(() => { /* audit row best-effort */ });

    if (!didCall && verdict === "skipped") {
      // Daily kill: stop calling for the rest of this agent's puzzles;
      // remaining puzzles count as wrong so the round completes.
      for (let j = i + 1; j < puzzles.length; j++) {
        perPuzzle.push(false);
        perPuzzleMs.push(0);
      }
      break;
    }
  }

  // LUCK on near-ties: shave elapsedMs slightly so two tied-correct agents
  // are split by their LUCK level. Doesn't lie about correctness.
  if (params.luckBonus > 0) {
    elapsedMs = Math.max(1, Math.round(elapsedMs * (1 - params.luckBonus * 0.1)));
  }

  return { correct, total: puzzles.length, elapsedMs, perPuzzle, perPuzzleMs, costUsd };
}

function buildSystemPrompt(params: RuntimeParams): string {
  const lines = [
    "You are an ArcRun competing agent solving a small puzzle.",
    "Output only the answer in the requested format. No extra prose.",
  ];
  if (params.tools.some((t) => t.name === "code_execution")) {
    lines.push("Use the code_execution tool when arithmetic or counting is involved.");
  }
  if (params.tools.some((t) => t.name === "web_search")) {
    lines.push("Use web_search only when the puzzle requires real-world knowledge you don't already have.");
  }
  lines.push("The LAST line of your output must be only the final answer.");
  return lines.join(" ");
}

/// Fallback path used when ANTHROPIC_API_KEY is unset. Synthetic curve so
/// the coordinator still produces a contest result without the user
/// configuring a paid API key. Roughly mirrors the tier accuracy curve so
/// the standings still make sense on a local dev box.
function guessOnlySolve(puzzles: Puzzle[], tier: number, seed: number): SolveOutcome {
  const r = seededRng(seed);
  const idx = Math.min(Math.max(tier, 0), 4);
  const acc = FALLBACK_ACCURACY[idx]!;
  const msPer = FALLBACK_MS_PER_PUZZLE[idx]!;
  let correct = 0;
  let elapsedMs = 0;
  const perPuzzle: boolean[] = [];
  const perPuzzleMs: number[] = [];
  for (const _ of puzzles) {
    const ok = r() < acc;
    if (ok) correct++;
    perPuzzle.push(ok);
    const thisMs = Math.round(msPer * (0.7 + 0.6 * r()));
    perPuzzleMs.push(thisMs);
    elapsedMs += thisMs;
  }
  // satisfy unused-var lint: pick() exists in this module for legacy code
  void pick;
  return { correct, total: puzzles.length, elapsedMs, perPuzzle, perPuzzleMs, costUsd: 0 };
}
