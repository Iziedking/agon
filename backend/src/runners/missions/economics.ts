import { config } from "../../config/index.js";

/// v2 mission economy (docs/missions.md section 1c). Rolls a mission's archetype
/// and weight, and derives the base intel price and the agent caps from it. Pure
/// per-call randomness (normal backend, not a workflow), so two missions in a row
/// rarely land the same.

export type MissionArchetype = "external" | "internal";

export interface MissionEconomics {
  archetype: MissionArchetype;
  /// 0..1, from pool x difficulty x subject.
  weight: number;
  /// The platform's base price `b` per intel piece, 1e6-scaled.
  basePrice6: bigint;
  specialistSeats: number;
  specialistMaxBuy: number;
  operativeSeats: number;
  intelPieces: number;
  operativeFeeBps: number;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/// Weight crosses three signals: how big the pool is, a difficulty roll, and a
/// subject roll. A heavier mission carries pricier, more decisive intel.
function missionWeight(poolUsdc: number): number {
  const poolFactor = clamp01((poolUsdc - 100) / 200); // 100..300 USDC -> 0..1
  const difficulty = 0.3 + Math.random() * 0.7; // 0.3..1
  const subject = Math.random(); // 0..1
  return clamp01(0.4 * poolFactor + 0.35 * difficulty + 0.25 * subject);
}

export function computeMissionEconomics(poolUsdc: number): MissionEconomics {
  const m = config.mission;
  const archetype: MissionArchetype = Math.random() < m.externalFraction ? "external" : "internal";
  const weight = missionWeight(poolUsdc);
  const basePrice = m.basePriceMinUsdc + (m.basePriceMaxUsdc - m.basePriceMinUsdc) * weight;
  return {
    archetype,
    weight,
    basePrice6: BigInt(Math.round(basePrice * 1e6)),
    specialistSeats: m.specialistSeats,
    specialistMaxBuy: m.specialistMaxBuy,
    operativeSeats: m.operativeSeats,
    intelPieces: m.intelPieces,
    operativeFeeBps: m.operativeFeeBps,
  };
}
