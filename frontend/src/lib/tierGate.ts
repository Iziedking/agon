/// Tier gate client. A host records which agent tiers may enter a campaign
/// after creating it; everyone else reads the gate to show the badge and block
/// out-of-range agents at entry.

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

export interface TierGate {
  minTier: number;
  maxTier: number;
}

/// Host presets shown in the create modals.
export const GATE_PRESETS: Array<{ label: string; min: number; max: number }> = [
  { label: "ALL TIERS", min: 0, max: 4 },
  { label: "TIER 0-2", min: 0, max: 2 },
  { label: "TIER 3-4", min: 3, max: 4 },
];

export async function submitTierGate(
  surface: "contest" | "challenge",
  eventId: number,
  minTier: number,
  maxTier: number,
): Promise<void> {
  // 0..4 is open; nothing to record.
  if (minTier === 0 && maxTier === 4) return;
  try {
    await fetch(`${AUTH_URL}/tier-gates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ surface, eventId, minTier, maxTier }),
    });
  } catch {
    /* best-effort; the campaign still exists ungated if this fails */
  }
}

export async function fetchTierGate(
  surface: "contest" | "challenge",
  eventId: number,
): Promise<TierGate | null> {
  try {
    const res = await fetch(`${AUTH_URL}/tier-gates/${surface}/${eventId}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { gate: TierGate | null };
    return data.gate;
  } catch {
    return null;
  }
}

export function gateLabel(gate: TierGate | null): string | null {
  if (!gate) return null;
  if (gate.minTier === gate.maxTier) return `TIER ${gate.minTier} ONLY`;
  return `TIER ${gate.minTier}-${gate.maxTier}`;
}

export function tierAllowed(gate: TierGate | null, tier: number): boolean {
  if (!gate) return true;
  return tier >= gate.minTier && tier <= gate.maxTier;
}
