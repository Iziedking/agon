/// Turns the live standings progress into a uniform "economy tape": one row per
/// real agent action (swap, payment, trade, ...) with a USDC amount and an
/// on-chain link, so the tape and the output scoreboard read every event kind
/// the same way. For now the rows are DERIVED from the per-kind progress arrays
/// already on the wire (scout swaps, solver/analyst x402 payments, Arcana
/// trades), which all carry real on-chain data. When the backend later attaches
/// `progress.events` directly (for new verbs like BRIDGE / STREAM / SETTLE), we
/// use those verbatim and skip the derivation.

import type { StandingsEntry, TapeEvent, TapeVerb } from "@/lib/live";

/// One colour per verb, drawn from the syndicate palette. The leading square in
/// each tape row uses it; numerals and copy stay ink (pink is reserved).
export const VERB_COLOR: Record<TapeVerb, string> = {
  SWAP: "#D78A2B", // liquidity gold
  PAY: "#2BD4A3", // payments mint
  TRADE: "#7C5CFF", // prediction violet
  FUND: "#847C70", // neutral ink-3
  BRIDGE: "#E0345A", // cross-chain crimson
  STREAM: "#2BD4A3",
  SETTLE: "#FF3D8A",
  REBATE: "#D78A2B",
};

/// Short human label per verb for the row.
export const VERB_LABEL: Record<TapeVerb, string> = {
  SWAP: "SWAP",
  PAY: "PAY",
  TRADE: "TRADE",
  FUND: "FUND",
  BRIDGE: "BRIDGE",
  STREAM: "STREAM",
  SETTLE: "SETTLE",
  REBATE: "REBATE",
};

const EXPLORER: Record<string, string> = {
  arc: "https://arcscan.net/tx/",
  base: "https://basescan.org/tx/",
  "base-sepolia": "https://sepolia.basescan.org/tx/",
  matic: "https://polygonscan.com/tx/",
  polygon: "https://polygonscan.com/tx/",
};

/// Explorer link for a tx on a given chain. Falls back to Arcscan (the agents'
/// home chain) when the chain is unknown.
export function explorerTxUrl(chain: string, hash: string): string {
  const base = EXPLORER[chain.toLowerCase()] ?? EXPLORER.arc!;
  return `${base}${hash}`;
}

/// USDC 6-dec string to a "1.23 USDC" label.
export function usdc6(amount6: string): string {
  return `${(Number(amount6 || "0") / 1e6).toFixed(2)} USDC`;
}

/// USD with more precision, for the sub-cent x402 payments ("$0.0136").
export function usd6(amount6: string): string {
  return `$${(Number(amount6 || "0") / 1e6).toFixed(4)}`;
}

function positive(amount6: string | undefined | null): boolean {
  if (!amount6) return false;
  try {
    return BigInt(amount6) > 0n;
  } catch {
    return Number(amount6) > 0;
  }
}

/// Derive the tape rows for one standings frame. Rows carry a provisional `ts`
/// from their per-agent index (lower = newer); the accumulation hook assigns
/// the real ordering as frames arrive. Newest-first per agent, interleaved.
export function deriveTapeEvents(entries: StandingsEntry[]): TapeEvent[] {
  const rows: TapeEvent[] = [];

  for (const e of entries) {
    const p = e.progress;
    if (!p) continue;

    // Forward path: backend already normalized the rows.
    if (p.events && p.events.length > 0) {
      for (const ev of p.events) rows.push({ ...ev, agentId: ev.agentId || e.agentId });
      continue;
    }

    if (p.kind === "scout") {
      const { recent, recentVolumes } = p;
      recent.forEach((hash, i) => {
        rows.push({
          agentId: e.agentId,
          verb: "SWAP",
          amount6: recentVolumes?.[i] ?? "0",
          token: "USDC->EURC",
          txHash: hash,
          chain: "arc",
          label: "Circle Swap Kit",
          ts: -i,
        });
      });
      if (positive(p.researchSpent6)) {
        rows.push({
          agentId: e.agentId,
          verb: "PAY",
          amount6: p.researchSpent6!,
          token: "USDC",
          txHash: "",
          chain: "base",
          label: p.researchLabel ?? "price research",
          ts: 1,
        });
      }
    } else if (p.kind === "solver") {
      const spent = p.spent ?? [];
      spent.forEach((amt, i) => {
        if (!positive(amt)) return;
        rows.push({
          agentId: e.agentId,
          verb: "PAY",
          amount6: amt,
          token: "USDC",
          txHash: p.spentTx?.[i] ?? "",
          chain: "base",
          label: p.spentLabels?.[i] || "research",
          ts: -i,
        });
      });
    } else if (p.kind === "analyst") {
      for (const a of p.arcana ?? []) {
        rows.push({
          agentId: e.agentId,
          verb: "TRADE",
          amount6: a.stakeUsdc,
          token: "USDC",
          txHash: a.txHash ?? "",
          chain: "arc",
          label: `Arcana ${a.side.toUpperCase()} #${a.marketId}`,
          ts: -a.marketId,
        });
      }
      if (positive(p.researchSpent6)) {
        rows.push({
          agentId: e.agentId,
          verb: "PAY",
          amount6: p.researchSpent6!,
          token: "USDC",
          txHash: p.researchTx ?? "",
          chain: "base",
          label: p.researchLabel ?? "news",
          ts: 1,
        });
      }
    }
  }

  return rows;
}

/// Stable identity for de-duping a row across cumulative frames. A real tx is
/// keyed by its hash; a tx-less row (a one-time research spend) is keyed by its
/// shape so it lands exactly once.
export function tapeKey(ev: TapeEvent): string {
  return ev.txHash ? `tx:${ev.txHash.toLowerCase()}` : `na:${ev.agentId}:${ev.verb}:${ev.label}:${ev.amount6}`;
}

export interface EconomyTotals {
  /// USDC moved through value transfers (swaps, trades, settlements, bridges).
  moved6: bigint;
  /// USDC paid for services (x402 pay-per-inference, streams).
  paid6: bigint;
  /// On-chain transactions with a settlement hash.
  txCount: number;
}

const MOVED_VERBS = new Set<TapeVerb>(["SWAP", "TRADE", "SETTLE", "BRIDGE", "REBATE", "FUND"]);
const PAID_VERBS = new Set<TapeVerb>(["PAY", "STREAM"]);

/// Aggregate the running totals for the output scoreboard.
export function economyTotals(rows: TapeEvent[]): EconomyTotals {
  let moved6 = 0n;
  let paid6 = 0n;
  let txCount = 0;
  for (const ev of rows) {
    let amt = 0n;
    try {
      amt = BigInt(ev.amount6 || "0");
    } catch {
      amt = 0n;
    }
    if (MOVED_VERBS.has(ev.verb)) moved6 += amt;
    else if (PAID_VERBS.has(ev.verb)) paid6 += amt;
    if (ev.txHash) txCount += 1;
  }
  return { moved6, paid6, txCount };
}
