"use client";

import { BracketedCell } from "@/components/redesign";
import type { EconomyTotals } from "@/lib/economyTape";

/// The headline "economic output" of an event: how much real value the agents
/// moved, how much they paid for services, and how many on-chain txs they
/// fired. Sits above the per-kind stage so the first thing a viewer reads is
/// "these agents are really working". Numerals in the stencil display face;
/// pink is reserved for the single headline stat (tx count).

function movedLabel(amount6: bigint): string {
  return `${(Number(amount6) / 1e6).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} USDC`;
}

function paidLabel(amount6: bigint): string {
  return `$${(Number(amount6) / 1e6).toFixed(4)}`;
}

export function OutputScoreboard({ totals }: { totals: EconomyTotals }) {
  const cells: Array<{ label: string; value: string; accent?: boolean }> = [
    { label: "USDC MOVED", value: movedLabel(totals.moved6) },
    { label: "PAID FOR SERVICES", value: paidLabel(totals.paid6) },
    { label: "ONCHAIN TX", value: String(totals.txCount), accent: true },
  ];

  return (
    <div className="mb-4">
      <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
        <span aria-hidden className="text-accent">
          ■
        </span>{" "}
        OUTPUT
        <span className="ml-2 text-ink-3">· LIVE THIS ROUND</span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {cells.map((cell) => (
          <BracketedCell key={cell.label} pad="sm">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{cell.label}</div>
            <div
              className={`mt-1 font-stencil leading-none ${cell.accent ? "text-accent" : "text-ink"}`}
              style={{ fontSize: "clamp(20px, 4.5vw, 34px)" }}
            >
              {cell.value}
            </div>
          </BracketedCell>
        ))}
      </div>
    </div>
  );
}
