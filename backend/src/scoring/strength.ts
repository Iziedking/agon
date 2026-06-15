/// Effective agent strength for a given contest. Three multiplicative
/// stages, in strict priority order:
///
///   strength = tierBase × trainingMultiplier × traitMultiplier
///
/// Tier dominates. Training fine-tunes within a tier-gated cap. Traits
/// skew the run in a specific direction, capped so they can never
/// out-multiply tier on their own. The full design and the worked
/// examples that mirror what users see in the workshop are in
/// `agentTier.md`.

export type ContestType = "solver" | "analyst" | "scout";

/// Tier base curve. Steeper than the typical RPG ladder because the
/// marketing position is "tier 4 is the best agent on Arc, period."
export const TIER_BASE = [1, 2, 4, 8, 16] as const;

/// Maximum percentage that training can add on top of the tier base.
/// Higher tiers can be trained further, so the absolute ceiling scales,
/// but a fully-trained low tier can never leapfrog an untrained higher
/// tier. See agentTier.md for the proof.
export const TIER_TRAINING_CAP = [0.10, 0.15, 0.25, 0.35, 0.50] as const;

export type StatName = "POWER" | "PRECISION" | "SPEED" | "ENDURANCE" | "LUCK" | "FOCUS";
export const STAT_NAMES: StatName[] = ["POWER", "PRECISION", "SPEED", "ENDURANCE", "LUCK", "FOCUS"];

/// How much each stat counts toward training relevance per contest type.
/// Rows sum to 1.0 so the ratio (relevant / max) lands in [0, 1].
export const STAT_WEIGHTS: Record<ContestType, Record<StatName, number>> = {
  solver:  { POWER: 0.25, PRECISION: 0.30, SPEED: 0.10, ENDURANCE: 0.10, LUCK: 0.05, FOCUS: 0.20 },
  analyst: { POWER: 0.15, PRECISION: 0.35, SPEED: 0.05, ENDURANCE: 0.10, LUCK: 0.10, FOCUS: 0.25 },
  scout:   { POWER: 0.10, PRECISION: 0.10, SPEED: 0.30, ENDURANCE: 0.30, LUCK: 0.05, FOCUS: 0.15 },
};

/// Hard cap on trait stacking. Three equipped traits cannot multiply
/// score by more than this regardless of their individual values, so a
/// trait-loaded loadout can never out-multiply tier.
export const TRAIT_STACK_CAP = 1.40;

/// How strongly traits express at each tier. A trait's effect (both the score
/// multiplier and the concrete scout abilities below) is scaled by this, so the
/// SAME trait does more on a higher-tier agent. This is what makes "tier 4 with
/// the right three traits" the strongest loadout in the arena: low tiers get a
/// fraction of the trait's effect, tier 4 gets it amplified.
export const TIER_TRAIT_SCALE = [0.4, 0.6, 0.8, 1.0, 1.3] as const;

export function tierTraitScale(tier: number): number {
  const t = Math.max(0, Math.min(4, Math.floor(tier)));
  return TIER_TRAIT_SCALE[t]!;
}

/// ------------------------------------------------------------------------
/// Trait effect engine (v2). One source of truth: each trait id maps to a
/// rarity, the event DOMAIN it belongs to, and concrete effect knobs. The
/// aggregators below turn an EQUIPPED loadout into per-event abilities, all
/// tier-scaled by tierTraitScale so a higher tier expresses the same trait more
/// strongly. A trait does something only when its domain matches the event (or
/// it is generic), which is what makes choosing the right three per event the
/// whole game. Magnitudes by rarity: common ~1-2%, rare ~10-15%, legendary big.
/// Training (the stat multiplier above) is the PERMANENT boost; traits are the
/// TEMPORARY equipped boost. Their product is the agent's edge.
/// ------------------------------------------------------------------------

export type TraitDomain = "volume" | "puzzle" | "prediction" | "generic";

export interface TraitDef {
  rarity: "common" | "rare" | "legendary";
  domain: TraitDomain;
  /// Volume per-swap SIZE bonus. A number is tier-scaled; a 5-length array is a
  /// per-tier curve used as-is (the legendary Whale Spotter), already encoding
  /// the tier scaling.
  size?: number | readonly [number, number, number, number, number];
  /// Volume swap COUNT bonus (more round-trips).
  count?: number;
  /// Prediction / generic SCORE multiplier bonus.
  score?: number;
  /// Prediction extra-TRADES fraction (more positions per round).
  trades?: number;
  /// Puzzle reasoning-budget bonus (pure-skill safe, never touches x402).
  capability?: number;
  /// Puzzle extra attempt(s).
  retries?: number;
  /// Generic SPEED: acts in every event at once. The legendary all-rounder.
  speed?: boolean;
}

