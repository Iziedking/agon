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

/// Scout: driven by real on-chain volume, with a small per-agent op bonus and
/// the anti-gaming jitter. `volumeUsdc6` is total moved in USDC (6 decimals).
export function scoutScore(input: { volumeUsdc6: bigint; opsCount: number; seed: number }): number {
  const volumeUnits = Number(input.volumeUsdc6) / 1e6; // USDC
  const base = volumeUnits * 1000 + input.opsCount * 50;
  return Math.round(base * jitter(input.seed));
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

/// Solver: correctness dominates, speed is a 30% modifier. `elapsedMs` is the
/// agent's total solve time; the budget is 1s per puzzle.
export function solverScore(input: { correct: number; total: number; elapsedMs: number }): number {
  if (input.total === 0) return 0;
  const correctness = input.correct / input.total;
  const budgetMs = input.total * 1000;
  const speedFactor = Math.max(0.1, Math.min(1, budgetMs / Math.max(input.elapsedMs, 1)));
  return Math.round(correctness * (0.7 + 0.3 * speedFactor) * SCORE_SCALE);
}
