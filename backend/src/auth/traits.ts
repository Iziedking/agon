/// The trait pool plus the rarity-weighted picker used by /mystery/claim and,
/// later, by the coordinator's per-contest reward path. Define once, share
/// between the auth service and (mirrored) the frontend display. The frontend
/// has its own copy for chip labels; this one is the source of truth for what
/// can be awarded.

export type Rarity = "common" | "rare" | "epic" | "legendary";

/// Score-bonus multiplier per rarity. Combined as 1 + sum(traits.multiplier),
/// capped at MAX_AGENT_MULTIPLIER. A maxed agent with every trait in the pool
/// caps out near +100%; a single common is +3%. The coordinator reads these
/// from `agent_traits` and applies them after final scoring.
export const RARITY_MULTIPLIER: Record<Rarity, number> = {
  common: 0.03,
  rare: 0.06,
  epic: 0.12,
  legendary: 0.25,
};
export const MAX_AGENT_MULTIPLIER = 2.0;

export interface Trait {
  id: string;
  name: string;
  rarity: Rarity;
  body: string;
}

/// The pool. Adding a trait here makes it claimable on the next mystery roll.
/// Renaming an id orphans existing awards, so don't rename ids once a trait has
/// been awarded in production.
export const TRAITS: Trait[] = [
  { id: "lucky_charm", name: "Lucky Charm", rarity: "common", body: "small luck nudge across every contest type." },
  { id: "speed_demon", name: "Speed Demon", rarity: "common", body: "moves first on volume runs." },
  { id: "hot_hand", name: "Hot Hand", rarity: "common", body: "streak bonus after a win." },
  { id: "pattern_reader", name: "Pattern Reader", rarity: "rare", body: "sharper on prediction markets." },
  { id: "whale_spotter", name: "Whale Spotter", rarity: "rare", body: "edge in liquidity contests." },
  { id: "gas_whisperer", name: "Gas Whisperer", rarity: "rare", body: "tighter execution on scout runs." },
  { id: "puzzle_savant", name: "Puzzle Savant", rarity: "epic", body: "crushes complex solves." },
  { id: "arc_initiate", name: "Arc Initiate", rarity: "epic", body: "first ones through the gate carry weight." },
  { id: "deep_state", name: "Deep State", rarity: "epic", body: "reads onchain state most agents miss." },
  { id: "chain_breaker", name: "Chain Breaker", rarity: "legendary", body: "rare boost across every contest family." },
  { id: "oracle_eye", name: "Oracle's Eye", rarity: "legendary", body: "edge on the noisiest kinds." },
];

const RARITY_WEIGHT: Record<Rarity, number> = {
  common: 60,
  rare: 25,
  epic: 12,
  legendary: 3,
};

/// Chance of a rugged outcome (nothing awarded) on any given claim. Cooldown
/// still ticks so a rug burns the daily roll. Tunable via env so it's easy to
/// dial during the demo.
export const RUG_CHANCE: number = (() => {
  const raw = Number(process.env.MYSTERY_RUG_CHANCE);
  if (!Number.isFinite(raw) || raw < 0 || raw > 1) return 0.25;
  return raw;
})();

/// Pick one trait at random, weighted by rarity. Returns null if the list is
/// empty (e.g., the agent already owns every trait).
export function pickWeighted(pool: Trait[]): Trait | null {
  if (pool.length === 0) return null;
  const total = pool.reduce((sum, t) => sum + RARITY_WEIGHT[t.rarity], 0);
  let r = Math.random() * total;
  for (const t of pool) {
    r -= RARITY_WEIGHT[t.rarity];
    if (r <= 0) return t;
  }
  return pool[pool.length - 1] ?? null;
}

/// One mystery roll. First flips for the rugged outcome (returns {rugged:true,
/// trait:null}). If not rugged, picks a trait from the supplied pool. Caller is
/// expected to have already filtered the pool to traits the agent doesn't own.
export function rollMystery(pool: Trait[]): { rugged: boolean; trait: Trait | null } {
  if (Math.random() < RUG_CHANCE) return { rugged: true, trait: null };
  return { rugged: false, trait: pickWeighted(pool) };
}

export const COOLDOWN_MS = 24 * 60 * 60 * 1000; // legacy reference; daily UTC reset is the active rule

/// Total mystery boxes available globally per UTC day. First-come, first-served.
/// Configurable via env so the demo can be tuned.
export const DAILY_POOL_MAX: number = (() => {
  const raw = Number(process.env.MYSTERY_DAILY_POOL);
  if (!Number.isFinite(raw) || raw <= 0) return 100;
  return Math.floor(raw);
})();

/// Epoch milliseconds for the next midnight UTC. The cooldown and pool both
/// roll over at that boundary, so this is the single timestamp the UI needs.
export function nextResetMs(now: Date = new Date()): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
}

/// True if the given timestamp falls on the same UTC day as `now`.
export function sameUtcDay(prev: Date, now: Date = new Date()): boolean {
  return (
    prev.getUTCFullYear() === now.getUTCFullYear() &&
    prev.getUTCMonth() === now.getUTCMonth() &&
    prev.getUTCDate() === now.getUTCDate()
  );
}

export function traitById(id: string): Trait | undefined {
  return TRAITS.find((t) => t.id === id);
}
