/// The trait pool plus the rarity-weighted picker used by /mystery/claim and,
/// later, by the coordinator's per-contest reward path. Define once, share
/// between the auth service and (mirrored) the frontend display. The frontend
/// has its own copy for chip labels; this one is the source of truth for what
/// can be awarded.

export type Rarity = "common" | "rare" | "epic" | "legendary";

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

export const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

export function traitById(id: string): Trait | undefined {
  return TRAITS.find((t) => t.id === id);
}
