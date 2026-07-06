import Anthropic from "@anthropic-ai/sdk";
import { config } from "../../config/index.js";
import { query } from "../../db/pool.js";

/// Thin Anthropic SDK wrapper used by every real-LLM runner. Centralizes:
/// - lazy client construction (so a missing API key is detectable),
/// - per-call cost accounting + the daily kill switch,
/// - audit-log writes to llm_runs so every solve is verifiable after the fact.

export interface CallParams {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  temperature: number;
  /// Server-side tools to attach (e.g. code_execution, web_search). Empty
  /// for tier 2; populated for tier 3/4. Anthropic handles execution; we
  /// just receive the assembled response.
  tools?: Array<{ type: string; name: string }>;
}

export interface CallResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  model: string;
}

/// Per-million-token rates, USD, from the Claude pricing page. Cache writes
/// and reads are ignored since calls are single-shot per puzzle with no
/// prompt caching. Web search adds $0.01 per search (server tool); code
/// execution is effectively free under the 1550 hours/month container
/// baseline. The audit row tracks token cost only; web-search calls are
/// visible via response.usage.server_tool_use if we ever roll them up.
const RATES: Record<string, { input: number; output: number }> = {
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
};

function rateFor(model: string): { input: number; output: number } {
  return RATES[model] ?? RATES["claude-haiku-4-5-20251001"]!;
}

/// Tolerate undated Claude aliases some envs use (e.g. TIER4_MODEL=claude-haiku-4-5)
/// by mapping them to the dated API id the Anthropic SDK actually accepts.
const CLAUDE_ALIASES: Record<string, string> = {
  "claude-haiku-4-5": "claude-haiku-4-5-20251001",
};
function normalizeAnthropicModel(model: string): string {
  return CLAUDE_ALIASES[model] ?? model;
}

interface Provider {
  name: string;
  client: Anthropic;
}
let cachedProviders: Provider[] | null = null;

export function llmConfigured(): boolean {
  return Boolean(
    config.llm.conduitApiKeys.length > 0 || config.llm.anthropicApiKey || config.llm.openrouterApiKey,
  );
}

