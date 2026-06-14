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
  { id: "lucky_charm",      name: "Lucky Charm",       rarity: "common",    body: "small luck nudge across every kind. scaled by tier." },
  { id: "speed_demon",      name: "Speed Demon",       rarity: "common",    body: "more swaps per volume run, up to 20% more trades. scaled by tier." },
  { id: "hot_hand",         name: "Hot Hand",          rarity: "common",    body: "solver capability: more reasoning budget and an extra attempt per puzzle. scaled by tier." },
  { id: "quick_draw",       name: "Quick Draw",        rarity: "common",    body: "solver capability: more reasoning budget and an extra attempt per puzzle. scaled by tier." },
  { id: "dice_roller",      name: "Dice Roller",       rarity: "common",    body: "small randomness bias across any kind. scaled by tier." },
  { id: "mempool_diver",    name: "Mempool Diver",     rarity: "common",    body: "15% more swaps on volume runs. scaled by tier." },
  { id: "crystal_ball",     name: "Crystal Ball",      rarity: "common",    body: "soft prior on analyst calls, small score edge. scaled by tier." },

  // Rares (7) - mid-grade, domain-specific edges.
  { id: "pattern_reader",   name: "Pattern Reader",    rarity: "rare",      body: "sharper prediction calls, up to 10% more analyst score. scaled by tier." },
  { id: "whale_spotter",    name: "Whale Spotter",     rarity: "rare",      body: "bigger trades, up to 35% larger per swap on volume runs. scaled by tier." },
  { id: "gas_whisperer",    name: "Gas Whisperer",     rarity: "rare",      body: "tighter execution, a few more swaps on volume runs. scaled by tier." },
  { id: "liquidity_hunter", name: "Liquidity Hunter",  rarity: "rare",      body: "deeper pools, 20% bigger fills on volume runs. scaled by tier." },
  { id: "precision_engine", name: "Precision Engine",  rarity: "rare",      body: "lower variance, up to 12% more analyst score. scaled by tier." },
  { id: "gas_arb",          name: "Gas Arb",           rarity: "rare",      body: "12% more swaps on volume runs. scaled by tier." },
  { id: "tape_reader",      name: "Tape Reader",       rarity: "rare",      body: "reads the tape, up to 10% more analyst score. scaled by tier." },

  // Epics (6) - heavy specialisation.
  { id: "puzzle_savant",    name: "Puzzle Savant",     rarity: "epic",      body: "solver capability: a big tier-scaled reasoning budget on hard puzzle solves." },
  { id: "arc_initiate",     name: "Arc Initiate",      rarity: "epic",      body: "edge across every kind, plus a small volume bump. scaled by tier." },
  { id: "deep_state",       name: "Deep State",        rarity: "epic",      body: "reads onchain state most miss, up to 15% more analyst score, calibrated. scaled by tier." },
  { id: "quant_oracle",     name: "Quant Oracle",      rarity: "epic",      body: "model ensemble, up to 18% more analyst score. scaled by tier." },
  { id: "solver_circuit",   name: "Solver Circuit",    rarity: "epic",      body: "solver capability: a tier-scaled reasoning budget and an extra attempt on puzzle solves." },
  { id: "volume_titan",     name: "Volume Titan",      rarity: "epic",      body: "whale-class trades, 30% bigger per swap and 10% more of them. scaled by tier." },

  // Legendaries (4) - the trophies.
  { id: "chain_breaker",    name: "Chain Breaker",     rarity: "legendary", body: "boost across every family, with bigger and more frequent trades on volume. scaled by tier." },
  { id: "oracle_eye",       name: "Oracle's Eye",      rarity: "legendary", body: "up to 20% more analyst score on the noisiest markets. scaled by tier." },
  { id: "arc_sovereign",    name: "Arc Sovereign",     rarity: "legendary", body: "Arc home turf. strongest cross-kind edge, plus bigger and more frequent trades. scaled by tier." },
  { id: "circle_protocol",  name: "Circle Protocol",   rarity: "legendary", body: "calibrated scoring across the board, plus a volume bump. scaled by tier." },
];

/// Rarity weights for the mystery picker. Skewed toward commons so a winning
/// roll is usually a light buff, and the trophies stay scarce. Placements are
/// the better path to epics and legendaries (see RANK_WEIGHTS in
/// coordinator/traits.ts): a contest win carries far higher odds of a rare
/// drop than the mystery box does.
const RARITY_WEIGHT: Record<Rarity, number> = {
  common: 56,
  rare: 26,
  epic: 13,
  legendary: 5,
};

/// Base rug chance: how often a roll returns nothing. Traits are meant to be
/// scarce, so even a fresh operator loses close to half their rolls. The
/// active value scales up with how many traits the operator already owns, so
/// completing the set is a grind rather than a handout. Read via
/// `rugChanceFor(ownedCount)`; the export here is the "typical" number a UI
/// can show. Override with MYSTERY_RUG_CHANCE (0..1).
export const RUG_CHANCE: number = (() => {
  const raw = Number(process.env.MYSTERY_RUG_CHANCE);
  if (!Number.isFinite(raw) || raw < 0 || raw > 1) return 0.45;
  return raw;
})();

/// Adaptive rug chance by how many traits the operator already owns. A
/// fresh roll loses ~45% of the time; by the time they hold most of the
/// catalogue, rolls lose ~85% of the time. The multipliers stack on the
/// base, and the result is capped so a roll always keeps some chance.
export function rugChanceFor(ownedCount: number): number {
  const base = RUG_CHANCE;
  let factor = 1.0;
  if (ownedCount >= 4) factor = 1.25;
  if (ownedCount >= 8) factor = 1.55;
  if (ownedCount >= 16) factor = 1.9;
  return Math.min(0.9, base * factor);
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

/// The whole network gets 100 claim spots a day, first come first served. A
/// claim is a ROLL, not a guaranteed trait. Configurable via env.
export const DAILY_POOL_MAX: number = (() => {
  const raw = Number(process.env.MYSTERY_DAILY_POOL);
  if (!Number.isFinite(raw) || raw <= 0) return 100;
  return Math.floor(raw);
})();

/// The day index (claim day, shifted -1h to the 01:00 UTC boundary). Stable
/// integer used for the every-14-days bonus cadence.
function claimDayNumber(now: Date): number {
  return Math.floor((now.getTime() - 60 * 60 * 1000) / (24 * 60 * 60 * 1000));
}

/// Bonus days carry far more winnable traits and appear once every 14 days,
/// deterministic so every instance agrees. MYSTERY_BONUS_OFFSET shifts which
/// day in the cycle is the bonus (testing / events).
export function isBonusDay(now: Date = new Date()): boolean {
  const offset = Number(process.env.MYSTERY_BONUS_OFFSET);
  const off = Number.isFinite(offset) ? ((Math.floor(offset) % 14) + 14) % 14 : 0;
  return ((claimDayNumber(now) % 14) + 14) % 14 === off;
}

/// How many actual traits can be WON network-wide on the given day. Winning is
/// the scarce part: out of 100 rolls, at most this many yield a trait (the rest
/// rug). Normal days cap at 3, bonus days at 7. Env-overridable.
export function dailyTraitWinCap(now: Date = new Date()): number {
  const bonus = isBonusDay(now);
  const normal = Number(process.env.MYSTERY_WIN_CAP);
  const bonusCap = Number(process.env.MYSTERY_WIN_CAP_BONUS);
  if (bonus) return Number.isFinite(bonusCap) && bonusCap > 0 ? Math.floor(bonusCap) : 7;
  return Number.isFinite(normal) && normal > 0 ? Math.floor(normal) : 3;
}

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
