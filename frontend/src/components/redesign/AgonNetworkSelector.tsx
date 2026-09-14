"use client";

import { useAgonNetwork } from "@/hooks/useAgonNetwork";
import { NetworkGlyph } from "@/components/redesign/NetworkGlyph";

export function AgonNetworkSelector() {
  const { network } = useAgonNetwork();

  return (
    <div className="inline-flex min-h-11 items-center gap-2 border border-[color:var(--hairline-strong)] bg-canvas px-3 font-mono text-[10px] uppercase tracking-[0.12em] text-ink max-[420px]:px-2" role="status" aria-label="Current Agon network">
      <NetworkGlyph brand={network.brand} className="h-3.5 w-3.5" />
      <span>{network.brand} TESTNET</span>
    </div>
  );
}
