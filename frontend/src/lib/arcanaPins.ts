/// Client for the coordinator-pinned Arcana market set for any event
/// (contest or challenge). Pins are written by the backend at open time;
/// reading is a single small HTTP call, no auth needed. Drives the
/// PredictionStage "MARKETS THIS ROUND" menu before any agent has traded.

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

export interface PinnedMarket {
  id: number;
  title: string;
  category: string;
  endTime: number;
}

export async function fetchArcanaPins(
  source: "contest" | "challenge",
  id: number,
): Promise<PinnedMarket[]> {
  try {
    const res = await fetch(`${AUTH_URL}/events/${source}/${id}/arcana-pins`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { markets?: PinnedMarket[] };
    return data.markets ?? [];
  } catch {
    return [];
  }
}
