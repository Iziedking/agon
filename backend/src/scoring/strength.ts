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

/// Concrete scout (volume) abilities a trait unlocks, separate from the abstract
/// score multiplier. `size` raises the per-swap USDC size (whale behaviour);
/// `count` raises the number of round-trips (speed behaviour). Both are
/// fractional bonuses, tier-scaled at apply time. Traits absent here grant no
/// scout ability. This is the "trait -> specific utility" mapping: equipping
/// Whale Spotter on a volume run literally makes the agent trade bigger.
export interface ScoutAbility {
  size?: number;
  count?: number;
}

export const SCOUT_TRAIT_ABILITY: Record<string, ScoutAbility> = {
  whale_spotter: { size: 0.35 },
  volume_titan: { size: 0.3, count: 0.1 },
  liquidity_hunter: { size: 0.2, count: 0.05 },
  speed_demon: { count: 0.2 },
  mempool_diver: { count: 0.15 },
  gas_arb: { count: 0.12 },
  gas_whisperer: { count: 0.08 },
  arc_initiate: { count: 0.06 },
  arc_sovereign: { size: 0.15, count: 0.15 },
  chain_breaker: { size: 0.12, count: 0.12 },
  circle_protocol: { size: 0.1, count: 0.1 },
};

/// Aggregate the equipped loadout into a per-swap size multiplier and a swap
/// count multiplier for the scout, tier-scaled. The raw bonus is capped before
/// scaling so three size traits can't run the trade away, and the wallet
/// balance clamps it again at execution.
export function scoutTraitAbilities(
  equipped: ReadonlyArray<string>,
  tier: number,
): { sizeMult: number; countMult: number } {
  const scale = tierTraitScale(tier);
  let size = 0;
  let count = 0;
  for (const id of equipped) {
    const ab = SCOUT_TRAIT_ABILITY[id.toLowerCase()];
    if (!ab) continue;
    size += ab.size ?? 0;
    count += ab.count ?? 0;
  }
  size = Math.min(0.5, size) * scale;
  count = Math.min(0.5, count) * scale;
  return { sizeMult: 1 + size, countMult: 1 + count };
}

/// Per-trait multiplier when the contest type matches the trait's
/// domain. Traits not listed here are pure flavor (no scoring impact)
/// or trigger active routing handled elsewhere (e.g. Lucky Charm's
/// stochastic component). See agentTier.md for the full catalogue.
export interface TraitEffect {
  /// Contest type this trait skews. Mismatched contests get no boost.
  domain: ContestType | "any";
  /// Multiplier applied to the agent's score when the trait is equipped
  /// and the contest matches.
  multiplier: number;
  /// Whether this trait additionally swaps the scoring algorithm. Only
  /// one routing trait per loadout takes effect; subsequent routing
  /// traits act as multipliers only. See the runner for the actual
  /// algorithm swap.
  routing?: "stochastic" | "momentum" | "calibrated";
}

export const TRAIT_EFFECTS: Record<string, TraitEffect> = {
  // Commons - small flat boosts
  lucky_charm:      { domain: "any",     multiplier: 1.05, routing: "stochastic" },
  speed_demon:      { domain: "scout",   multiplier: 1.05 },
  hot_hand:         { domain: "solver",  multiplier: 1.05, routing: "momentum" },
  quick_draw:       { domain: "solver",  multiplier: 1.04 },
  dice_roller:      { domain: "any",     multiplier: 1.03 },
  mempool_diver:    { domain: "scout",   multiplier: 1.05 },
  crystal_ball:     { domain: "analyst", multiplier: 1.04 },

  // Rares - mid-grade specialised edges
  pattern_reader:   { domain: "analyst", multiplier: 1.10 },
  whale_spotter:    { domain: "scout",   multiplier: 1.20 },
  gas_whisperer:    { domain: "any",     multiplier: 1.05 },
  liquidity_hunter: { domain: "scout",   multiplier: 1.12 },
  precision_engine: { domain: "analyst", multiplier: 1.12 },
  gas_arb:          { domain: "scout",   multiplier: 1.10 },
  tape_reader:      { domain: "analyst", multiplier: 1.10 },

  // Epics - heavy specialisation
  puzzle_savant:    { domain: "solver",  multiplier: 1.18 },
  arc_initiate:     { domain: "any",     multiplier: 1.10 },
  deep_state:       { domain: "analyst", multiplier: 1.15, routing: "calibrated" },
  quant_oracle:     { domain: "analyst", multiplier: 1.18 },
  solver_circuit:   { domain: "solver",  multiplier: 1.18 },
  volume_titan:     { domain: "scout",   multiplier: 1.20 },

  // Legendaries - the trophies (universal or top-tier)
  chain_breaker:    { domain: "any",     multiplier: 1.18 },
  oracle_eye:       { domain: "analyst", multiplier: 1.20 },
  arc_sovereign:    { domain: "any",     multiplier: 1.22 },
  circle_protocol:  { domain: "any",     multiplier: 1.20, routing: "calibrated" },
  // Legacy id kept so any rows persisted under the old key still resolve.
  oracles_eye:      { domain: "analyst", multiplier: 1.15 },
};

export function tierBase(tier: number): number {
  const t = Math.max(0, Math.min(4, Math.floor(tier)));
  return TIER_BASE[t]!;
}

export function tierTrainingCap(tier: number): number {
  const t = Math.max(0, Math.min(4, Math.floor(tier)));
  return TIER_TRAINING_CAP[t]!;
}

/// Training multiplier from the agent's six stat levels, weighted by
/// what matters for `contest`. Result is in [1.0, 1.0 + tierTrainingCap].
export function trainingMultiplier(
  stats: Partial<Record<StatName, number>>,
  contest: ContestType,
  tier: number,
): number {
  const w = STAT_WEIGHTS[contest];
  let relevant = 0;
  let max = 0;
  for (const name of STAT_NAMES) {
    const weight = w[name];
    relevant += (stats[name] ?? 0) * weight;
    max += 20 * weight;
  }
  const ratio = max > 0 ? relevant / max : 0;
  return 1 + ratio * tierTrainingCap(tier);
}

/// Trait stack multiplier and any active routing for `equipped` against
/// `contest`. The first equipped routing trait wins; the rest become
/// multipliers only. Total multiplier is capped at TRAIT_STACK_CAP.
export function traitMultiplier(
  equipped: ReadonlyArray<string>,
  contest: ContestType,
  tier = 4,
): { multiplier: number; routing: TraitEffect["routing"] | null } {
  // Tier scales how much of each trait's edge expresses, so the same trait is
  // worth more on a tier-4 agent than a tier-0 one.
  const scale = tierTraitScale(tier);
  let mul = 1.0;
  let routing: TraitEffect["routing"] | null = null;
  for (const traitId of equipped) {
    const fx = TRAIT_EFFECTS[traitId.toLowerCase()];
    if (!fx) continue;
    const applies = fx.domain === "any" || fx.domain === contest;
    if (!applies) continue;
    mul *= 1 + (fx.multiplier - 1) * scale;
    if (fx.routing && !routing) routing = fx.routing;
  }
  return { multiplier: Math.min(TRAIT_STACK_CAP, mul), routing };
}

export interface StrengthBreakdown {
  tier: number;
  tierBase: number;
  training: number;
  traits: number;
  effective: number;
  routing: TraitEffect["routing"] | null;
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
