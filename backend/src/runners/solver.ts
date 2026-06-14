import type { AgentResult, ContestEntryInput, Runner } from "./types.js";
import { seededRng, pick } from "./rng.js";
import { solverScore } from "../scoring/index.js";
import { effectiveStrength, solverTraitAbilities, type StrengthBreakdown } from "../scoring/strength.js";
import { getLoadout } from "../auth/loadouts.js";
import { generatePuzzles, difficultyForTier, type Puzzle, type PuzzleKind } from "./puzzles/index.js";
import { judge } from "./judge.js";
import {
  callModel,
  llmConfigured,
  recordLlmRun,
  readExistingRuns,
  DailyKillError,
  type CallResult,
} from "./llm/client.js";
import { resolveRuntimeParams, loadAgentStats, type RuntimeParams } from "./llm/tierConfig.js";
import { getTierPool, type TierPool } from "../coordinator/tierPools.js";
import { paidAgentResearch, summarizeNews } from "../nanopayments/research.js";
import { config } from "../config/index.js";
import { extractSearchTerm } from "./puzzles/research.js";

/// Maps a puzzle kind to its preferred x402 research endpoint. Returning null
/// means the runner skips the research-spend step for that puzzle. The
/// research family points at NANOPAY_PREDICTION_ENDPOINT (Predexon by
/// default) and pays per call, so the live stage shows real spend.
function researchEndpointFor(
  kind: PuzzleKind,
): { url: string; label: string } | null {
  const url = (() => {
    switch (kind) {
      case "research":
        // Research questions are answered from live web search (Exa) now,
        // not the Predexon market-count feed. Falls back to the quiz endpoint
        // since both point at Exa.
        return process.env.NANOPAY_RESEARCH_ENDPOINT ?? process.env.NANOPAY_QUIZ_ENDPOINT;
      case "quiz":
        return process.env.NANOPAY_QUIZ_ENDPOINT;
      case "classify":
        return process.env.NANOPAY_CLASSIFY_ENDPOINT;
      case "routing":
        return process.env.NANOPAY_ROUTING_ENDPOINT;
      default:
        return undefined;
    }
  })();
  if (!url) return null;
  const labelEnv =
    kind === "research"
      ? process.env.NANOPAY_RESEARCH_LABEL ?? process.env.NANOPAY_QUIZ_LABEL
      : process.env[`NANOPAY_${kind.toUpperCase()}_LABEL`];
  const label = labelEnv ?? "Exa web search";
  return { url, label };
}

/// Per-kind URL + payload shaper. Research puzzles bake the search term into
/// the URL as a query string (Predexon's GET routes 404 when params live in
/// the body). Exa's search endpoint takes a POST with a `query` body, so any
/// kind pointed at api.exa.ai reshapes the prompt into that envelope. Other
/// kinds keep the generic POST envelope until we hit them.
function shapeResearchCall(
  kind: PuzzleKind,
  baseUrl: string,
  prompt: string,
): { url: string; payload?: Record<string, unknown>; chain?: string } {
  if (kind === "research") {
    // Research now runs an Exa web search for the question's query term.
    const term = extractSearchTerm(prompt) ?? prompt.slice(0, 200);
    return { url: baseUrl, payload: { query: term, numResults: 3 }, chain: config.nanopay.researchChain };
  }
  if (baseUrl.includes("api.exa.ai")) {
    return {
      url: baseUrl,
      payload: { query: prompt.slice(0, 300), numResults: 3 },
      chain: config.nanopay.researchChain,
    };
  }
  return { url: baseUrl, payload: { question: prompt, kind } };
}

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
/// pipeline doesn't notice; tier differentiation is lost locally but the
/// contracts and broadcast keep working.

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
  /// Per-puzzle nanopayment spend in USDC 6-decimal as a string. Aligned 1:1
  /// with perPuzzle. "0" when no research-spend happened on that puzzle.
  spent?: string[];
  /// Per-puzzle endpoint label aligned with spent[]. Empty string for no spend.
  spentLabels?: string[];
  /// Per-puzzle x402 settlement tx hash (Base) aligned with spent[]. Empty
  /// string for no spend. Surfaced as a clickable explorer link on the stage.
  spentTx?: string[];
}

