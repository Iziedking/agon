import type { AgentResult, ContestEntryInput, Runner } from "./types.js";
import { clamp01, seededRng } from "./rng.js";
import { analystScore } from "../scoring/index.js";
import { generatePredictionQuestions, type PredictionQuestion } from "./predictions/oracle.js";
import { judgePrediction } from "./predictions/judge.js";
import { callModel, llmConfigured, recordLlmRun, DailyKillError } from "./llm/client.js";
import { resolveRuntimeParams, loadAgentStats, type RuntimeParams } from "./llm/tierConfig.js";
import { effectiveStrength } from "../scoring/strength.js";
import { getLoadout } from "../auth/loadouts.js";
import { applyRouting } from "./solver.js";

/// AnalystRunner: agents predict the answer to binary questions about live
/// Arc chain state (current block number, gas price, ArcRun contest count,
/// PrizeEscrow USDC balance, etc.) and are graded by Brier score.
///
/// Tier 0 / 1 random guess at p=0.5 (with a small luck nudge on tier 1).
/// Tier 2 reasons from priors with no tools. Tier 3 adds code_execution
/// (limited help for this kind). Tier 4 adds web_search, which is the real
/// edge: the model can look up the live block explorer and answer
/// near-perfectly. Paying for tier 4 literally buys real-time chain
/// awareness in this contest type.
///
/// Fallback: when ANTHROPIC_API_KEY is unset, every agent falls back to
/// the synthetic curve from the previous implementation so local dev
/// without a paid API key still produces a sensible standings frame.

const FALLBACK_SKILL = [0.0, 0.2, 0.4, 0.6, 0.85];

export class AnalystRunner implements Runner {
  readonly kind = "analyst" as const;
  constructor(private readonly questionCount = 5) {}

  async run(contestId: number, entries: ContestEntryInput[]): Promise<AgentResult[]> {
    let questions: PredictionQuestion[] = [];
    try {
      questions = await generatePredictionQuestions(contestId, this.questionCount);
    } catch {
      questions = [];
    }
    const real = llmConfigured() && questions.length > 0;

    return Promise.all(
      entries.map(async (e) => {
        const params = real ? await resolveRuntimeParams(e.agentId, e.tier).catch(() => null) : null;
        const predictions = params
          ? await runRealAnalyst(contestId, e, questions, params)
          : simulatePredictions(questions, e.tier, contestId * 1000 + e.agentId);

        const calls = predictions.map((p) => ({
          p: Number(p.p.toFixed(3)),
          outcome: p.outcome,
          correct: (p.p >= 0.5 ? 1 : 0) === p.outcome,
        }));

        // tier x training x traits per docs/agentTier.md
        const stats = await loadAgentStats(e.agentId).catch(() => ({}));
        const equipped = await getLoadout("contest", contestId, e.agentId).catch(() => [] as string[]);
        const strength = effectiveStrength(e.tier, stats, equipped, "analyst");
        const rawScore = analystScore(predictions);
        const finalScore = applyRouting(rawScore, strength, contestId * 1000 + e.agentId);

        return {
          agentId: e.agentId,
          operator: e.operator,
          score: finalScore,
          detail: {
            questions: questions.length,
            rawScore,
            strength: {
              effective: Number(strength.effective.toFixed(2)),
              tierBase: strength.tierBase,
              training: Number(strength.training.toFixed(3)),
              traits: Number(strength.traits.toFixed(3)),
            },
          },
          progress: { kind: "analyst" as const, calls },
        };
      }),
    );
  }
}

interface CallOutcome {
  p: number;
  outcome: 0 | 1;
}

