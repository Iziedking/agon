/// Shared shapes for the three contest runners. A runner takes the entries for
/// a contest and produces a per-agent result the coordinator aggregates into a
/// merkle payout tree.

export interface ContestEntryInput {
  agentId: number;
  operator: `0x${string}`;
  /// Tier for this contest's family (0..2 in v0).
  tier: number;
}

/// Per-agent progress detail surfaced on the standings broadcast so the live
/// stage can render what each agent is actually doing instead of deriving
/// visible state from a score number. Each runner emits its own shape: solver
/// reports which puzzles were correct, analyst reports each binary call and
/// its outcome, scout reports the real tx hashes shipped from the hot wallet.
export type AgentProgress =
  | { kind: "solver"; correct: boolean[]; total: number }
  | { kind: "analyst"; calls: Array<{ p: number; outcome: 0 | 1; correct: boolean }> }
  | { kind: "scout"; opsCount: number; recent: string[] };

export interface AgentResult {
  agentId: number;
  operator: `0x${string}`;
  score: number;
  detail: Record<string, unknown>;
  /// Optional progress, attached when the runner has something visible to
  /// stream. Scout's preview pass has no progress (the real work runs at
  /// settlement); analyst and solver populate it on every pass.
  progress?: AgentProgress;
}

export interface Runner {
  readonly kind: "scout" | "analyst" | "solver";
  run(contestId: number, entries: ContestEntryInput[]): Promise<AgentResult[]>;
}