/// Streaming context for a live puzzle event. When present, the runner posts
/// puzzles in rounds (more puzzles, wider categories) and broadcasts a
/// standings frame after each round so the solve feed fills as the countdown
/// ticks, stopping at deadlineMs. Mirrors the scout swap race.
export interface SolverRunCtx {
  broadcast?: (message: unknown) => void;
  /// Stop starting new rounds after this epoch-ms (event end - 60s).
  deadlineMs?: number;
  source?: "contest" | "challenge";
  /// For contest frames, the real end time shown in the "endsAt" field.
  endsAtMs?: number;
}

const SOLVER_ROUND_PUZZLES = Number(process.env.SOLVER_ROUND_PUZZLES ?? "3");
const SOLVER_MAX_PUZZLES = Number(process.env.SOLVER_MAX_PUZZLES ?? "30");
const SOLVER_RACE_SECONDS = Number(process.env.SOLVER_RACE_SECONDS ?? "90");
const SOLVER_ROUND_DELAY_MS = Number(process.env.SOLVER_ROUND_DELAY_MS ?? "500");
const solverSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function emptyOutcome(): SolveOutcome {
  return {
    correct: 0,
    total: 0,
    elapsedMs: 0,
    perPuzzle: [],
    perPuzzleMs: [],
    costUsd: 0,
    spent: [],
    spentLabels: [],
    spentTx: [],
  };
}

/// Append one batch's outcome onto the agent's running total. spent/labels/tx
/// are padded to the batch length when a path omits them so all per-puzzle
/// arrays stay aligned with perPuzzle.
function mergeOutcome(acc: SolveOutcome, b: SolveOutcome): void {
  acc.correct += b.correct;
  acc.total += b.total;
  acc.elapsedMs += b.elapsedMs;
  acc.costUsd += b.costUsd;
  acc.perPuzzle.push(...b.perPuzzle);
  acc.perPuzzleMs.push(...b.perPuzzleMs);
  const pad = (arr: string[] | undefined, fill: string) =>
    arr && arr.length === b.perPuzzle.length ? arr : b.perPuzzle.map(() => fill);
  acc.spent!.push(...pad(b.spent, "0"));
  acc.spentLabels!.push(...pad(b.spentLabels, ""));
  acc.spentTx!.push(...pad(b.spentTx, ""));
}

/// Build the per-agent AgentResult from an accumulated solve. Shared by the
/// single-set and streamed paths. `source` selects the loadout namespace so
/// traits equipped for a challenge actually count (the bug the scout runner
/// also had).
async function buildSolverResult(
  contestId: number,
  entry: ContestEntryInput,
  solve: SolveOutcome,
  puzzleKinds: string[],
  puzzleCards: ReturnType<typeof toCards>,
  source: "contest" | "challenge",
): Promise<AgentResult> {
  const stats = await loadAgentStats(entry.agentId).catch(() => ({}));
  const equipped = await getLoadout(source, contestId, entry.agentId).catch(() => [] as string[]);
  const strength = effectiveStrength(entry.tier, stats, equipped, "solver");
  // Puzzle is a pure-skill contest: the agent that solves the most, fastest,
  // wins. We deliberately do NOT multiply the score by tier/training/traits
  // here (nor in the coordinator), so an upgrade can never override a clearly
  // better solve. Tier still matters because a higher tier solves more
  // correctly to begin with. The strength breakdown stays in detail for
  // display only. (Volume and prediction contests DO apply multipliers.)
  const rawScore = solverScore(solve);
  const finalScore = rawScore;
  const { perPuzzle, perPuzzleMs, costUsd: _unused, spent, spentLabels, spentTx, ...detail } = solve;
  return {
    agentId: entry.agentId,
    operator: entry.operator,
    score: finalScore,
    detail: {
      ...detail,
      puzzles: solve.total,
      rawScore,
      strength: {
        effective: Number(strength.effective.toFixed(2)),
        tierBase: strength.tierBase,
        training: Number(strength.training.toFixed(3)),
        traits: Number(strength.traits.toFixed(3)),
      },
    },
    progress: {
      kind: "solver" as const,
      correct: perPuzzle,
      total: solve.total,
      perPuzzleMs,
      puzzleKinds,
      puzzleCards,
      spent: spent ?? perPuzzle.map(() => "0"),
      spentLabels: spentLabels ?? perPuzzle.map(() => ""),
      spentTx: spentTx ?? perPuzzle.map(() => ""),
    },
  };
}

