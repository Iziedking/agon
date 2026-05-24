import type { AgentResult } from "../runners/types.js";

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
