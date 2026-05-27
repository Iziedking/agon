/// Message shapes for the coordinator WebSocket fanout that drives the live
/// contest panel and the win modal.

/// Per-agent progress detail that the runner emits alongside the score, so
/// the live stage renders real activity (cells solved, calls placed, tx
/// hashes shipped) instead of deriving visuals from the score number. Mirrors
/// the AgentProgress union in `backend/src/runners/types.ts`.
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
    }
  | { kind: "analyst"; calls: Array<{ p: number; outcome: 0 | 1; correct: boolean }> }
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

export type WsMessage =
  | { type: "hello"; service?: string }
  | ContestOpenMessage
  | StandingsMessage
  | ChallengeStandingsMessage
  | SettledMessage
  | ChallengeSettledMessage;
