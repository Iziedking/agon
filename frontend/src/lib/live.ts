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
  endsAt: number; // epoch ms
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

export type WsMessage = { type: "hello"; service?: string } | StandingsMessage | SettledMessage;
