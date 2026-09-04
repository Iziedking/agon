// Pure decision core. The HTTP provider and the independent proof CLI use the
// same rules. No wallet, RPC, model, or floating-point token amounts here.
export const LP_AGENT_VERSION = "agon-lp-guardian/1.0.0";
export const ORACLE_WINDOW_SECONDS = 600;
const MAX_TICK = 887272;
export type LpInput = { positionId: string; halfWidthSteps: number; maxDeviationTicks: number };
export type LpState = { tick: number; tickLower: number; tickUpper: number; tickSpacing: number;
  liquidity: string; poolLiquidity: string; twapTick: number | null };
export type LpDecision = {
  action: "hold" | "review_rebalance" | "blocked";
  positionState: "in_range" | "below_range" | "above_range" | "empty";
  reason: string; proposedRange: { tickLower: number; tickUpper: number } | null;
  deviationTicks: number | null; executed: false;
};
export function parseLpInput(value: unknown): LpInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Send a position ID and range settings.");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !["positionId", "halfWidthSteps", "maxDeviationTicks"].includes(key))) throw new Error("Unsupported position setting.");
  if (typeof row.positionId !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(row.positionId) || BigInt(row.positionId) >= 2n ** 256n) throw new Error("Enter the position NFT ID as a whole-number string.");
  const halfWidthSteps = row.halfWidthSteps ?? 10;
  const maxDeviationTicks = row.maxDeviationTicks ?? 100;
  if (typeof halfWidthSteps !== "number" || !Number.isSafeInteger(halfWidthSteps) || halfWidthSteps < 1 || halfWidthSteps > 1000) throw new Error("Range half-width must be 1 to 1000 tick-spacing steps.");
  if (typeof maxDeviationTicks !== "number" || !Number.isSafeInteger(maxDeviationTicks) || maxDeviationTicks < 0 || maxDeviationTicks > 10000) throw new Error("Maximum spot deviation must be 0 to 10000 ticks.");
  return { positionId: row.positionId, halfWidthSteps, maxDeviationTicks };
}
export function meanTick(older: bigint, newer: bigint, seconds: number): number {
  if (!Number.isSafeInteger(seconds) || seconds < 1) throw new Error("Invalid oracle window.");
  const delta = newer - older; const duration = BigInt(seconds);
  let tick = delta / duration;
  // PancakeSwap OracleLibrary rounds negative arithmetic means toward -infinity.
  if (delta < 0n && delta % duration !== 0n) tick -= 1n;
  if (tick < -BigInt(MAX_TICK) || tick > BigInt(MAX_TICK)) throw new Error("Oracle returned an invalid tick.");
  return Number(tick);
}
export function analyseRange(input: LpInput, state: LpState): LpDecision {
  parseLpInput(input);
  const { tick, tickLower, tickUpper, tickSpacing, twapTick } = state;
  if (![tick, tickLower, tickUpper].every((n) => Number.isSafeInteger(n) && Math.abs(n) <= MAX_TICK) ||
      !Number.isSafeInteger(tickSpacing) || tickSpacing < 1 || tickSpacing > 16384 ||
      tickLower >= tickUpper || tickLower % tickSpacing !== 0 || tickUpper % tickSpacing !== 0 ||
      (twapTick !== null && (!Number.isSafeInteger(twapTick) || Math.abs(twapTick) > MAX_TICK))) throw new Error("Invalid position or pool range.");
  for (const amount of [state.liquidity, state.poolLiquidity]) if (!/^(0|[1-9][0-9]{0,38})$/.test(amount) || BigInt(amount) >= 2n ** 128n) throw new Error("Invalid liquidity amount.");
  const positionState: LpDecision["positionState"] = state.liquidity === "0" ? "empty" : tick < tickLower ? "below_range" : tick >= tickUpper ? "above_range" : "in_range";
  const deviationTicks = twapTick === null ? null : Math.abs(tick - twapTick);
  const base = { positionState, deviationTicks, executed: false as const, proposedRange: null };
  const blocked = (reason: string): LpDecision => ({ ...base, action: "blocked", reason });
  if (positionState === "empty") return blocked("This NFT has no active liquidity. There is no position to rebalance.");
  if (state.poolLiquidity === "0") return blocked("The pool has no active liquidity at this tick. A range proposal is withheld.");
  if (twapTick === null) return blocked("The pool could not supply a 10-minute price observation. No range proposal is safe to present.");
  if (deviationTicks! > input.maxDeviationTicks) return blocked("The spot tick exceeds your allowed deviation from the 10-minute average. Wait and check again.");
  if (positionState === "in_range") return { ...base, action: "hold", reason: "The position is inside its current range. No range change is proposed by this rule." };
  const center = Math.floor(twapTick / tickSpacing) * tickSpacing;
  const width = input.halfWidthSteps * tickSpacing;
  const lower = center - width; const upper = center + width;
  if (lower < -MAX_TICK || upper > MAX_TICK) return blocked("The requested range exceeds the pool's tick bounds. Choose a narrower range.");
  if (tick < lower || tick >= upper) return blocked("Your requested width would still leave the current price outside the proposed range.");
  return { ...base, action: "review_rebalance", proposedRange: { tickLower: lower, tickUpper: upper },
    reason: "The position is out of range. Review this tick-aligned range around the 10-minute average; no transaction has been prepared or sent." };
}
