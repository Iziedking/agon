"use client";

import { useAgonNetwork } from "@/hooks/useAgonNetwork";

export function AgonNetworkReadout() {
  const { network } = useAgonNetwork();
  return <>{network.name}, chain {network.chainId}</>;
}

export function AgonNetworkExplorerLink() {
  const { network } = useAgonNetwork();
  return <a href={network.explorerUrl} target="_blank" rel="noreferrer" className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink hover:text-accent">OPEN {network.brand} EXPLORER →</a>;
}
