/// Message shapes for the coordinator WebSocket fanout that drives the live
/// contest panel and the win modal.

export interface StandingsEntry {
  rank: number;
  agentId: number;
  operator: string;
  score: number;
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

export type WsMessage =
  | { type: "hello"; service?: string }
  | ContestOpenMessage
  | StandingsMessage
  | SettledMessage;
