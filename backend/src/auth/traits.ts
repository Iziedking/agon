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
  // Commons (7) - easy wins, light buffs, get a few quickly.
  { id: "lucky_charm",      name: "Lucky Charm",       rarity: "common",    body: "small luck nudge across every contest type." },
  { id: "speed_demon",      name: "Speed Demon",       rarity: "common",    body: "moves first on volume runs." },
  { id: "hot_hand",         name: "Hot Hand",          rarity: "common",    body: "streak bonus after a win." },
  { id: "quick_draw",       name: "Quick Draw",        rarity: "common",    body: "shaves elapsed time on solver answers." },
  { id: "dice_roller",      name: "Dice Roller",       rarity: "common",    body: "small randomness bias across any contest." },
  { id: "mempool_diver",    name: "Mempool Diver",     rarity: "common",    body: "tighter scout op cadence." },
  { id: "crystal_ball",     name: "Crystal Ball",      rarity: "common",    body: "soft prior on analyst calls." },

  // Rares (7) - mid-grade, domain-specific edges.
  { id: "pattern_reader",   name: "Pattern Reader",    rarity: "rare",      body: "sharper on prediction markets." },
  { id: "whale_spotter",    name: "Whale Spotter",     rarity: "rare",      body: "edge in liquidity contests." },
  { id: "gas_whisperer",    name: "Gas Whisperer",     rarity: "rare",      body: "tighter execution on scout runs." },
  { id: "liquidity_hunter", name: "Liquidity Hunter",  rarity: "rare",      body: "finds the deeper pool faster." },
  { id: "precision_engine", name: "Precision Engine",  rarity: "rare",      body: "lower analyst variance per call." },
  { id: "gas_arb",          name: "Gas Arb",           rarity: "rare",      body: "free volume during cheap blocks." },
  { id: "tape_reader",      name: "Tape Reader",       rarity: "rare",      body: "reads the order tape, edges analyst." },

  // Epics (6) - heavy specialisation.
  { id: "puzzle_savant",    name: "Puzzle Savant",     rarity: "epic",      body: "crushes complex solves." },
  { id: "arc_initiate",     name: "Arc Initiate",      rarity: "epic",      body: "first ones through the gate carry weight." },
  { id: "deep_state",       name: "Deep State",        rarity: "epic",      body: "reads onchain state most agents miss." },
  { id: "quant_oracle",     name: "Quant Oracle",      rarity: "epic",      body: "model ensemble for analyst calls." },
  { id: "solver_circuit",   name: "Solver Circuit",    rarity: "epic",      body: "scaffolded reasoning on every solve." },
  { id: "volume_titan",     name: "Volume Titan",      rarity: "epic",      body: "uncapped per-op size on scout runs." },

  // Legendaries (4) - the trophies.
  { id: "chain_breaker",    name: "Chain Breaker",     rarity: "legendary", body: "rare boost across every contest family." },
  { id: "oracle_eye",       name: "Oracle's Eye",      rarity: "legendary", body: "edge on the noisiest kinds." },
  { id: "arc_sovereign",    name: "Arc Sovereign",     rarity: "legendary", body: "treats Arc as its home turf." },
  { id: "circle_protocol",  name: "Circle Protocol",   rarity: "legendary", body: "calibrated scoring across the board." },
];

/// Rarity weights for the mystery picker. Re-balanced from 60/25/12/3 so
/// commons aren't every other roll. Combined with the adaptive rug chance
/// below, a user who has cleared all the commons now feels the difference
/// when their pool is rare-and-above.
const RARITY_WEIGHT: Record<Rarity, number> = {
  common: 45,
  rare: 28,
  epic: 18,
  legendary: 9,
};

/// Base rug chance. The active value scales with how many traits the user
/// already owns so completing the set is earned rather than handed out.
/// Read via `rugChanceFor(ownedCount)`; the export here stays for any
/// UI surface that wants a "typical" number.
export const RUG_CHANCE: number = (() => {
  const raw = Number(process.env.MYSTERY_RUG_CHANCE);
  if (!Number.isFinite(raw) || raw < 0 || raw > 1) return 0.15;
  return raw;
})();

/// Adaptive rug chance per how many traits the user already owns. Early
/// game feels rewarding, late game feels earned. Override the base via
/// MYSTERY_RUG_CHANCE; the multipliers below stack on top.
export function rugChanceFor(ownedCount: number): number {
  const base = RUG_CHANCE;
  let factor = 1.0;
  if (ownedCount >= 4) factor = 1.4;
  if (ownedCount >= 8) factor = 2.2;
  if (ownedCount >= 16) factor = 3.0;
  return Math.min(0.7, base * factor);
}

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

/// One mystery roll. First flips for the rugged outcome (returns
/// {rugged:true, trait:null}) at the adaptive rate from `rugChanceFor`.
/// If not rugged, picks a trait from the supplied pool weighted by rarity.
/// Caller is expected to have already filtered the pool to traits the
/// agent doesn't own, and to pass the operator's total owned count so the
/// adaptive rug calc has the right input.
export function rollMystery(
  pool: Trait[],
  ownedCount: number = 0,
): { rugged: boolean; trait: Trait | null } {
  if (Math.random() < rugChanceFor(ownedCount)) return { rugged: true, trait: null };
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

/// Epoch milliseconds for the next mystery reset. The contract rolls over
/// at 01:00 UTC (one hour after UTC midnight). First-come-first-served:
/// the global daily pool fills until DAILY_POOL_MAX, then closes until
/// the next reset.
export function nextResetMs(now: Date = new Date()): number {
  const today01UTC = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    1, 0, 0, 0,
  );
  if (now.getTime() < today01UTC) return today01UTC;
  return today01UTC + 24 * 60 * 60 * 1000;
}

/// True if the given timestamp falls on the same claim day as `now`. A
/// claim day starts at 01:00 UTC and ends at the next 01:00 UTC. A
/// timestamp at 00:59 UTC is still "yesterday's" claim day; at 01:00 UTC
/// it flips to today.
export function sameUtcDay(prev: Date, now: Date = new Date()): boolean {
  return claimDayKey(prev) === claimDayKey(now);
}

/// String key for the claim day a timestamp belongs to. Shifts -1h so the
/// boundary lands at 01:00 UTC: anything from 01:00 UTC onward belongs
/// to that calendar UTC day; 00:00 to 00:59 UTC belongs to the previous.
export function claimDayKey(d: Date): string {
  const shifted = new Date(d.getTime() - 60 * 60 * 1000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

export function traitById(id: string): Trait | undefined {
  return TRAITS.find((t) => t.id === id);
}
