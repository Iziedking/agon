/// Scoring formulas shared by the runners and the coordinator. All scores are
/// integers scaled to 1e6 so they sort cleanly and survive JSON without floats.

export const SCORE_SCALE = 1_000_000;

/// Deterministic small-range randomizer (the +/-3% anti-gaming factor),
/// derived from a seed so a contest's scoring is reproducible and auditable.
export function jitter(seed: number, spreadBps = 300): number {
  // mulberry32
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296; // 0..1
  const spread = spreadBps / 10_000; // e.g. 0.03
  return 1 - spread + r * (2 * spread); // [1-spread, 1+spread]
}

/// Scout: a volume contest, so the agent that moved the most USDC wins, full
/// stop. `volumeUsdc6` (total moved, 6 decimals) decides; op count is only a
/// tie-breaker so two agents with identical volume don't draw. No jitter here:
/// real on-chain volume is the truth and isn't gameable the way a synthetic
/// score is, and a +/-3% wobble was large enough to flip the winner when two
/// agents finished within a fraction of a percent (a 596.40 USDC agent losing
/// to a 595.20 one on an unlucky roll). The `seed` is kept for signature
/// compatibility and intentionally unused.
export function scoutScore(input: { volumeUsdc6: bigint; opsCount: number; seed: number }): number {
  void input.seed;
  const volumeUnits = Number(input.volumeUsdc6) / 1e6; // USDC
  // Volume dominates by a wide factor; op count only separates exact ties.
  return Math.round(volumeUnits * 1000 + Math.min(input.opsCount, 999));
}

/// Analyst: Brier score over probabilistic predictions, mapped so higher is
/// better. Brier in [0,1] (lower better) -> score = (1 - brier) * scale.
export function brierScore(predictions: { p: number; outcome: 0 | 1 }[]): number {
  if (predictions.length === 0) return 0;
  const sum = predictions.reduce((acc, { p, outcome }) => acc + (p - outcome) ** 2, 0);
  return sum / predictions.length;
}

export function analystScore(predictions: { p: number; outcome: 0 | 1 }[]): number {
  return Math.round((1 - brierScore(predictions)) * SCORE_SCALE);
}

/// Solver: the ABSOLUTE number of correct answers dominates, speed is a sub-one
/// tie-breaker. We do NOT use correctness as a ratio (correct / total): with a
/// ratio, an agent that faced fewer puzzles and nailed them (3/3 = 1.0) beats an
/// agent that faced more and missed one (5/6 = 0.83), which is backwards. Scoring
/// by raw count means solving more always wins, and the 0.3 speed bonus can never
/// overcome a single extra correct answer (so 5 correct slow beats 3 correct
/// fast). `elapsedMs` is the agent's total solve time; the budget is ~1s per
/// correct answer. `total` is kept for the detail row and signature.
export function solverScore(input: { correct: number; total: number; elapsedMs: number }): number {
  if (input.correct <= 0) return 0;
  const budgetMs = input.correct * 1000;
  const speedFactor = Math.max(0, Math.min(1, budgetMs / Math.max(input.elapsedMs, 1)));
  return Math.round((input.correct + 0.3 * speedFactor) * SCORE_SCALE);
}
