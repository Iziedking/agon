/// Reads the leaderboard and operator profiles from the auth service read API
/// (backed by the indexer tables). These run in the browser, where AUTH_URL is
/// reachable; the chain-only contest reads stay in contests.ts.

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

export interface LeaderRow {
  operator: string;
  entered: number;
  wins: number;
  earned: string; // USDC, 6 decimals, as a string
  cycles: number; // PointsLedger balance (whole Cycles)
  reputation: string; // raw, scaled 1e6, as a string
}

export interface OperatorAgent {
  id: number;
  scoutTier: number;
  analystTier: number;
  solverTier: number;
  reputation: string;
}

export interface OperatorContest {
  contestId: number;
  contestType: number | null;
  status: string | null;
  won: string | null; // payout amount if they placed, else null
  claimed: boolean;
}

export interface OperatorProfile {
  operator: string;
  xHandle: string | null;
  syndicateId: string | null;
  cycles: number;
  reputation: string; // raw, scaled 1e6, as a string
  stats: { entered: number; wins: number; earned: string };
  agents: OperatorAgent[];
  contests: OperatorContest[];
}

export async function fetchLeaderboard(limit = 50): Promise<LeaderRow[]> {
  try {
    const res = await fetch(`${AUTH_URL}/leaderboard?limit=${limit}`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as { leaders?: LeaderRow[] };
    return data.leaders ?? [];
  } catch {
    return [];
  }
}

export async function fetchOperator(address: string): Promise<OperatorProfile | null> {
  try {
    const res = await fetch(`${AUTH_URL}/operators/${address}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as OperatorProfile;
  } catch {
    return null;
  }
}

/// Format a 6-decimal USDC string (e.g. "14000000") as "14.00 USDC".
export function formatUsdcString(amount6: string | null): string {
  const n = Number(amount6 ?? "0") / 1e6;
  return `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`;
}

/// Reputation is stored raw at 1e6 precision on-chain. Show it as whole points.
export function formatReputation(raw: string | null): number {
  return Math.round(Number(raw ?? "0") / 1e6);
}

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
