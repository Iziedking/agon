import type { StandingsEntry } from "./live";

/// Translates a live standings frame into each agent's SHARE of the field's
/// output so far, shown as "X%" next to its row. This is real, honest math:
/// an agent's percentage is exactly its score divided by the field total, so
/// a 596-USDC agent next to a 595-USDC one reads ~50/50, not a dramatic
/// 87/12. No fabricated softmax "win probability" that exaggerates a tiny
/// lead into a near-lock. The score scale is whatever the runner emits.

export interface WinProbability {
  agentId: number;
  /// 0..1 share of the field's total score. Sums to 1 across the field.
  p: number;
}

export function computeWinProbabilities(entries: StandingsEntry[]): WinProbability[] {
  if (entries.length === 0) return [];
  if (entries.length === 1) return [{ agentId: entries[0]!.agentId, p: 1 }];

  const scores = entries.map((e) => Math.max(0, e.score));
  const total = scores.reduce((a, b) => a + b, 0);
  // Before the first scoring frame every agent ties at zero: split evenly.
  if (total === 0) {
    const u = 1 / entries.length;
    return entries.map((e) => ({ agentId: e.agentId, p: u }));
  }
  // Plain share of total. Whatever fraction of the field's output you hold is
  // your number, full stop.
  return entries.map((e, i) => ({ agentId: e.agentId, p: scores[i]! / total }));
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
