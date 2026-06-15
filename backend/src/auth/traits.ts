/// The trait pool plus the rarity-weighted picker used by /mystery/claim and,
/// later, by the coordinator's per-contest reward path. Define once, share
/// between the auth service and (mirrored) the frontend display. The frontend
/// has its own copy for chip labels; this one is the source of truth for what
/// can be awarded.

export type Rarity = "common" | "rare" | "legendary";

/// Coarse score-bonus per rarity, kept as a reference for owned-trait summaries.
/// The real, tier-scaled, per-event effects now live per EQUIPPED loadout in
/// scoring/strength.ts (whale per-tier size, Speed across all events, etc.).
/// common is a tiny nudge, rare small, legendary large.
export const RARITY_MULTIPLIER: Record<Rarity, number> = {
  common: 0.02,
  rare: 0.12,
  legendary: 0.35,
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
  // ----- LEGENDARY (5): one peculiar to each event, plus two generic. The big
  // movers. A lower tier with the right legendary beats a higher tier without.
  { id: "whale_spotter",    name: "Whale Spotter",     rarity: "legendary", body: "volume legendary. trade far bigger than your tier allows: per-swap size jumps 1.5x to 3.5x by tier, giving a lower tier a real shot at out-voluming a higher one." },
  { id: "puzzle_savant",    name: "Puzzle Savant",     rarity: "legendary", body: "puzzle legendary. a huge reasoning budget and extra attempts, so the agent solves more and faster. tier-scaled." },
  { id: "oracle_eye",       name: "Oracle's Eye",      rarity: "legendary", body: "prediction legendary. a big edge on calls and more trades per round. tier-scaled." },
  { id: "velocity",         name: "Velocity",          rarity: "legendary", body: "generic legendary (speed). acts faster in every event: more swaps, faster solves, more trades. closes the gap on a higher tier's natural speed." },
  { id: "arc_sovereign",    name: "Arc Sovereign",     rarity: "legendary", body: "generic legendary. a strong broad boost across every event. tier-scaled." },

  // ----- RARE (6): small but noticeable, domain-leaning (~10-15%).
  { id: "liquidity_hunter", name: "Liquidity Hunter",  rarity: "rare",      body: "volume rare. deeper pools, about 15% bigger fills per swap. tier-scaled." },
  { id: "volume_titan",     name: "Volume Titan",      rarity: "rare",      body: "volume rare. bigger and more frequent swaps, about 12%. tier-scaled." },
  { id: "quant_oracle",     name: "Quant Oracle",      rarity: "rare",      body: "prediction rare. a model ensemble, about 12% more score. tier-scaled." },
  { id: "tape_reader",      name: "Tape Reader",       rarity: "rare",      body: "prediction rare. reads the order tape, about 10% more score. tier-scaled." },
  { id: "solver_circuit",   name: "Solver Circuit",    rarity: "rare",      body: "puzzle rare. a bigger reasoning budget and an extra attempt. tier-scaled." },
  { id: "chain_breaker",    name: "Chain Breaker",     rarity: "rare",      body: "generic rare. a small boost across every event, about 10%. tier-scaled." },

  // ----- COMMON (14): a very tiny 1-2% nudge in their domain. mostly for the set.
  { id: "lucky_charm",      name: "Lucky Charm",       rarity: "common",    body: "common. a tiny luck nudge across every event." },
  { id: "dice_roller",      name: "Dice Roller",       rarity: "common",    body: "common. a tiny randomness bias across every event." },
  { id: "arc_initiate",     name: "Arc Initiate",      rarity: "common",    body: "common. a tiny all-round edge on Arc." },
  { id: "circle_protocol",  name: "Circle Protocol",   rarity: "common",    body: "common. a tiny calibrated edge across every event." },
  { id: "gas_whisperer",    name: "Gas Whisperer",     rarity: "common",    body: "common. a tiny execution edge across events." },
  { id: "speed_demon",      name: "Speed Demon",       rarity: "common",    body: "common. a few more swaps on volume runs, tiny." },
  { id: "mempool_diver",    name: "Mempool Diver",     rarity: "common",    body: "common. a few more swaps on volume runs, tiny." },
  { id: "gas_arb",          name: "Gas Arb",           rarity: "common",    body: "common. a few more swaps on volume runs, tiny." },
  { id: "quick_draw",       name: "Quick Draw",        rarity: "common",    body: "common. a touch more reasoning on puzzle solves." },
  { id: "hot_hand",         name: "Hot Hand",          rarity: "common",    body: "common. a touch more reasoning on puzzle solves." },
  { id: "pattern_reader",   name: "Pattern Reader",    rarity: "common",    body: "common. a tiny edge on prediction calls." },
  { id: "precision_engine", name: "Precision Engine",  rarity: "common",    body: "common. a tiny variance cut on prediction calls." },
  { id: "crystal_ball",     name: "Crystal Ball",      rarity: "common",    body: "common. a soft prior on prediction calls, tiny." },
  { id: "deep_state",       name: "Deep State",        rarity: "common",    body: "common. reads a little onchain state, tiny prediction edge." },
];

