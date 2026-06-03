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
/// Standardized presentation card for a single puzzle, mirrored from the
/// backend's PuzzlePresentation so the frontend doesn't have to import from
/// the puzzles folder. Six fields, identical across every family, drive the
/// live-stage card layout. Aligned 1:1 with `correct[]` and `puzzleKinds[]`.
export interface PuzzleCard {
  family: string;
  difficulty: 1 | 2 | 3;
  format: "integer" | "single_word" | "phrase" | "choice";
  choices?: readonly string[];
  timeLimitSec: number;
  toolsAllowed: "none" | "calc" | "calc+web";
}

export type AgentProgress =
  | {
      kind: "solver";
      correct: boolean[];
      total: number;
      /// Per-puzzle wall-clock for the live stage's "fastest solver" leader.
      /// Order matches `correct[]`; ms since the per-agent solve started.
      perPuzzleMs?: number[];
      /// Per-puzzle kind label ("gas" | "classify" | "route") so the stage
      /// can show "PUZZLE TYPES THIS ROUND" without needing the contest id.
      puzzleKinds?: string[];
      /// Per-puzzle presentation card. Standardized so every family renders
      /// in the same 6-field shape on the live stage. Same order as the
      /// other per-puzzle arrays.
      puzzleCards?: PuzzleCard[];
    }
  | {
      kind: "analyst";
      calls: Array<{ p: number; outcome: 0 | 1; correct: boolean }>;
      /// Phase 1 tick model: how many decision ticks the agent has used
      /// out of their tier-derived budget. Drives the "T 3/8" chip on
      /// the live stage so viewers see who's spent their decisions.
      ticksUsed?: number;
      ticksBudget?: number;
      /// Arcana Markets positions the agent took this round, when the
      /// runner routed through Arcana instead of (or in addition to) the
      /// synthetic Brier-scored question loop. Empty / undefined when the
      /// contest fell back to synthetic predictions.
      arcana?: Array<{
        marketId: number;
        title: string;
        side: "yes" | "no";
        /// USDC 6-decimals as a string so it survives the JSON hop.
        stakeUsdc: string;
        /// Tx hash of the buyShares call. Optional because the runner may
        /// have failed to submit (e.g. zero balance) and we still want to
        /// surface the intent on the stage.
        txHash?: string;
        /// Implied YES probability at the moment the agent entered, derived
        /// from the pools right before the trade.
        entryYesProb: number;
        /// Implied YES probability right now (current pools).
        currentYesProb: number;
        /// Marked-to-market PnL while open; realized PnL after the market
        /// resolves. USDC 6-dec as a string. Sign carries direction.
        mtmPnLUsdc6: string;
        /// True once Arcana has resolved this market. When true, mtmPnLUsdc6
        /// is the realized payout (positive on win, negative on loss).
        resolved?: boolean;
      }>;
    }
  | {
      kind: "scout";
      opsCount: number;
      recent: string[];
      /// USDC amount (6-decimals string) per recent tx, aligned 1:1 with
      /// `recent[]`. Lets the live tape show value-weighted activity.
      recentVolumes?: string[];
    };

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