/// Speed legendary magnitudes across the three events (tier-scaled at apply).
const SPEED_COUNT = 0.6; // volume: swaps
const SPEED_CAPABILITY = 0.5; // puzzle: reasoning
const SPEED_SCORE = 0.3; // prediction: score
const SPEED_TRADES = 0.5; // prediction: trades

export const TRAIT_DEF: Record<string, TraitDef> = {
  // ----- Legendary: one per event plus two generic. The big movers.
  whale_spotter: { rarity: "legendary", domain: "volume", size: [0.5, 1.0, 1.3, 2.0, 2.5] },
  puzzle_savant: { rarity: "legendary", domain: "puzzle", capability: 0.6, retries: 1 },
  oracle_eye: { rarity: "legendary", domain: "prediction", score: 0.3, trades: 0.5 },
  velocity: { rarity: "legendary", domain: "generic", speed: true },
  arc_sovereign: { rarity: "legendary", domain: "generic", score: 0.2, count: 0.2, capability: 0.3 },

  // ----- Rare: small but noticeable in their domain (~10-15%).
  liquidity_hunter: { rarity: "rare", domain: "volume", size: 0.15 },
  volume_titan: { rarity: "rare", domain: "volume", size: 0.1, count: 0.1 },
  quant_oracle: { rarity: "rare", domain: "prediction", score: 0.12 },
  tape_reader: { rarity: "rare", domain: "prediction", score: 0.1 },
  solver_circuit: { rarity: "rare", domain: "puzzle", capability: 0.3, retries: 1 },
  chain_breaker: { rarity: "rare", domain: "generic", score: 0.1, count: 0.1, capability: 0.15 },

  // ----- Common: a very tiny 1-2% nudge in their domain.
  lucky_charm: { rarity: "common", domain: "generic", score: 0.015, count: 0.015, capability: 0.03 },
  dice_roller: { rarity: "common", domain: "generic", score: 0.015, count: 0.015, capability: 0.03 },
  arc_initiate: { rarity: "common", domain: "generic", score: 0.015, count: 0.015, capability: 0.03 },
  circle_protocol: { rarity: "common", domain: "generic", score: 0.015, count: 0.015, capability: 0.03 },
  gas_whisperer: { rarity: "common", domain: "generic", count: 0.02, capability: 0.03 },
  speed_demon: { rarity: "common", domain: "volume", count: 0.02 },
  mempool_diver: { rarity: "common", domain: "volume", count: 0.02 },
  gas_arb: { rarity: "common", domain: "volume", count: 0.02 },
  quick_draw: { rarity: "common", domain: "puzzle", capability: 0.05 },
  hot_hand: { rarity: "common", domain: "puzzle", capability: 0.05 },
  pattern_reader: { rarity: "common", domain: "prediction", score: 0.015 },
  precision_engine: { rarity: "common", domain: "prediction", score: 0.015 },
  crystal_ball: { rarity: "common", domain: "prediction", score: 0.015 },
  deep_state: { rarity: "common", domain: "prediction", score: 0.015 },
};

// Caps so a stack can't run away. Whale legendary needs a high size cap.
const SIZE_CAP = 3.0;
const COUNT_CAP = 2.0;
const SCORE_CAP = 0.6; // max +60% prediction score from a trait loadout

function clampTier(tier: number): number {
  return Math.max(0, Math.min(4, Math.floor(tier)));
}

/// Volume: per-swap size multiplier and swap-count multiplier from the equipped
/// loadout. Whale Spotter's per-tier size curve applies as-is; everything else
/// is tier-scaled. Speed adds swap count. The wallet balance clamps the real
/// size again at execution.
export function scoutTraitAbilities(
  equipped: ReadonlyArray<string>,
  tier: number,
): { sizeMult: number; countMult: number } {
  const scale = tierTraitScale(tier);
  const t = clampTier(tier);
  let size = 0;
  let count = 0;
  for (const id of equipped) {
    const d = TRAIT_DEF[id.toLowerCase()];
    if (!d) continue;
    if (Array.isArray(d.size)) size += d.size[t]!; // whale: per-tier, as-is
    else if (typeof d.size === "number") size += d.size * scale;
    if (d.count) count += d.count * scale;
    if (d.speed) count += SPEED_COUNT * scale;
  }
  return { sizeMult: 1 + Math.min(SIZE_CAP, size), countMult: 1 + Math.min(COUNT_CAP, count) };
}

/// Puzzle: reasoning-budget multiplier and extra retries. Pure-skill safe; never
/// touches the x402 research gate. Speed adds reasoning budget.
export function solverTraitAbilities(
  equipped: ReadonlyArray<string>,
  tier: number,
): { tokenMult: number; extraRetries: number } {
  const scale = tierTraitScale(tier);
  let tokens = 0;
  let retries = 0;
  for (const id of equipped) {
    const d = TRAIT_DEF[id.toLowerCase()];
    if (!d) continue;
    if (d.capability) tokens += d.capability * scale;
    if (d.retries) retries += d.retries;
    if (d.speed) tokens += SPEED_CAPABILITY * scale;
  }
  return { tokenMult: 1 + Math.min(1.0, tokens), extraRetries: Math.min(2, retries) };
}

