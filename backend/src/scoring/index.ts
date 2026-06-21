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
/// real on-chain volume is the truth, not a synthetic score. The `seed` is kept
/// for signature compatibility and intentionally unused.
///
/// Anti-wash: volume is CREDITED only up to a generous multiple of the principal
/// the agent actually committed this round (its funded hot-wallet balance).
/// Today, with no DEX live on Arc, an op is a USDC self-transfer that returns the
/// same dollar, so without this an agent could loop one dollar a thousand times
/// and farm the metric. Past the turnover cap, recirculated volume earns a steep
/// 10% on the margin. A genuinely funded agent moving real size stays well under
/// the cap and is unaffected, and the day real swaps land they count in full.
/// `principalUsdc6` omitted or <= 0 means uncapped (safe fallback when the
/// balance can't be read), so the metric never silently zeroes out.
const VOLUME_TURNOVER_CAP = (() => {
  const n = Number(process.env.SCOUT_VOLUME_TURNOVER_CAP ?? "50");
  return Number.isFinite(n) && n > 0 ? n : 50;
})();

export function creditedVolumeUsdc6(volumeUsdc6: bigint, principalUsdc6?: bigint): bigint {
  if (principalUsdc6 === undefined || principalUsdc6 <= 0n) return volumeUsdc6;
  const fullCredit = principalUsdc6 * BigInt(Math.round(VOLUME_TURNOVER_CAP));
  if (volumeUsdc6 <= fullCredit) return volumeUsdc6;
  // Steep diminishing credit on volume beyond the turnover cap: 10% on the margin.
  return fullCredit + (volumeUsdc6 - fullCredit) / 10n;
}

export function scoutScore(input: {
  volumeUsdc6: bigint;
  opsCount: number;
  seed: number;
  /// Committed principal (6-dec USDC): the agent's funded hot-wallet balance.
  /// Caps wash-loop volume credit. Omitted/<=0 -> uncapped.
  principalUsdc6?: bigint;
}): number {
  void input.seed;
  const credited = creditedVolumeUsdc6(input.volumeUsdc6, input.principalUsdc6);
  const volumeUnits = Number(credited) / 1e6; // USDC
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