export type MysteryRarity = "common" | "rare" | "legendary";

function envProb(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : fallback;
}

/// Fixed mystery-box odds (env-overridable). Open a box: 65% rugged, 20% common,
/// 10% rare, 5% legendary. Across the 100 daily claim spots that is roughly 35
/// traits network-wide, with the legendary the scarce prize that makes a lower
/// tier dangerous. This replaces the old adaptive rug + rarity-weighted picker.
export const MYSTERY_ODDS = {
  rug: envProb("MYSTERY_P_RUG", 0.65),
  common: envProb("MYSTERY_P_COMMON", 0.2),
  rare: envProb("MYSTERY_P_RARE", 0.1),
  legendary: envProb("MYSTERY_P_LEGENDARY", 0.05),
};

/// Display value: how often a roll returns nothing.
export const RUG_CHANCE = MYSTERY_ODDS.rug;

/// Roll a rarity, or "rugged", by the fixed odds.
export function rollRarity(r: number = Math.random()): "rugged" | MysteryRarity {
  if (r < MYSTERY_ODDS.rug) return "rugged";
  if (r < MYSTERY_ODDS.rug + MYSTERY_ODDS.common) return "common";
  if (r < MYSTERY_ODDS.rug + MYSTERY_ODDS.common + MYSTERY_ODDS.rare) return "rare";
  return "legendary";
}

/// One mystery roll. Roll a rarity, then hand out a random trait of that rarity
/// the operator does not already own. If they own every trait of the rolled
/// rarity, degrade to the next rarity down so a win still lands. Only a true rug
/// (or owning literally everything) returns a null trait.
export function rollMystery(
  owned: ReadonlySet<string>,
): { rarity: "rugged" | MysteryRarity; trait: Trait | null } {
  const rolled = rollRarity();
  if (rolled === "rugged") return { rarity: "rugged", trait: null };
  const ladder: MysteryRarity[] =
    rolled === "legendary" ? ["legendary", "rare", "common"] : rolled === "rare" ? ["rare", "common"] : ["common"];
  for (const tier of ladder) {
    const pool = TRAITS.filter((t) => t.rarity === tier && !owned.has(t.id));
    if (pool.length > 0) {
      return { rarity: tier, trait: pool[Math.floor(Math.random() * pool.length)]! };
    }
  }
  return { rarity: "rugged", trait: null };
}

/// Pick a random unowned trait of an exact rarity (for win-streak unlocks).
export function pickRandomOfRarity(rarity: MysteryRarity, owned: ReadonlySet<string>): Trait | null {
  const pool = TRAITS.filter((t) => t.rarity === rarity && !owned.has(t.id));
  return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)]! : null;
}

export const COOLDOWN_MS = 24 * 60 * 60 * 1000; // legacy reference; daily UTC reset is the active rule

/// The whole network gets 100 claim spots a day, first come first served. A
/// claim is a ROLL, not a guaranteed trait. Configurable via env.
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
