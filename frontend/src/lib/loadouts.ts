/// Trait loadout helpers per docs/agentTier.md. The pool is profile-level
/// (any trait owned by any of the operator's agents is available for any
/// agent to equip). Max 3 equipped per entry. Certain pairs clash.

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

export const MAX_EQUIPPED = 3;

/// Trait pairs that can't be equipped together. Mirror of the backend
/// CLASH_PAIRS so we can warn inline before posting. Backend rejects
/// stale clashes too.
const CLASH_PAIRS: Array<[string, string]> = [
  ["lucky_charm", "pattern_reader"],
  ["lucky_charm", "oracle_eye"],
  ["chain_breaker", "deep_state"],
  ["hot_hand", "lucky_charm"],
];

export function clashesWith(a: string, b: string): boolean {
  if (a === b) return false;
  for (const [x, y] of CLASH_PAIRS) {
    if ((x === a && y === b) || (x === b && y === a)) return true;
  }
  return false;
}

export function clashInLoadout(candidate: string, current: string[]): string | null {
  for (const c of current) if (clashesWith(candidate, c)) return c;
  return null;
}

export interface TraitDef {
  id: string;
  name: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  body: string;
}

export interface TraitPool {
  owned: string[];
  catalogue: TraitDef[];
  maxEquipped: number;
}

export async function fetchTraitPool(address: string): Promise<TraitPool> {
  try {
    const res = await fetch(`${AUTH_URL}/operators/${address}/traits`, { cache: "no-store" });
    if (!res.ok) return { owned: [], catalogue: [], maxEquipped: MAX_EQUIPPED };
    return (await res.json()) as TraitPool;
  } catch {
    return { owned: [], catalogue: [], maxEquipped: MAX_EQUIPPED };
  }
}

export async function fetchLoadout(
  source: "contest" | "challenge",
  eventId: number,
  agentId: number,
): Promise<string[]> {
  try {
    const res = await fetch(`${AUTH_URL}/loadouts/${source}/${eventId}/${agentId}`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as { traitIds?: string[] };
    return data.traitIds ?? [];
  } catch {
    return [];
  }
}

export async function saveLoadout(
  source: "contest" | "challenge",
  eventId: number,
  agentId: number,
  traitIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${AUTH_URL}/loadouts/${source}/${eventId}`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId, traitIds }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok) return { ok: false, error: body.error ?? "could not save loadout" };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "could not save loadout" };
  }
}

export interface EntryCaps {
  liveCount: number;
  maxLive: number;
  atCap: boolean;
}

export async function fetchEntryCaps(address: string): Promise<EntryCaps> {
  try {
    const res = await fetch(`${AUTH_URL}/operators/${address}/entry-caps`, { cache: "no-store" });
    if (!res.ok) return { liveCount: 0, maxLive: 3, atCap: false };
    return (await res.json()) as EntryCaps;
  } catch {
    return { liveCount: 0, maxLive: 3, atCap: false };
  }
}

export async function fetchInEvent(
  address: string,
  source: "contest" | "challenge",
  eventId: number,
): Promise<boolean> {
  try {
    const res = await fetch(`${AUTH_URL}/operators/${address}/in-event/${source}/${eventId}`, {
      cache: "no-store",
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { inEvent?: boolean };
    return Boolean(data.inEvent);
  } catch {
    return false;
  }
}