/// Prediction (analyst): the score multiplier from prediction-domain and generic
/// traits, plus Speed. Volume/puzzle traits contribute nothing, so a whale
/// equipped on a prediction round is dead weight.
export function predictionTraitMultiplier(equipped: ReadonlyArray<string>, tier: number): number {
  const scale = tierTraitScale(tier);
  let score = 0;
  for (const id of equipped) {
    const d = TRAIT_DEF[id.toLowerCase()];
    if (!d) continue;
    if ((d.domain === "prediction" || d.domain === "generic") && d.score) score += d.score * scale;
    if (d.speed) score += SPEED_SCORE * scale;
  }
  return 1 + Math.min(SCORE_CAP, score);
}

/// Prediction: extra-trades fraction (more positions per round) from Oracle's
/// Eye, generic traits, and Speed. Runner reads it to raise the trade count.
export function predictionTradeBonus(equipped: ReadonlyArray<string>, tier: number): number {
  const scale = tierTraitScale(tier);
  let trades = 0;
  for (const id of equipped) {
    const d = TRAIT_DEF[id.toLowerCase()];
    if (!d) continue;
    if (d.trades) trades += d.trades * scale;
    if (d.speed) trades += SPEED_TRADES * scale;
  }
  return Math.min(1.0, trades);
}

export function tierBase(tier: number): number {
  const t = Math.max(0, Math.min(4, Math.floor(tier)));
  return TIER_BASE[t]!;
}

export function tierTrainingCap(tier: number): number {
  const t = Math.max(0, Math.min(4, Math.floor(tier)));
  return TIER_TRAINING_CAP[t]!;
}

/// Permanent per-level training bonus. Index = stat level (0..5). Training is
/// the agent's PERMANENT edge; traits are the temporary equipped one. A stat at
/// level 5 contributes a 1.5 bonus, weighted by how much it matters for the
/// event, so with every relevant stat maxed the training multiplier tops out
/// near 2.5x. There is NO tier cap: a well-trained low tier is meant to threaten
/// a higher untrained one, which is what makes the grind worth it.
export const TRAIN_LEVEL_BONUS = [0, 0.2, 0.4, 0.7, 1.0, 1.5] as const;
export const MAX_TRAIN_LEVEL = 5;

/// Training multiplier from the agent's stat levels (each 0..5), weighted by
/// what matters for `contest`. Levels above 5 (legacy data) clamp to 5.
export function trainingMultiplier(
  stats: Partial<Record<StatName, number>>,
  contest: ContestType,
  tier: number,
): number {
  void tier; // training is no longer tier-capped; it is a flat permanent boost
  const w = STAT_WEIGHTS[contest];
  let bonus = 0;
  for (const name of STAT_NAMES) {
    const lvl = Math.max(0, Math.min(MAX_TRAIN_LEVEL, Math.floor(stats[name] ?? 0)));
    bonus += TRAIN_LEVEL_BONUS[lvl]! * w[name];
  }
  return 1 + bonus;
}

/// The trait SCORE multiplier folded into effectiveStrength. Only prediction
/// (analyst) uses a score multiplier; scout and solver express traits as
/// concrete abilities (bigger/more swaps, reasoning budget), not a score factor,
/// so they return 1.0 here. Routing is retired in v2 (kept null for the runner's
/// applyRouting, which then just applies the deterministic multiplier).
export function traitMultiplier(
  equipped: ReadonlyArray<string>,
  contest: ContestType,
  tier = 4,
): { multiplier: number; routing: TraitRouting } {
  const multiplier = contest === "analyst" ? predictionTraitMultiplier(equipped, tier) : 1;
  return { multiplier, routing: null };
}

export type TraitRouting = "stochastic" | "momentum" | "calibrated" | null;

export interface StrengthBreakdown {
  tier: number;
  tierBase: number;
  training: number;
  traits: number;
  effective: number;
  routing: TraitRouting;
}

/// One-shot computation for the workshop breakdown panel and for the
/// runner's score multiplier. Pure function, easy to test, easy to show
/// the user "you got X because tier × Y × Z".
export function effectiveStrength(
  tier: number,
  stats: Partial<Record<StatName, number>>,
  equipped: ReadonlyArray<string>,
  contest: ContestType,
): StrengthBreakdown {
  const base = tierBase(tier);
  const train = trainingMultiplier(stats, contest, tier);
  const { multiplier: trait, routing } = traitMultiplier(equipped, contest, tier);
  return {
    tier,
    tierBase: base,
    training: train,
    traits: trait,
    effective: base * train * trait,
    routing,
  };
}