// Local alias so buildSolverResult's card param has a name without importing
// the type twice.
function toCards(puzzles: Puzzle[]) {
  return puzzles.map((p) => p.presentation);
}

export class SolverRunner implements Runner {
  readonly kind = "solver" as const;
  constructor(private readonly puzzleCount = 5) {}

  async run(contestId: number, entries: ContestEntryInput[], ctx?: SolverRunCtx): Promise<AgentResult[]> {
    // Difficulty tracks the strongest agent in the field: a tier-4 field (the
    // tier gate keeps weaker agents out of high-tier contests) draws the hard
    // set, a tier 0-1 field stays on easy recall. So a higher-graded contest
    // visibly puts its agents to harder work.
    const fieldTier = entries.length > 0 ? Math.max(...entries.map((e) => e.tier)) : 0;
    const difficulty = difficultyForTier(fieldTier);
    const real = llmConfigured();
    const source = ctx?.source ?? "contest";

    if (ctx?.broadcast) {
      return this.streamedSolve(contestId, entries, difficulty, real, source, ctx);
    }

    // Single-set path (contests, and any caller without a live ctx): one fixed
    // puzzle set scored once. puzzleCount is the wider default now.
    const puzzles = generatePuzzles(contestId, this.puzzleCount, difficulty);
    const puzzleKinds = puzzles.map((p) => p.kind);
    const puzzleCards = toCards(puzzles);
    return Promise.all(
      entries.map(async (e) => {
        const params = await resolveSolverParams(e.agentId, e.tier, source, contestId, real);
        const solve = params
          ? await runWithCapabilities(contestId, e, puzzles, params)
          : guessOnlySolve(puzzles, e.tier, contestId * 1000 + e.agentId);
        return buildSolverResult(contestId, e, solve, puzzleKinds, puzzleCards, source);
      }),
    );
  }

  /// Live path: post puzzles in rounds of SOLVER_ROUND_PUZZLES, each round a
  /// fresh seed so kinds widen as it runs. Every agent solves the batch, the
  /// cumulative standings broadcast after each round (the solve feed), and the
  /// loop stops at deadlineMs (event end - 60s) / SOLVER_RACE_SECONDS /
  /// SOLVER_MAX_PUZZLES, whichever first.
  private async streamedSolve(
    contestId: number,
    entries: ContestEntryInput[],
    difficulty: ReturnType<typeof difficultyForTier>,
    real: boolean,
    source: "contest" | "challenge",
    ctx: SolverRunCtx,
  ): Promise<AgentResult[]> {
    const params = new Map<number, RuntimeParams | null>();
    for (const e of entries) {
      params.set(e.agentId, await resolveSolverParams(e.agentId, e.tier, source, contestId, real));
    }

    const allKinds: string[] = [];
    const allCards = [] as ReturnType<typeof toCards>;
    const acc = new Map<number, SolveOutcome>();
    for (const e of entries) acc.set(e.agentId, emptyOutcome());

    const hardStop = Math.min(ctx.deadlineMs ?? Number.MAX_SAFE_INTEGER, Date.now() + SOLVER_RACE_SECONDS * 1000);

    const emit = async () => {
      if (!ctx.broadcast) return;
      const results = await Promise.all(
        entries.map((e) => buildSolverResult(contestId, e, acc.get(e.agentId)!, allKinds, allCards, source)),
      );
      const ranked = results
        .slice()
        .sort((a, b) => b.score - a.score)
        .map((r, i) => ({ rank: i + 1, agentId: r.agentId, operator: r.operator, score: Math.round(r.score), progress: r.progress }));
      const msg =
        source === "challenge"
          ? { type: "challenge_standings", challengeId: contestId, entries: ranked }
          : { type: "standings", contestId, endsAt: ctx.endsAtMs, entries: ranked };
      ctx.broadcast(msg);
    };

    await emit(); // empty board first, so the feed shows the field before puzzle 1

    let round = 0;
    while (Date.now() < hardStop && allKinds.length < SOLVER_MAX_PUZZLES) {
      const n = Math.min(SOLVER_ROUND_PUZZLES, SOLVER_MAX_PUZZLES - allKinds.length);
      // Distinct seed per round so kinds and items differ each round.
      const batch = generatePuzzles(contestId * 1009 + round, n, difficulty);
      const offset = allKinds.length;
      for (const e of entries) {
        if (Date.now() >= hardStop) break;
        const p = params.get(e.agentId) ?? null;
        const out = p
          ? p.llmEnabled
            ? await runLlmPath(contestId, e, batch, p, offset)
            : await runGuessPath(contestId, e, batch, p, offset)
          : guessOnlySolve(batch, e.tier, contestId * 1000 + e.agentId + offset);
        mergeOutcome(acc.get(e.agentId)!, out);
      }
      for (const p of batch) {
        allKinds.push(p.kind);
        allCards.push(p.presentation);
      }
      round++;
      await emit();
      if (SOLVER_ROUND_DELAY_MS > 0) await solverSleep(SOLVER_ROUND_DELAY_MS);
    }

    return Promise.all(
      entries.map((e) => buildSolverResult(contestId, e, acc.get(e.agentId)!, allKinds, allCards, source)),
    );
  }
}

