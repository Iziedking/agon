/// Message shapes for the coordinator WebSocket fanout that drives the live
/// contest panel and the win modal.

/// Per-agent progress detail that the runner emits alongside the score, so
/// the live stage renders real activity (cells solved, calls placed, tx
/// hashes shipped) instead of deriving visuals from the score number. Mirrors
/// the AgentProgress union in `backend/src/runners/types.ts`.
/// Standardized presentation card for a single puzzle. Mirror of the
/// PuzzleCard interface in backend/src/runners/types.ts. Drives the unified
/// 6-field puzzle layout on the live stage so every family reads in the same
/// shape, with the variant only in the question text.
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
      /// Per-puzzle ms, aligned with `correct[]`. Drives the "fastest" leader.
      perPuzzleMs?: number[];
      /// Per-puzzle kind label ("gas" | "classify" | "route"). Drives the
      /// "PUZZLE TYPES THIS ROUND" header on the stage.
      puzzleKinds?: string[];
      /// Per-puzzle standardized presentation card. Same order as `correct[]`
      /// and `puzzleKinds[]`. When present, the live stage renders each
      /// puzzle through the unified PuzzleCardChrome instead of the legacy
      /// kind-only label.
      puzzleCards?: PuzzleCard[];
      /// Per-puzzle nanopayment spend in USDC (6-decimal as a string).
      /// Aligned 1:1 with `correct[]`. Zero ("0") when the agent didn't
      /// spend on that puzzle. PuzzleStage shows this next to the grid.
      spent?: string[];
      /// Per-puzzle nanopayment endpoint label. Aligned 1:1 with `spent[]`.
      /// Empty string when no spend.
      spentLabels?: string[];
    }
  | {
      kind: "analyst";
      calls: Array<{ p: number; outcome: 0 | 1; correct: boolean }>;
      /// Phase 1 tick budget surface. Lets the live page render the
      /// "T 3/8" chip per agent so viewers see decision pacing.
      ticksUsed?: number;
      ticksBudget?: number;
      /// Arcana Markets positions the agent took this round. Present when
      /// the contest routed through Arcana; undefined / empty when it fell
      /// back to synthetic predictions.
      arcana?: Array<{
        marketId: number;
        title: string;
        side: "yes" | "no";
        stakeUsdc: string;
        txHash?: string;
        entryYesProb: number;
        currentYesProb: number;
        /// Marked-to-market PnL while open; realized PnL after resolution.
        /// USDC 6-dec, signed. Sign carries direction.
        mtmPnLUsdc6: string;
        /// True after Arcana resolves the market. When true, mtmPnLUsdc6
        /// is the final on-chain payout (positive on win, negative on loss).
        resolved?: boolean;
      }>;
    }
  | {
      kind: "scout";
      opsCount: number;
      recent: string[];
      /// USDC amount (6-decimals string) per recent tx, aligned with `recent[]`.
      recentVolumes?: string[];
    };

export interface StandingsEntry {
  rank: number;
  agentId: number;
  operator: string;
  score: number;
  /// Optional. Present for runners that have something visible to stream;
  /// scout's preview pass is a tier-proxy and arrives without progress, the
  /// final standings frame carries the real tx hashes.
  progress?: AgentProgress;
}

export interface StandingsMessage {
  type: "standings";
  contestId: number;
  contestType?: string; // carried from the open event; standings frames omit it
  endsAt: number; // epoch ms
  entries: StandingsEntry[];
}

/// Fired by the autopilot the instant it opens a contest, before any entries.
/// Lets the live panel show the fresh contest and start its countdown right away.
export interface ContestOpenMessage {
  type: "contest_open";
  contestId: number;
  contestType?: string;
  endsAt: number; // epoch ms
  /// For Analyst contests routed through Arcana, the set of markets the
  /// coordinator pinned at open. Lets the live page show the round's menu
  /// before any agent enters. Undefined / empty for non-Arcana contests
  /// and for contests opened when Arcana had no open markets.
  arcanaMarkets?: Array<{
    id: number;
    title: string;
    category: string;
    /// Unix seconds.
    endTime: number;
  }>;
}

/// Live preview of a peer challenge while the coordinator scores it. Mirrors the
/// contest `standings` frame but keyed by challengeId.
export interface ChallengeStandingsMessage {
  type: "challenge_standings";
  challengeId: number;
  entries: StandingsEntry[];
}

export interface SettledWinner {
  rank: number;
  operator: string;
  amount: string; // USDC, 6 decimals, as a string
}

export interface SettledMessage {
  type: "settled";
  contestId: number;
  winners: SettledWinner[];
}

/// Matches the contest `settled` shape but for peer challenges. The backend
/// broadcasts this when `postWinnerRoot` lands.
export interface ChallengeSettledMessage {
  type: "challenge_settled";
  challengeId: number;
  winners: SettledWinner[];
}

/// Fired by the coordinator's prediction tick scheduler the moment an
/// agent's per-tick LLM decision lands on chain. Lightweight — the
/// authoritative position state still arrives on the next standings
/// frame; this message just nudges the live narration so the WHAT'S
/// HAPPENING line ticks within seconds of a real trade instead of
/// waiting for the next scoring pass.
export interface TickMessage {
  type: "tick";
  source: "contest" | "challenge";
  eventId: number;
  agentId: number;
  action: "OPEN_YES" | "OPEN_NO" | "HEDGE_YES" | "HEDGE_NO" | "HOLD";
  marketId: number | null;
}

export type WsMessage =
  | { type: "hello"; service?: string }
  | ContestOpenMessage
  | StandingsMessage
  | ChallengeStandingsMessage
  | SettledMessage
  | ChallengeSettledMessage
  | TickMessage;
