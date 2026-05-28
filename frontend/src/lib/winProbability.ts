import type { StandingsEntry } from "./live";

/// Translates a live standings frame into a per-agent win-probability
/// estimate so the focused /live page can surface "X%" next to each row
/// instead of a raw score. Softmax over scores with a temperature that
/// sharpens as the round progresses: early on, scores are noisy and we
/// want spreads close to uniform; late, the leader should look like the
/// clear favorite.
///
/// Not a real model. Good enough for a stage that needs a "feels live"
/// signal. The score scale is whatever the runner emits; we normalize.

export interface WinProbability {
  agentId: number;
  /// 0..1 probability that this agent wins. Sums to 1 across the field.
  p: number;
}

export function computeWinProbabilities(entries: StandingsEntry[]): WinProbability[] {
  if (entries.length === 0) return [];
  if (entries.length === 1) return [{ agentId: entries[0]!.agentId, p: 1 }];

  const scores = entries.map((e) => Math.max(0, e.score));
  const max = Math.max(...scores);
  const min = Math.min(...scores);
  // If every agent ties at zero (preview frame), assign uniform.
  if (max === 0) {
    const u = 1 / entries.length;
    return entries.map((e) => ({ agentId: e.agentId, p: u }));
  }

  // Temperature: scales with how separated the field is. A wide spread
  // makes the leader sharper; a narrow spread keeps things contested.
  const spread = Math.max(1, max - min);
  const temperature = Math.max(1, spread * 0.4);

  // Softmax with chosen temperature.
  const exps = scores.map((s) => Math.exp((s - max) / temperature));
  const sum = exps.reduce((a, b) => a + b, 0);
  return entries.map((e, i) => ({ agentId: e.agentId, p: exps[i]! / sum }));
}

/// Convenience: probability for a single agent id, or 0 if missing.
export function probFor(probs: WinProbability[], agentId: number): number {
  return probs.find((w) => w.agentId === agentId)?.p ?? 0;
}

export function formatProb(p: number): string {
  if (p <= 0) return "—";
  if (p >= 0.995) return "99%";
  const pct = Math.round(p * 100);
  return `${Math.max(1, pct)}%`;
}
