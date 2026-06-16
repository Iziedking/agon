/// Results boards for a single contest or challenge, read from the auth service
/// (backed by the indexer tables). The field of entrants while it fills, the
/// ranked payouts once it settles. Runs in the browser, where AUTH_URL resolves.

import type { StandingsEntry } from "./live";

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

export interface ResultEntrant {
  agentId: number;
  operator: string;
}

export interface ResultWinner {
  rank: number;
  operator: string;
  amount: string; // USDC, 6 decimals, as a string
}

export interface ArenaResults {
  entrants: ResultEntrant[];
  winners: ResultWinner[];
}

const EMPTY: ArenaResults = { entrants: [], winners: [] };

/// Build a standings snapshot from a results board, so a page that loads or
/// refreshes WITHOUT a live websocket frame (a settled event, a cold load mid
/// event) shows the field and the final ranks instead of "stage initializing".
/// Winners come first by rank with their payout as the score; remaining
/// entrants follow with a zero score. Live frames, when they arrive, take over.
export function entriesFromResults(r: ArenaResults): StandingsEntry[] {
  const agentByOp = new Map(r.entrants.map((e) => [e.operator.toLowerCase(), e.agentId] as const));
  const winners: StandingsEntry[] = r.winners
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map((w) => ({
      rank: w.rank,
      agentId: agentByOp.get(w.operator.toLowerCase()) ?? 0,
      operator: w.operator,
      score: Math.round(Number(w.amount) / 1e6),
    }));
  const winnerOps = new Set(r.winners.map((w) => w.operator.toLowerCase()));
  const rest: StandingsEntry[] = r.entrants
    .filter((e) => !winnerOps.has(e.operator.toLowerCase()))
    .map((e, i) => ({ rank: winners.length + i + 1, agentId: e.agentId, operator: e.operator, score: 0 }));
  return [...winners, ...rest];
}

/// The full final standings snapshot the coordinator persisted at settlement:
/// the same {rank, agentId, operator, score, progress}[] it broadcast live. This
/// is what lets a settled event reconstruct its WHOLE result (volumes, ops, tx
/// hashes, solver cells, research spend) on refresh, not just the winner ranks.
/// Returns null until the event has settled (then `entriesFromResults` is the
/// thinner fallback).
export async function fetchStandingsSnapshot(
  kind: "contests" | "challenges",
  id: number,
): Promise<StandingsEntry[] | null> {
  try {
    const res = await fetch(`${AUTH_URL}/${kind}/${id}/standings`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { entries?: StandingsEntry[] | null };
    return Array.isArray(data.entries) && data.entries.length > 0 ? data.entries : null;
  } catch {
    return null;
  }
}

/// kind is "contests" or "challenges"; the endpoint shapes match.
export async function fetchResults(kind: "contests" | "challenges", id: number): Promise<ArenaResults> {
  try {
    const res = await fetch(`${AUTH_URL}/${kind}/${id}/results`, { cache: "no-store" });
    if (!res.ok) return EMPTY;
    const data = (await res.json()) as Partial<ArenaResults>;
    return { entrants: data.entrants ?? [], winners: data.winners ?? [] };
  } catch {
    return EMPTY;
  }
}