/// Resolve the per-agent runtime params, applying solver capability traits.
/// Equipped solver traits raise the EFFECTIVE tier the params resolve from, so
/// the agent gets a better tool set (calculator, internet), research unlock, a
/// bigger research pool, and a larger reasoning budget. Puzzle scoring stays
/// pure skill: none of this multiplies the score, it only makes the agent
/// genuinely more capable, so it earns its correct answers. Returns null when
/// the run is guess-only (no LLM).
async function resolveSolverParams(
  agentId: number,
  tier: number,
  source: "contest" | "challenge",
  contestId: number,
  real: boolean,
): Promise<RuntimeParams | null> {
  if (!real) return null;
  const equipped = await getLoadout(source, contestId, agentId).catch(() => [] as string[]);
  const ability = solverTraitAbilities(equipped, tier);
  const base = await resolveRuntimeParams(agentId, ability.effectiveTier).catch(() => null);
  if (!base) return null;
  if (!base.llmEnabled) return base;
  return {
    ...base,
    maxTokens: Math.min(4000, Math.round(base.maxTokens * ability.tokenMult)),
    retries: base.retries + ability.extraRetries,
    researchTier: ability.effectiveTier,
  };
}

/// Runs the per-agent solve honoring the tier's capability gates. Tier 0/1
/// (llmEnabled=false) skip the LLM and just guess; tier 2+ call the model
/// with the tier-attached tools. Audit rows are written for every puzzle
/// regardless of path so the solve-detail surface has complete coverage.
async function runWithCapabilities(
  contestId: number,
  entry: ContestEntryInput,
  puzzles: Puzzle[],
  params: RuntimeParams,
): Promise<SolveOutcome> {
  // Idempotent across preview passes: reuse the persisted solve when one
  // already exists, so the live-window polling doesn't pay for the same
  // LLM call over and over.
  const cached = await readExistingRuns(contestId, entry.agentId, "solver").catch(() => []);
  if (cached.length >= puzzles.length) {
    return reconstructSolve(cached, puzzles);
  }
  if (!params.llmEnabled) {
    return runGuessPath(contestId, entry, puzzles, params);
  }
  return runLlmPath(contestId, entry, puzzles, params);
}

function reconstructSolve(
  cached: { puzzleIdx: number; verdict: string; latencyMs: number; costUsd: number }[],
  puzzles: Puzzle[],
): SolveOutcome {
  const byIdx = new Map<number, { verdict: string; latencyMs: number; costUsd: number }>();
  for (const c of cached) byIdx.set(c.puzzleIdx, c);
  let correct = 0;
  let elapsedMs = 0;
  let costUsd = 0;
  const perPuzzle: boolean[] = [];
  const perPuzzleMs: number[] = [];
  for (let i = 0; i < puzzles.length; i++) {
    const row = byIdx.get(i);
    const ok = row?.verdict === "correct";
    if (ok) correct++;
    perPuzzle.push(ok);
    const ms = row?.latencyMs ?? 0;
    perPuzzleMs.push(ms);
    elapsedMs += ms;
    costUsd += row?.costUsd ?? 0;
  }
  return {
    correct,
    total: puzzles.length,
    elapsedMs,
    perPuzzle,
    perPuzzleMs,
    costUsd,
    spent: puzzles.map(() => "0"),
    spentLabels: puzzles.map(() => ""),
  };
}

