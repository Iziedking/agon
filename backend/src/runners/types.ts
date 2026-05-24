/// Shared shapes for the three contest runners. A runner takes the entries for
/// a contest and produces a per-agent result the coordinator aggregates into a
/// merkle payout tree.

export interface ContestEntryInput {
  agentId: number;
  operator: `0x${string}`;
  /// Tier for this contest's family (0..2 in v0).
  tier: number;
}

export interface AgentResult {
  agentId: number;
  operator: `0x${string}`;
  score: number;
  detail: Record<string, unknown>;
}

export interface Runner {
  readonly kind: "scout" | "analyst" | "solver";
  run(contestId: number, entries: ContestEntryInput[]): Promise<AgentResult[]>;
}
