import type { AgentResult } from "../runners/types.js";
import {
  volumeWeightedPayouts as scoringVolumePayouts,
  type ScoringMode,
} from "../scoring/prediction.js";

/// Turns ranked runner results into the exact (operator, amount) payouts the
/// merkle tree encodes. The sum must not exceed the claimable pool, or late
/// claimers would hit the escrow's balance floor. v0 distribution: a single
/// winner takes the pool; with two or more, the top two split 60/40. Richer
/// tiered curves (top-N share, remainder to the field) slot in here.

export interface Payout {
  operator: `0x${string}`;
  amount: bigint;
}

export function computePayouts(results: AgentResult[], claimable: bigint): Payout[] {
  const ranked = results.filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return [];
  if (ranked.length === 1) return [{ operator: ranked[0]!.operator, amount: claimable }];

  const top = (claimable * 60n) / 100n;
  const second = claimable - top; // remainder, so the sum is exact
  return [
    { operator: ranked[0]!.operator, amount: top },
    { operator: ranked[1]!.operator, amount: second },
  ];
}

/// True when the results came from the Arcana branch of the Analyst runner
/// (any result with detail.source === "arcana" qualifies). Used by the
/// settlement path to switch payout curves.
export function isArcanaResults(results: AgentResult[]): boolean {
  return results.some((r) => (r.detail as { source?: string } | undefined)?.source === "arcana");
}

/// Normalize a scoring_mode column value (may be null/undefined/unknown
/// string) into the canonical ScoringMode enum. Unknown / null defaults
/// to pnl_mtm so existing contests without the column still settle.
export function normalizeScoringMode(raw: string | null | undefined): ScoringMode {
  if (raw === "pnl_realized" || raw === "volume" || raw === "pnl_mtm") return raw;
  return "pnl_mtm";
}

/// Dispatcher used by runContestById and runChallengeById to pick the
/// payout curve. Scoring mode wins when results came from Arcana; the
/// legacy rank-based 60/40 still fires for non-Arcana contests (Scout,
/// Solver) so this is a no-op for those.
export function computePayoutsForMode(
  mode: ScoringMode,
  results: AgentResult[],
  claimable: bigint,
): Payout[] {
  if (!isArcanaResults(results)) return computePayouts(results, claimable);
  if (mode === "volume") {
    // For volume mode, score IS the volume the agent staked. The Arcana
    // analyst runner already populates score from PnL today, so the
    // volume mode falls back to the existing per-agent positions count
    // via detail.marketsTraded when set, or just the score number.
    // We pass through to scoringVolumePayouts which expects volumeUsdc6.
    const volumeAgents = results.map((r) => {
      const det = r.detail as { totalStakeUsdc6?: string } | undefined;
      const vol = det?.totalStakeUsdc6 ? BigInt(det.totalStakeUsdc6) : BigInt(Math.round(r.score) * 1_000_000);
      return { operator: r.operator, volumeUsdc6: vol };
    });
    return scoringVolumePayouts(volumeAgents, claimable);
  }
  // pnl_mtm and pnl_realized both use the same 30/70 curve here; the
  // difference is WHEN the runner computed the underlying score (mtm
  // at close vs realized after markets resolve). Phase 3 sweeper gates
  // the pnl_realized path to wait for resolution.
  return computePnlWeightedPayouts(results, claimable);
}

/// PnL-weighted payout for Analyst Arcana contests. Realism plan §"Reward
/// sharing logic": 30% of the pool flat-distributed across qualifying
/// agents (anyone who took at least one position), 70% weighted by positive
/// score (which the runner already derives from realized + marked-to-market
/// PnL). Agents who participated but broke even still get the participation
/// share; agents with PnL < 0 get nothing on top of their Arcana loss.
///
/// Returns leaves in descending share order so the live UI can render
/// rank 1 first. Rounding error from the 30/70 split lands on the largest
/// share so the total equals `claimable` exactly.
export function computePnlWeightedPayouts(
  results: AgentResult[],
  claimable: bigint,
): Payout[] {
  // Qualified = any participant exposed by the runner's detail blob. The
  // Arcana runner sets `marketsTraded` when it attempted to trade (even if
  // the trade failed because the wallet was unfunded — the agent showed up).
  const qualified = results.filter((r) => {
    const det = r.detail as { source?: string; marketsTraded?: number } | undefined;
    return det?.source === "arcana" && (det.marketsTraded ?? 0) > 0;
  });
  if (qualified.length === 0) return [];

  // Participation pool: 30%. Flat among qualified agents. Floors at 1 cent
  // per agent so a $0.01 pool with 5 agents still pays something visible
  // rather than rounding to zero.
  const participationPool = (claimable * 30n) / 100n;
  const baseShare = participationPool / BigInt(qualified.length);

  // PnL-weighted pool: 70%. Distributed proportionally to positive score
  // (= positive PnL after floor). Agents with score 0 only get the base.
  const pnlPool = claimable - participationPool;
  const positive = qualified.filter((r) => r.score > 0);
  const scoreTotal = positive.reduce((sum, r) => sum + r.score, 0);

  const byOperator = new Map<`0x${string}`, bigint>();
  for (const r of qualified) {
    byOperator.set(r.operator, (byOperator.get(r.operator) ?? 0n) + baseShare);
  }
  if (positive.length > 0 && scoreTotal > 0) {
    let allocated = 0n;
    for (let i = 0; i < positive.length; i++) {
      const r = positive[i]!;
      let share: bigint;
      if (i === positive.length - 1) {
        // Last winner soaks any rounding residual so the total equals pool.
        share = pnlPool - allocated;
      } else {
        share = (pnlPool * BigInt(Math.round(r.score))) / BigInt(Math.round(scoreTotal));
        allocated += share;
      }
      byOperator.set(r.operator, (byOperator.get(r.operator) ?? 0n) + share);
    }
  } else {
    // No positive-PnL agent. Sprinkle the PnL pool flat too so the pool
    // isn't left in escrow when everyone broke even.
    const extraEach = pnlPool / BigInt(qualified.length);
    for (const r of qualified) {
      byOperator.set(r.operator, (byOperator.get(r.operator) ?? 0n) + extraEach);
    }
  }

  // Build leaves sorted by amount desc so rank 1 reads correctly.
  return Array.from(byOperator.entries())
    .map(([operator, amount]) => ({ operator, amount }))
    .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
}
