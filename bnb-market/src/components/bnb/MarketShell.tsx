"use client";

import Link from "next/link";

import { BNB_CHAINS, getBnbNetwork, type BnbChainId } from "@/lib/bnb/chains";
import { MarketFooter } from "@/components/bnb/MarketFooter";

interface MarketShellProps {
  chainId: BnbChainId;
  onChainChange: (chainId: BnbChainId) => void;
  children: React.ReactNode;
}

export function MarketShell({ chainId, onChainChange, children }: MarketShellProps) {
  const currentNetwork = getBnbNetwork(chainId);

  return (
    <div className="relative min-h-screen bg-canvas text-ink">
      <header className="border-b border-[color:var(--hairline)]">
        <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/" className="inline-flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--hairline-strong)] bg-[color:var(--canvas-2)] text-xs font-bold">
              BNB
            </span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-3)]">
                AGON MARKET
              </p>
              <p className="text-sm font-medium">BNB Edition</p>
            </div>
          </Link>

          <nav className="flex flex-wrap items-center gap-4 text-sm">
            <Link href="/" className="font-medium underline-offset-4 hover:underline">
              Discover
            </Link>
            <Link href="/market" className="font-medium underline-offset-4 hover:underline">
              Browse Agents
            </Link>
            <Link href="/market/new" className="font-medium underline-offset-4 hover:underline">
              List an Agent
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            <label className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[color:var(--ink-3)]">
              Network
            </label>
            <select
              aria-label="Select BNB chain"
              value={chainId}
              onChange={(event) => onChainChange(Number(event.target.value) as BnbChainId)}
              className="min-h-11 rounded-md border border-[color:var(--hairline-strong)] bg-[color:var(--canvas)] px-3 py-2 text-sm"
            >
              {BNB_CHAINS.map((chain) => (
                <option key={chain.id} value={chain.id}>
                  {chain.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between px-4 pb-3 pt-1 text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink-3)] sm:px-6">
          <p>
            {currentNetwork.label} · {currentNetwork.nativeToken} · Explorer:{" "}
            <a className="underline underline-offset-2" href={currentNetwork.explorer} target="_blank" rel="noreferrer">
              {currentNetwork.explorer.replace("https://", "")}
            </a>
          </p>
          <p>{currentNetwork.isMainnet ? "Default: mainnet" : "Rehearsal mode"}</p>
        </div>
      </header>

      <main>{children}</main>

      <MarketFooter />
    </div>
  );
}