/// Apply the strength multiplier and (when present) the routing trait's
/// algorithm swap. Lucky Charm sets routing="stochastic": the final score
/// blends 60% of the deterministic strength-weighted score with 40% of a
/// pure-dice multiplier in [0.5, 2.5]. That's how a tier 1 agent with
/// Lucky Charm equipped can occasionally beat a tier 4 brain. Seeded
/// from (contestId, agentId) so the result is reproducible from the
/// audit row.
export function applyRouting(
  rawScore: number,
  strength: StrengthBreakdown,
  seed: number,
): number {
  const deterministic = rawScore * strength.effective;
  if (!strength.routing) return Math.round(deterministic);
  if (strength.routing === "stochastic") {
    const r = seededRng(seed);
    const dice = 0.5 + r() * 2.0; // [0.5, 2.5]
    const stochastic = rawScore * strength.effective * dice;
    return Math.round(0.6 * deterministic + 0.4 * stochastic);
  }
  if (strength.routing === "momentum") {
    // Hot Hand: streak bonus is already baked into the runner's correct
    // count for now; we just bump the multiplier slightly here so equip
    // is never strictly worse than not equipping.
    return Math.round(deterministic * 1.05);
  }
  if (strength.routing === "calibrated") {
    // Deep State: slight floor on score so a low-confidence-but-correct
    // run still places.
    return Math.round(Math.max(deterministic, rawScore * 1.5));
  }
  return Math.round(deterministic);
}

/// Tier 0 / Tier 1: no LLM call. Random guess per puzzle that samples
/// from the puzzle's actual answer space, so audit rows surface the
/// answer the agent landed on (e.g. "B") instead of a literal "(guess)".
/// Kind-aware odds: multiple-choice guesses are right 25 to 33 percent
/// of the time, free-form numeric guesses almost never. LUCK on tier 1
/// adds a small bias toward the correct answer; with enough luck a
/// tier 1 agent can outperform a stock tier 2 LLM by chance.
async function runGuessPath(
  contestId: number,
  entry: ContestEntryInput,
  puzzles: Puzzle[],
  params: RuntimeParams,
  idxOffset = 0,
): Promise<SolveOutcome> {
  const r = seededRng(contestId * 1000 + entry.agentId + idxOffset);
  const perPuzzle: boolean[] = [];
  const perPuzzleMs: number[] = [];
  let correct = 0;
  let elapsedMs = 0;

  for (let i = 0; i < puzzles.length; i++) {
    const puzzle = puzzles[i]!;
    const { guess, ok } = sampleGuess(puzzle, r, params.luckBonus);
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
      puzzleIdx: idxOffset + i,
      kind: "solver",
      model: "guess",
      prompt: puzzle.prompt,
      response: guess,
      expected: puzzle.expected,
      // Guess path: the response IS the answer (no reasoning).
      answer: guess,
      verdict: ok ? "correct" : "wrong",
      latencyMs: ms,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    }).catch(() => { /* audit row best-effort */ });
  }

  return {
    correct,
    total: puzzles.length,
    elapsedMs,
    perPuzzle,
    perPuzzleMs,
    costUsd: 0,
    spent: puzzles.map(() => "0"),
    spentLabels: puzzles.map(() => ""),
  };
}

/// Pick a concrete answer from the puzzle's choice space and report
/// whether it matches the expected one. Multiple-choice families return
/// a letter or label; free-form numeric families return a plausible
/// integer. LUCK biases the agent toward the right answer: at luck 0 it
/// fires the base probability, scaled up additively with luckBonus.
function sampleGuess(
  puzzle: Puzzle,
  r: () => number,
  luckBonus: number,
): { guess: string; ok: boolean } {
  const choices = guessChoices(puzzle);
  if (choices) {
    // Multiple-choice: bias the pick toward the correct option by
    // luckBonus, otherwise uniform.
    const total = choices.length;
    const baseP = 1 / total;
    const biasedP = Math.min(0.95, baseP + luckBonus);
    let picked: string;
    if (r() < biasedP) {
      picked = puzzle.expected;
    } else {
      const wrongs = choices.filter((c) => normalize(c) !== normalize(puzzle.expected));
      picked = wrongs[Math.floor(r() * wrongs.length)] ?? puzzle.expected;
    }
    return { guess: picked, ok: normalize(picked) === normalize(puzzle.expected) };
  }
  // Free-form numeric: pick a small integer. Hit rate is ~0; LUCK
  // gives a small chance of guessing the exact value (which feels right
  // for a "lucky guess").
  if (r() < 0.02 + luckBonus * 0.5) {
    return { guess: puzzle.expected, ok: true };
  }
  const value = 1 + Math.floor(r() * 200);
  const guess = String(value);
  return { guess, ok: guess === puzzle.expected };
}

