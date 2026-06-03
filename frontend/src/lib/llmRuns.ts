/// Audit trail for the real-LLM runners. The backend writes one row per
/// (agent, puzzle) call into llm_runs and exposes them via
/// /contests/:id/llm-runs. The same endpoint serves both contest and
/// peer-challenge audit rows because the runner writes both keyed by id
/// into the same column.

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

export type Verdict = "correct" | "wrong" | "skipped" | "error";

export interface LlmRun {
  agentId: number;
  operator: string;
  roundIdx: number;
  puzzleIdx: number;
  kind: "solver" | "analyst" | "scout";
  model: string;
  prompt: string;
  response: string;
  expected: string | null;
  /// Final answer extracted by the backend judge. When present, this is
  /// the source of truth for the live answer cell. Older rows written
  /// before the answer column landed will be null; the UI falls back to
  /// local extraction for those.
  answer: string | null;
  verdict: Verdict;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: string;
  createdAt: string;
}

export async function fetchLlmRuns(contestId: number, limit = 200): Promise<LlmRun[]> {
  try {
    const res = await fetch(`${AUTH_URL}/contests/${contestId}/llm-runs?limit=${limit}`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { runs?: LlmRun[] };
    return data.runs ?? [];
  } catch {
    return [];
  }
}
