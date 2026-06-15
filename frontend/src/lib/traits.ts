/// Client for the trait + mystery endpoints on the auth service. Traits are an
/// agent's accumulated personality: lucky charm, oracle's eye, etc, with rarity
/// tiers. Today they're visual; the v1 hookup wires them into the runners as
/// score multipliers, see the roadmap note in `coordinator/reputation.ts`.
///
/// Traits live server-side keyed off agent id (not wallet), so when v2 ships
/// transferable agents on ERC-7857, traits travel with the NFT.

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

export type Rarity = "common" | "rare" | "legendary";

export interface Trait {
  id: string;
  name: string;
  rarity: Rarity;
  body: string;
}

export interface OwnedTrait extends Trait {
  source: string;
  sourceRef: string | null;
  awardedAt: string;
}

export interface CooldownStatus {
  ready: boolean;
  lastClaim: string | null;
  nextAvailable: number; // epoch ms; 0 means never claimed
  totalClaims: number;
}

/// Global daily mystery pool status. 100 claim spots a day, first come first
/// served; `remaining` is how many are left, `resetsAt` the next 01:00 UTC. The
/// per-box odds are intentionally NOT surfaced; the box is meant to be a fun
/// gamble, not a spreadsheet.
export interface PoolStatus {
  max: number;
  claimed: number;
  remaining: number;
  resetsAt: number;
}

export interface ClaimResult {
  trait: Trait | null;
  rugged: boolean;
  /// Rarity of the trait won ("common" | "rare" | "legendary"), or "rugged".
  rarity?: Rarity | "rugged";
  agentId: number;
}

export const RARITY_COLOR: Record<Rarity, { text: string; bg: string; border: string }> = {
  common: { text: "#5F7A99", bg: "rgba(95, 122, 153, 0.10)", border: "rgba(95, 122, 153, 0.30)" },
  rare: { text: "#2563EB", bg: "rgba(37, 99, 235, 0.10)", border: "rgba(37, 99, 235, 0.30)" },
  legendary: { text: "#D97706", bg: "rgba(217, 119, 6, 0.12)", border: "rgba(217, 119, 6, 0.40)" },
};

export async function fetchTraitPool(): Promise<Trait[]> {
  try {
    const res = await fetch(`${AUTH_URL}/traits/pool`);
    if (!res.ok) return [];
    const data = (await res.json()) as { traits?: Trait[] };
    return data.traits ?? [];
  } catch {
    return [];
  }
}

export async function fetchAgentTraits(agentId: number): Promise<OwnedTrait[]> {
  try {
    const res = await fetch(`${AUTH_URL}/agents/${agentId}/traits`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as { traits?: OwnedTrait[] };
    return data.traits ?? [];
  } catch {
    return [];
  }
}

export async function fetchMysteryCooldown(): Promise<CooldownStatus | null> {
  try {
    const res = await fetch(`${AUTH_URL}/mystery/cooldown`, { credentials: "include" });
    if (!res.ok) return null;
    return (await res.json()) as CooldownStatus;
  } catch {
    return null;
  }
}

/// Reads how many mystery boxes are left in today's global pool. Public,
/// unauthenticated; safe to render alongside the cooldown.
export async function fetchMysteryPool(): Promise<PoolStatus | null> {
  try {
    const res = await fetch(`${AUTH_URL}/mystery/pool`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as PoolStatus;
  } catch {
    return null;
  }
}

export type ClaimResponse = ClaimResult | { error: string; nextAvailable?: number };

export function isClaimError(res: ClaimResponse): res is { error: string; nextAvailable?: number } {
  return "error" in res;
}

export async function claimMystery(agentId: number): Promise<ClaimResponse> {
  try {
    const res = await fetch(`${AUTH_URL}/mystery/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ agentId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error ?? "claim failed", nextAvailable: data.nextAvailable };
    return data as ClaimResult;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "claim failed" };
  }
}
