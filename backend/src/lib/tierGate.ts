import { query } from "../db/pool.js";

/// Tier gates for contests and challenges. The on-chain contracts don't carry
/// a tier restriction, so the host's choice lives here. The entry UI reads it
/// to block out-of-range agents, and the coordinator reads it at settlement to
/// drop any entry whose agent tier falls outside the range (the real
/// enforcement, since a determined operator could call registerEntry on-chain
/// directly). No row means the campaign is open to every tier.

export type GateSurface = "contest" | "challenge";

export interface TierGate {
  minTier: number;
  maxTier: number;
}

const clamp = (n: number) => Math.max(0, Math.min(4, Math.floor(n)));

export async function setTierGate(
  surface: GateSurface,
  eventId: number,
  minTier: number,
  maxTier: number,
): Promise<void> {
  const lo = clamp(minTier);
  const hi = Math.max(lo, clamp(maxTier));
  // 0..4 is "open to all"; skip the row so the absence stays the default.
  if (lo === 0 && hi === 4) return;
  await query(
    `insert into event_tier_gates (surface, event_id, min_tier, max_tier)
     values ($1, $2, $3, $4)
     on conflict (surface, event_id) do update set min_tier = excluded.min_tier, max_tier = excluded.max_tier`,
    [surface, eventId, lo, hi],
  );
}

export async function getTierGate(surface: GateSurface, eventId: number): Promise<TierGate | null> {
  const { rows } = await query<{ min_tier: number; max_tier: number }>(
    "select min_tier, max_tier from event_tier_gates where surface = $1 and event_id = $2",
    [surface, eventId],
  );
  const r = rows[0];
  if (!r) return null;
  return { minTier: r.min_tier, maxTier: r.max_tier };
}

/// True when an agent of the given tier is allowed into the gated event.
/// Open events (no gate) admit every tier.
export function tierAllowed(gate: TierGate | null, tier: number): boolean {
  if (!gate) return true;
  return tier >= gate.minTier && tier <= gate.maxTier;
}