async function runRealAnalyst(
  contestId: number,
  entry: ContestEntryInput,
  questions: PredictionQuestion[],
  params: RuntimeParams,
): Promise<CallOutcome[]> {
  const out: CallOutcome[] = [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]!;
    const systemPrompt = buildSystemPrompt(params);
    const userPrompt = `${q.prompt}\nReply with YES or NO followed by your confidence as a decimal between 0.5 and 1.0. Example: "YES 0.8"`;

    let response = "";
    let p = 0.5;
    let verdict: "correct" | "wrong" | "skipped" | "error" = "skipped";
    let latencyMs = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let cost = 0;

    if (!params.llmEnabled) {
      // Tier 0/1 random guess. LUCK nudges toward the right side a bit so
      // the score isn't pure noise.
      const r = seededRng(contestId * 1000 + entry.agentId + i);
      const truthBias = params.luckBonus;
      const guessYes = r() < 0.5 + (q.outcome === 1 ? truthBias : -truthBias);
      p = guessYes ? 0.55 : 0.45;
      response = guessYes ? "guess YES" : "guess NO";
      latencyMs = 800 + Math.round(400 * r());
      verdict = (p >= 0.5 ? 1 : 0) === q.outcome ? "correct" : "wrong";
    } else {
      const attempts = 1 + params.retries;
      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          const res = await callModel({
            model: params.model,
            systemPrompt,
            userPrompt,
            maxTokens: params.maxTokens,
            temperature: params.temperature,
            tools: params.tools,
          });
          response = res.text;
          latencyMs += res.latencyMs;
          inputTokens += res.inputTokens;
          outputTokens += res.outputTokens;
          cost += res.costUsd;

          const j = judgePrediction(q, res.text);
          p = j.p;
          verdict = j.correct ? "correct" : "wrong";
          break;
        } catch (err) {
          verdict = "error";
          response = err instanceof Error ? err.message : String(err);
          if (err instanceof DailyKillError) {
            verdict = "skipped";
            break;
          }
        }
      }
    }

    out.push({ p, outcome: q.outcome });

    await recordLlmRun({
      contestId,
      agentId: entry.agentId,
      operator: entry.operator,
      roundIdx: 0,
      puzzleIdx: i,
      kind: "analyst",
      model: params.llmEnabled ? params.model : "guess",
      prompt: `${q.prompt}\n[snapshot: ${q.snapshot}]`,
      response,
      expected: q.outcome === 1 ? "YES" : "NO",
      verdict,
      latencyMs,
      inputTokens,
      outputTokens,
      costUsd: cost,
    }).catch(() => { /* audit row best-effort */ });
  }

  return out;
}

function buildSystemPrompt(params: RuntimeParams): string {
  const lines = [
    "You are an ArcRun analyst agent predicting a YES/NO question about the Arc Testnet blockchain.",
    "Reply with exactly one line: YES or NO, followed by your confidence as a decimal between 0.5 and 1.0.",
    "Example: YES 0.85",
  ];
  if (params.tools.some((t) => t.name === "web_search")) {
    lines.push(
      "Use web_search to look up the current Arc Testnet state (block number, gas price, ArcRun contest count, etc.) before answering. Arc Testnet's block explorer lives at testnet.arcscan.app.",
    );
  } else if (params.tools.some((t) => t.name === "code_execution")) {
    lines.push("You may use code_execution for arithmetic but it cannot query live chain state. Reason from priors.");
  }
  lines.push("The LAST line of your output must be exactly: YES <conf> or NO <conf>");
  return lines.join(" ");
}

function simulatePredictions(
  questions: PredictionQuestion[],
  tier: number,
  seed: number,
): CallOutcome[] {
  const r = seededRng(seed);
  const skill = FALLBACK_SKILL[Math.min(Math.max(tier, 0), 4)]!;
  return questions.map((q) => {
    const truth = q.outcome;
    const p = clamp01(0.5 * (1 - skill) + truth * skill + (r() - 0.5) * 0.2);
    return { p, outcome: truth };
  });
}

/// Kept for back-compat with code that imported `generateQuestions` from
/// this module. Returns synthetic Question[] (not chain-backed). New code
/// should use generatePredictionQuestions from ./predictions/oracle.
export function generateQuestions(seed: number, count: number): Array<{ baseRate: number; outcome: 0 | 1 }> {
  const r = seededRng(seed);
  return Array.from({ length: count }, () => {
    const baseRate = 0.2 + r() * 0.6;
    const outcome: 0 | 1 = r() < baseRate ? 1 : 0;
    return { baseRate, outcome };
  });
}
