"use client";

import { useState } from "react";

import { useAgonNetwork } from "@/hooks/useAgonNetwork";
import { AGON_NETWORKS, AGON_TESTNET_NETWORK_KEYS, type AgonNetworkKey } from "@/lib/agon/network";
import { NetworkGlyph } from "@/components/redesign/NetworkGlyph";

export function AgonNetworkSelector() {
  const [open, setOpen] = useState(false);
  const { network, networkKey, selectNetwork } = useAgonNetwork();

  function choose(key: AgonNetworkKey) {
    setOpen(false);
    selectNetwork(key);
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-11 items-center gap-2 border border-[color:var(--hairline-strong)] bg-canvas px-3 font-mono text-[10px] uppercase tracking-[0.12em] text-ink transition-colors hover:bg-canvas-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas max-[420px]:px-2"
        title="Choose the Agon network context"
      >
        <NetworkGlyph brand={network.brand} className="h-3.5 w-3.5" />
        <span className="hidden min-[420px]:inline">{network.brand}</span>
        <span>{network.mode === "mainnet" ? "MAINNET" : "TESTNET"}</span>
        <span aria-hidden className="ml-1 text-ink-3">⌄</span>
      </button>

      {open ? (
        <div role="menu" className="absolute right-0 top-[calc(100%+8px)] z-50 w-[min(20rem,calc(100vw-1.5rem))] border border-[color:var(--hairline-strong)] bg-canvas p-2 text-ink shadow-[8px_8px_0_var(--hairline)]">
          <div className="px-3 pb-2 pt-2 font-mono text-[9px] uppercase tracking-[0.16em] text-ink-3">AGON NETWORK</div>
          <NetworkOption networkKey="bnb-mainnet" active={networkKey === "bnb-mainnet"} onChoose={choose} />
          <div className="px-3 pb-2 pt-4 font-mono text-[9px] uppercase tracking-[0.16em] text-ink-3">TESTNET VIEWS</div>
          {AGON_TESTNET_NETWORK_KEYS.map((key) => <NetworkOption key={key} networkKey={key} active={networkKey === key} onChoose={choose} />)}
          <div className="mt-2 border-t border-[color:var(--hairline)] px-3 py-3 font-mono text-[9px] leading-relaxed text-ink-3">
            The selected network changes the catalog, proof records, payment rail, and receipt links.
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NetworkOption({ networkKey, active, onChoose }: { networkKey: AgonNetworkKey; active: boolean; onChoose: (key: AgonNetworkKey) => void }) {
  const network = AGON_NETWORKS[networkKey];
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => onChoose(networkKey)}
      className={`flex min-h-12 w-full items-center justify-between gap-3 px-3 text-left font-mono transition-colors ${active ? "bg-ink text-[color:var(--canvas)]" : "text-ink hover:bg-canvas-2"}`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <NetworkGlyph brand={network.brand} className="h-4 w-4 shrink-0" />
        <span className="truncate text-[10px] uppercase tracking-[0.11em]">{network.name}</span>
      </span>
      <span className={`shrink-0 text-[9px] uppercase tracking-[0.1em] ${active ? "opacity-70" : "text-ink-3"}`}>CHAIN {network.chainId}</span>
    </button>
  );
}
