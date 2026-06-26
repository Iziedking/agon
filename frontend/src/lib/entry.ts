/// Pre-entry concurrency check shared by every entry flow (contests, missions,
/// challenges): one agent per event, and at most a few concurrent events per
/// operator. Called before any on-chain entry so a busy agent or an over-cap
/// operator is stopped before money moves. On a network error it does NOT block
/// (the backend backstops still apply where the entry is server-recorded).

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

export interface EntryCheck {
  ok: boolean;
  reason?: string;
  activeEvents: number;
  cap: number;
}

export async function checkEntry(agentId: number, contestId?: number): Promise<EntryCheck> {
  try {
    const q = new URLSearchParams({ agentId: String(agentId) });
    if (contestId != null) q.set("contestId", String(contestId));
    const res = await fetch(`${AUTH_URL}/entry/check?${q.toString()}`, {
      credentials: "include",
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as Partial<EntryCheck> & { reason?: string };
    if (!res.ok) return { ok: false, reason: data.reason ?? "cannot enter right now", activeEvents: 0, cap: 3 };
    return { ok: Boolean(data.ok), reason: data.reason, activeEvents: data.activeEvents ?? 0, cap: data.cap ?? 3 };
  } catch {
    return { ok: true, activeEvents: 0, cap: 3 };
  }
}