/// OpenRouter call for the non-Anthropic tier models (llama, gpt). One
/// OpenAI-compatible endpoint covers every provider; we route here whenever the
/// model id is a slug (provider/model). Cost is recorded as ~0 (these are cheap
/// and don't gate the Anthropic kill switch). Plain completion: the small models
/// reason about make-vs-buy from the prompt, no server tools.
async function callOpenRouter(params: CallParams): Promise<CallResult> {
  const key = config.llm.openrouterApiKey;
  if (!key) throw new Error(`OPENROUTER_API_KEY is not set; cannot call ${params.model}`);
  const t0 = Date.now();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://arcrun.xyz",
      "X-Title": "ArcRun",
    },
    body: JSON.stringify({
      model: params.model,
      messages: [
        { role: "system", content: params.systemPrompt },
        { role: "user", content: params.userPrompt },
      ],
      max_tokens: params.maxTokens,
      temperature: params.temperature,
    }),
    signal: AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS ?? "60000")),
  });
  const latencyMs = Date.now() - t0;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`openrouter ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = (data.choices?.[0]?.message?.content ?? "").trim();
  return {
    text,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
    costUsd: 0,
    latencyMs,
    model: params.model,
  };
}

/// Anthropic-compatible providers in priority order. Conduit is a drop-in for
/// the Messages API (same endpoint/auth/body/response), so we point the same SDK
/// at its baseURL. Every configured Conduit key is tried in turn FIRST (so a
/// rate-limited free-tier key falls through to the next), and the Anthropic key
/// is the final fallback. The SDK sends the key as `x-api-key` either way, which
/// is exactly what both expect. Built once and cached.
function getProviders(): Provider[] {
  if (cachedProviders) return cachedProviders;
  // Bound every call so a hung provider can't hold a runner for the SDK's
  // 10-minute default. 60s per call, 2 retries, both env-tunable. Combined with
  // the coordinator's per-run watchdog this keeps one stuck agent from stalling
  // a whole settlement.
  const timeout = Number(process.env.LLM_TIMEOUT_MS ?? "60000");
  const maxRetries = Number(process.env.LLM_MAX_RETRIES ?? "2");
  const providers: Provider[] = [];
  if (config.llm.conduitBaseUrl) {
    config.llm.conduitApiKeys.forEach((apiKey, i) => {
      providers.push({
        name: i === 0 ? "conduit" : `conduit-${i + 1}`,
        client: new Anthropic({ apiKey, baseURL: config.llm.conduitBaseUrl, timeout, maxRetries }),
      });
    });
  }
  if (config.llm.anthropicApiKey) {
    providers.push({
      name: "anthropic",
      client: new Anthropic({ apiKey: config.llm.anthropicApiKey, timeout, maxRetries }),
    });
  }
  if (providers.length === 0) {
    throw new Error(
      "no Anthropic-compatible LLM provider configured; set CONDUIT_API_KEY (with CONDUIT_BASE_URL) or ANTHROPIC_API_KEY",
    );
  }
  cachedProviders = providers;
  return providers;
}

/// Fast-fail circuit breaker, per provider family (anthropic-compatible vs
/// openrouter). When the LLM is genuinely down, every call would otherwise walk
/// the full provider loop (N providers x retries x a 60s timeout), so a single
/// mission with ~21 calls hangs for many minutes and looks stuck. After
/// LLM_BREAKER_FAILS consecutive total failures the breaker OPENS for
/// LLM_BREAKER_COOLDOWN_MS: calls throw immediately so callers use their
/// fallbacks (heuristic decide, concat synthesize, "judge error") and the
/// mission settles in seconds. The first call after the cooldown is a probe that
/// closes the breaker on success. Any success resets it. Process-global and
/// best-effort; the tradeoff is up to one cooldown window of fallback output in
/// exchange for never hanging a settlement.
interface Breaker {
  fails: number;
  openUntil: number;
}
const breakers: Record<"anthropic" | "openrouter", Breaker> = {
  anthropic: { fails: 0, openUntil: 0 },
  openrouter: { fails: 0, openUntil: 0 },
};
const BREAKER_FAILS = Number(process.env.LLM_BREAKER_FAILS ?? "3");
const BREAKER_COOLDOWN_MS = Number(process.env.LLM_BREAKER_COOLDOWN_MS ?? "60000");

function breakerOpen(family: "anthropic" | "openrouter"): boolean {
  return breakers[family].openUntil > Date.now();
}
function breakerRecord(family: "anthropic" | "openrouter", ok: boolean): void {
  const b = breakers[family];
  if (ok) {
    b.fails = 0;
    b.openUntil = 0;
    return;
  }
  b.fails += 1;
  if (b.fails >= BREAKER_FAILS) {
    b.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
    b.fails = 0; // after the cooldown, one probe call runs before re-opening
    console.warn(
      `llm: ${family} breaker OPEN for ${Math.round(BREAKER_COOLDOWN_MS / 1000)}s after ${BREAKER_FAILS} consecutive failures; calls fast-fail to fallbacks until it recovers`,
    );
  }
}

/// Sum of cost_usd in llm_runs since UTC midnight. Cheap query on the
/// llm_runs_created_idx, called before every LLM call to enforce the kill
/// switch.
async function spendToday(): Promise<number> {
  const { rows } = await query<{ s: string }>(
    "select coalesce(sum(cost_usd), 0)::text as s from llm_runs where created_at >= date_trunc('day', now() at time zone 'utc')",
  );
  return Number(rows[0]?.s ?? "0");
}

export class DailyKillError extends Error {
  constructor(spent: number, cap: number) {
    super(`LLM daily kill switch tripped: spent $${spent.toFixed(2)} of $${cap.toFixed(2)} cap`);
    this.name = "DailyKillError";
  }
}

/// Single non-streaming call. Returns the assembled text plus usage and
/// cost. Throws DailyKillError if the daily cap is exceeded before the
/// call. Caller is responsible for persisting the audit row (so the run
/// metadata for contest/agent/round/puzzle is captured alongside).
export async function callModel(params: CallParams): Promise<CallResult> {
  const cap = config.llm.dailyKillUsd;
  if (cap > 0) {
    const spent = await spendToday();
    if (spent >= cap) throw new DailyKillError(spent, cap);
  }

  // Slug models (provider/model) go through OpenRouter; bare claude-* ids use
  // the Anthropic SDK below.
  if (params.model.includes("/")) {
    if (breakerOpen("openrouter")) throw new Error("llm openrouter unavailable (breaker open)");
    try {
      const r = await callOpenRouter(params);
      breakerRecord("openrouter", true);
      return r;
    } catch (err) {
      breakerRecord("openrouter", false);
      throw err;
    }
  }

  if (breakerOpen("anthropic")) throw new Error("llm providers unavailable (breaker open)");
  const providers = getProviders();
  const model = normalizeAnthropicModel(params.model);
  // Try each provider in priority order (Conduit, then Anthropic). On any error
  // from one — including a credit-exhausted 4xx — log it and fall through to the
  // next; only throw once every provider has failed.
  let lastErr: unknown;
  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i]!;
    const t0 = Date.now();
    try {
      // Server-side tools (code_execution, web_search) are typed loosely by
      // the SDK's union shape. The runtime accepts the {type, name} object
      // form directly; cast keeps the call site readable.
      const response = await provider.client.messages.create({
        model,
        max_tokens: params.maxTokens,
        temperature: params.temperature,
        system: params.systemPrompt,
        messages: [{ role: "user", content: params.userPrompt }],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(params.tools && params.tools.length > 0 ? { tools: params.tools as any } : {}),
      });
      const latencyMs = Date.now() - t0;

      const text = response.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("")
        .trim();

      const inputTokens = response.usage.input_tokens;
      const outputTokens = response.usage.output_tokens;
      const r = rateFor(params.model);
      const costUsd = (inputTokens * r.input + outputTokens * r.output) / 1_000_000;
      if (i > 0) console.warn(`llm: ${provider.name} served ${model} after the primary failed`);

      breakerRecord("anthropic", true);
      return { text, inputTokens, outputTokens, costUsd, latencyMs, model: params.model };
    } catch (err) {
      lastErr = err;
      const more = i < providers.length - 1 ? `; falling back to ${providers[i + 1]!.name}` : "";
      console.warn(`llm: provider ${provider.name} failed for ${model}: ${err instanceof Error ? err.message : err}${more}`);
    }
  }
  // Every provider failed for this call: count it against the breaker so a
  // sustained outage stops dragging each subsequent call through the full loop.
  breakerRecord("anthropic", false);
  throw lastErr instanceof Error ? lastErr : new Error("all LLM providers failed");
}

export interface AuditRow {
  contestId: number;
  agentId: number;
  operator: string;
  roundIdx: number;
  puzzleIdx: number;
  kind: "solver" | "analyst" | "scout";
  model: string;
  prompt: string;
  response: string;
  expected: string | null;
  /// The agent's final answer, already extracted from `response` by the
  /// runner (typically via the judge). When null, the live UI falls back
  /// to its own extractor; populating this is the right thing.
  answer?: string | null;
  verdict: "correct" | "wrong" | "skipped" | "error";
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export async function recordLlmRun(row: AuditRow): Promise<void> {
  await query(
    `insert into llm_runs
       (contest_id, agent_id, operator, round_idx, puzzle_idx, kind, model, prompt, response, expected, answer, verdict, latency_ms, input_tokens, output_tokens, cost_usd)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       on conflict (contest_id, agent_id, kind, round_idx, puzzle_idx) do nothing`,
    [
      row.contestId,
      row.agentId,
      row.operator,
      row.roundIdx,
      row.puzzleIdx,
      row.kind,
      row.model,
      row.prompt,
      row.response,
      row.expected,
      row.answer ?? null,
      row.verdict,
      row.latencyMs,
      row.inputTokens,
      row.outputTokens,
      row.costUsd.toFixed(6),
    ],
  );
}

/// Read previously persisted runs for an agent in a contest, keyed by
/// (kind, round, puzzle). Lets the runner skip the LLM call when an audit
/// row already exists, so live-window preview passes don't pay for the
/// same solve twice. Returns a map of puzzle_idx -> { verdict, latencyMs,
/// cost, response } for the requested kind.
export interface ExistingRun {
  puzzleIdx: number;
  verdict: "correct" | "wrong" | "skipped" | "error";
  latencyMs: number;
  costUsd: number;
  response: string;
  expected: string | null;
}

export async function readExistingRuns(
  contestId: number,
  agentId: number,
  kind: "solver" | "analyst" | "scout",
  roundIdx = 0,
): Promise<ExistingRun[]> {
  const { rows } = await query<{
    puzzle_idx: number;
    verdict: string;
    latency_ms: number;
    cost_usd: string;
    response: string;
    expected: string | null;
  }>(
    `select puzzle_idx, verdict, latency_ms, cost_usd::text, response, expected
       from llm_runs
      where contest_id = $1 and agent_id = $2 and kind = $3 and round_idx = $4
      order by puzzle_idx asc`,
    [contestId, agentId, kind, roundIdx],
  );
  return rows.map((r) => ({
    puzzleIdx: r.puzzle_idx,
    verdict: r.verdict as ExistingRun["verdict"],
    latencyMs: r.latency_ms,
    costUsd: Number(r.cost_usd),
    response: r.response,
    expected: r.expected,
  }));
}
