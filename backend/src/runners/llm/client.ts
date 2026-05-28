import Anthropic from "@anthropic-ai/sdk";
import { config } from "../../config/index.js";
import { query } from "../../db/pool.js";

/// Thin Anthropic SDK wrapper used by every real-LLM runner. Centralizes:
/// - lazy client construction (so a missing API key is detectable),
/// - per-call cost accounting + the daily kill switch,
/// - audit-log writes to llm_runs for the "yes the agent really solved it"
///   demo storyline.

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

/// Per-million-token rates, USD. Verified 2026-05-28 against the Claude
/// pricing page. Cache writes and reads are ignored here since v1 uses no
/// prompt caching (single-shot per puzzle). Web search adds $0.01 per
/// search (server tool); code execution is effectively free under the
/// 1550 hours/month container baseline. The audit row tracks token cost
/// only; web-search calls are visible via response.usage.server_tool_use
/// if we ever want to roll them up.
const RATES: Record<string, { input: number; output: number }> = {
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
};

function rateFor(model: string): { input: number; output: number } {
  return RATES[model] ?? RATES["claude-haiku-4-5-20251001"]!;
}

let cachedClient: Anthropic | null = null;

export function llmConfigured(): boolean {
  return Boolean(config.llm.anthropicApiKey);
}

function getClient(): Anthropic {
  if (cachedClient) return cachedClient;
  if (!config.llm.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set; the LLM runner cannot make real calls");
  }
  cachedClient = new Anthropic({ apiKey: config.llm.anthropicApiKey });
  return cachedClient;
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

  const client = getClient();
  const t0 = Date.now();
  // Server-side tools (code_execution, web_search) are typed loosely by
  // the SDK's union shape. The runtime accepts the {type, name} object
  // form directly; cast keeps the call site readable.
  const response = await client.messages.create({
    model: params.model,
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

  return { text, inputTokens, outputTokens, costUsd, latencyMs, model: params.model };
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
  verdict: "correct" | "wrong" | "skipped" | "error";
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export async function recordLlmRun(row: AuditRow): Promise<void> {
  await query(
    `insert into llm_runs
       (contest_id, agent_id, operator, round_idx, puzzle_idx, kind, model, prompt, response, expected, verdict, latency_ms, input_tokens, output_tokens, cost_usd)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
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
      row.verdict,
      row.latencyMs,
      row.inputTokens,
      row.outputTokens,
      row.costUsd.toFixed(6),
    ],
  );
}
