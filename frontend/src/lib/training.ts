/// Client API for agent training. Mirrors the backend coordinator/training.ts
/// module: six stats, levels 0..20, Cycles cost (N+1)*50, time gate set by
/// the server's TRAINING_BASE_SECONDS_PER_LEVEL env (default 30min/level prod,
/// 30s/level in the demo environment).

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

export type Stat = "power" | "precision" | "speed" | "endurance" | "luck" | "focus";

export const STATS: Stat[] = ["power", "precision", "speed", "endurance", "luck", "focus"];
export const MAX_STAT_LEVEL = 20;

export interface TrainingState {
  id: number;
  stats: Record<Stat, number>;
  maxLevel: number;
  active: {
    stat: Stat;
    fromLevel: number;
    toLevel: number;
    cyclesSpent: string;
    startedAt: string;
    completesAt: string;
  } | null;
}

export function cyclesCost(fromLevel: number): number {
  return (fromLevel + 1) * 50;
}

const STAT_DESCRIPTIONS: Record<Stat, string> = {
  power: "raw output: volume, pnl, total ops",
  precision: "hit rate: puzzle correctness, brier score",
  speed: "time-to-finish: faster solves rank higher",
  endurance: "more attempts before scoring failure",
  luck: "dampens per-kind randomness against you",
  focus: "resistance to noise on top of skill",
};
export function statDescription(s: Stat): string {
  return STAT_DESCRIPTIONS[s];
}

export async function fetchTraining(agentId: number): Promise<TrainingState | null> {
  try {
    const res = await fetch(`${AUTH_URL}/agents/${agentId}/training`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as TrainingState;
  } catch {
    return null;
  }
}

export async function startTraining(
  agentId: number,
  stat: Stat,
): Promise<{ ok: true; cyclesBalance: string; secondsTotal: number } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${AUTH_URL}/agents/${agentId}/training/start`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stat }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      cyclesBalance?: string;
      secondsTotal?: number;
    };
    if (!res.ok) return { ok: false, error: data.error ?? "could not start training" };
    return { ok: true, cyclesBalance: data.cyclesBalance ?? "0", secondsTotal: data.secondsTotal ?? 0 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

export async function cancelTraining(
  agentId: number,
): Promise<{ ok: true; refunded: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${AUTH_URL}/agents/${agentId}/training/cancel`, {
      method: "POST",
      credentials: "include",
    });
    const data = (await res.json().catch(() => ({}))) as { refunded?: string; error?: string };
    if (!res.ok) return { ok: false, error: data.error ?? "could not cancel" };
    return { ok: true, refunded: data.refunded ?? "0" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

export async function finishEarly(
  agentId: number,
): Promise<{ ok: true; surcharge: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${AUTH_URL}/agents/${agentId}/training/finish-early`, {
      method: "POST",
      credentials: "include",
    });
    const data = (await res.json().catch(() => ({}))) as { surcharge?: string; error?: string };
    if (!res.ok) return { ok: false, error: data.error ?? "could not finish early" };
    return { ok: true, surcharge: data.surcharge ?? "0" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}
