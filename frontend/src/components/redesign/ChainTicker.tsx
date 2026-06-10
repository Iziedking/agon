"use client";

import { useEffect, useState } from "react";
import { publicClient } from "@/lib/arc";

/// Thin top-of-viewport status bar showing live arc chain numbers. Polls
/// the public RPC every 6 seconds (well under the 1s block time so we miss
/// some blocks, which is fine: this is HUD ornamentation, not a wallet
/// surface). Mounted once in the root layout above the page header.
///
/// Hidden on < sm so the mobile chrome stays clean. Falls back to dashes
/// while loading or if the RPC blips.
export function ChainTicker() {
  const [block, setBlock] = useState<bigint | null>(null);
  const [gas, setGas] = useState<bigint | null>(null);

  useEffect(() => {
    let stopped = false;
    async function tick() {
      try {
        const [b, g] = await Promise.all([
          publicClient.getBlockNumber(),
          publicClient.getGasPrice(),
        ]);
        if (stopped) return;
        setBlock(b);
        setGas(g);
      } catch {
        // Chain blip; keep what we had, next tick will retry.
      }
    }
    void tick();
    const t = setInterval(tick, 6000);
    return () => { stopped = true; clearInterval(t); };
  }, []);

  // Gas comes back in wei (well, USDC's smallest unit on Arc: 6 decimals).
  // Format as a fractional USDC reading rounded to 4 sig digits.
  const gasUsdc = gas !== null ? Number(gas) / 1e6 : null;
  const gasLabel = gasUsdc !== null
    ? gasUsdc < 0.0001
      ? `${(gasUsdc * 1e6).toFixed(2)}µ`
      : gasUsdc.toFixed(4)
    : "——";

  const blockLabel = block !== null
    ? block.toString()
    : "———————";

  return (
    <div className="relative z-10 hidden border-b border-[color:var(--hairline)] bg-canvas-2 sm:block">
      <div className="mx-auto flex h-7 max-w-[1600px] items-center justify-between gap-6 px-6 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">
        <span className="flex items-center gap-3">
          <span aria-hidden className="inline-block h-1.5 w-1.5 animate-[pulse-live_1.5s_ease-in-out_infinite] bg-[color:var(--ok)]" />
          ARC TESTNET
          <span aria-hidden className="text-ink-3/50">·</span>
          <span>BLOCK <span className="text-ink">{blockLabel}</span></span>
          <span aria-hidden className="text-ink-3/50">·</span>
          <span>GAS <span className="text-ink">{gasLabel}</span> USDC</span>
        </span>
        <span className="hidden md:inline">CHAIN ID 5042002 · USDC NATIVE</span>
      </div>
    </div>
  );
}
