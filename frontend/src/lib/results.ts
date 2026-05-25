/// Results boards for a single contest or challenge, read from the auth service
/// (backed by the indexer tables). The field of entrants while it fills, the
/// ranked payouts once it settles. Runs in the browser, where AUTH_URL resolves.

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