function guessChoices(puzzle: Puzzle): string[] | null {
  switch (puzzle.kind) {
    case "classify": return ["transfer", "swap", "mint", "bridge"];
    case "routing":  return ["A", "B", "C"];
    case "quiz":     return ["A", "B", "C", "D"];
    case "research": return ["A", "B", "C", "D"];
    case "arithmetic":
    case "pattern":
    case "wordcount":
    default:
      return null;
  }
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/// Tier 2+: real LLM call with the tier's attached tools.
async function runLlmPath(
  contestId: number,
  entry: ContestEntryInput,
  puzzles: Puzzle[],
  params: RuntimeParams,
  idxOffset = 0,
): Promise<SolveOutcome> {
  const perPuzzle: boolean[] = [];
  const perPuzzleMs: number[] = [];
  const spent: string[] = [];
  const spentLabels: string[] = [];
  const spentTx: string[] = [];
  let correct = 0;
  let elapsedMs = 0;
  let costUsd = 0;

  // Resolve the nanopayment pool once per agent, using the research tier (the
  // agent's real tier, or higher when a solver capability trait unlocked early
  // research + a bigger pool). When NANOPAY is off, CLI is absent, or the pool
  // failed to provision, this stays null and the research-spend block no-ops.
  const researchTier = params.researchTier ?? entry.tier;
  const tierPool: TierPool | null = config.nanopay.enabled ? getTierPool(researchTier) : null;

  for (let i = 0; i < puzzles.length; i++) {
    const puzzle = puzzles[i]!;
    const systemPrompt = buildSystemPrompt(params);

    // Optional research-spend. When a paid endpoint is configured for this
    // puzzle kind and the tier pool has budget remaining for the per-puzzle
    // cap, pay for context BEFORE the LLM call so the model has data the
    // bare prompt doesn't carry. The result is prepended to the user prompt
    // as a "RESEARCH:" block; the LLM keeps the same instructions.
    let userPrompt = puzzle.prompt;
    let puzzleSpent6 = 0n;
    let puzzleSpentLabel = "";
    let puzzleSpentTx = "";
    const research = await maybeResearchSpend({
      tierPool,
      puzzle,
      puzzleIdx: idxOffset + i,
      contestId,
      agentId: entry.agentId,
      tier: researchTier,
    });
    if (research) {
      puzzleSpent6 = research.usdcAmount6;
      puzzleSpentLabel = research.label;
      puzzleSpentTx = research.txHash ?? "";
      userPrompt = `RESEARCH (${research.label}):\n${research.summary}\n\n${puzzle.prompt}`;
    }

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
    spent.push(puzzleSpent6.toString());
    spentLabels.push(puzzleSpentLabel);
    spentTx.push(puzzleSpentTx);

    await recordLlmRun({
      contestId,
      agentId: entry.agentId,
      operator: entry.operator,
      roundIdx: 0,
      puzzleIdx: idxOffset + i,
      kind: "solver",
      model: params.model,
      prompt: userPrompt,
      response,
      expected: puzzle.expected,
      // Judge already pulled the final answer out of the response; persist
      // it so the live cell shows "C" instead of "I need to determine which...".
      answer: extracted || null,
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
        spent.push("0");
        spentLabels.push("");
        spentTx.push("");
      }
      break;
    }
  }

  // LUCK on near-ties: shave elapsedMs slightly so two tied-correct agents
  // are split by their LUCK level. Doesn't lie about correctness.
  if (params.luckBonus > 0) {
    elapsedMs = Math.max(1, Math.round(elapsedMs * (1 - params.luckBonus * 0.1)));
  }

  return { correct, total: puzzles.length, elapsedMs, perPuzzle, perPuzzleMs, costUsd, spent, spentLabels, spentTx };
}

/// Calls payX402 when a research endpoint is configured for the puzzle kind
/// AND the tier pool has enough budget for the per-puzzle cap. Returns the
/// USDC amount actually charged (6-decimal) plus a short summary that gets
/// inlined into the LLM prompt. Returns null on any reason to skip.
async function maybeResearchSpend(opts: {
  tierPool: TierPool | null;
  puzzle: Puzzle;
  puzzleIdx: number;
  contestId: number;
  agentId: number;
  tier: number;
}): Promise<{ usdcAmount6: bigint; label: string; summary: string; txHash?: string } | null> {
  const { tierPool, puzzle, puzzleIdx, contestId, agentId, tier } = opts;
  if (!tierPool) return null;
  const endpoint = researchEndpointFor(puzzle.kind);
  if (!endpoint) return null;

  const shaped = shapeResearchCall(puzzle.kind, endpoint.url, puzzle.prompt);
  // Tier gate, pool budget, payment, and spend bookkeeping all live in the
  // shared helper so the three runners stay behaviorally identical.
  return paidAgentResearch({
    agentId,
    contestId,
    puzzleIdx,
    tier,
    endpoint: shaped.url,
    label: endpoint.label,
    payload: shaped.payload,
    chain: shaped.chain,
    summarize: (response) => summarizeResearch(response, puzzle.kind),
  });
}

/// Reduces a paid endpoint response to a compact prompt snippet. For the
/// research kind we extract just the count + status breakdown so the LLM
/// can bucket without parsing 50 KB of JSON. Other kinds (quiz/classify
/// pointed at a web-search seller like Exa) extract result titles via the
/// shared headline summarizer, which itself falls back to a truncated
/// stringify when no title-shaped array is present.
function summarizeResearch(response: unknown, kind: PuzzleKind): string {
  if (response === undefined || response === null) return "no data";
  // Research, quiz, and classify all run Exa web search now, so result titles
  // are the useful signal. Prefer those; keep the Predexon market-count
  // summarizer as a fallback for any endpoint still returning that shape.
  const news = summarizeNews(response);
  if (news && news !== "no data") return news;
  if (kind === "research") return summarizePredexonMarkets(response) ?? news;
  return news;
}

/// Predexon's markets endpoint returns `{markets: [...], pagination: {count,
/// has_more, ...}}` (often wrapped under `data.response`). We walk a few
/// likely paths and emit a one-line summary the LLM can act on directly.
function summarizePredexonMarkets(response: unknown): string | null {
  const root = response as Record<string, unknown> | null | undefined;
  if (!root || typeof root !== "object") return null;
  // Common wrapper paths surfaced by Circle CLI / Predexon.
  const candidates: unknown[] = [
    root,
    (root as { data?: { response?: unknown } }).data?.response,
    (root as { response?: unknown }).response,
    (root as { data?: unknown }).data,
  ];
  for (const c of candidates) {
    if (!c || typeof c !== "object") continue;
    const obj = c as { markets?: unknown; pagination?: { count?: unknown; has_more?: unknown } };
    const list = Array.isArray(obj.markets) ? (obj.markets as Array<Record<string, unknown>>) : null;
    if (!list) continue;
    const total = list.length;
    let openCount = 0;
    let closedCount = 0;
    for (const m of list) {
      const s = String(m["status"] ?? "").toLowerCase();
      if (s === "open") openCount++;
      else if (s === "closed" || s === "resolved") closedCount++;
    }
    const hasMore = Boolean(obj.pagination?.has_more);
    const sampleTitles = list
      .slice(0, 3)
      .map((m) => String(m["title"] ?? "").slice(0, 80))
      .filter(Boolean);
    return [
      `Predexon returned ${total} matching markets (open: ${openCount}, closed: ${closedCount}, has_more: ${hasMore}).`,
      sampleTitles.length > 0 ? `Top examples: ${sampleTitles.map((t) => `"${t}"`).join("; ")}.` : "",
    ].filter(Boolean).join(" ");
  }
  return null;
}

function buildSystemPrompt(params: RuntimeParams): string {
  const lines = [
    "You are an ArcRun competing agent solving a small puzzle.",
    "Puzzles include arithmetic, classification, routing, pattern continuation, word counting, and multiple-choice quizzes about blockchain, Arc Network, and Circle.",
    "For multiple-choice quizzes, output only the single letter (A, B, C, or D).",
    "For numeric answers, output only the integer.",
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
/// the coordinator still produces a contest result without a paid API key.
/// Roughly mirrors the tier accuracy curve so the standings still make
/// sense on a local dev box.
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
  return {
    correct,
    total: puzzles.length,
    elapsedMs,
    perPuzzle,
    perPuzzleMs,
    costUsd: 0,
    spent: puzzles.map(() => "0"),
    spentLabels: puzzles.map(() => ""),
  };
}
