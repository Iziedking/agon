"use client";

import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { arcTestnet } from "@/lib/arc";
import { BRIDGE_CHAINS } from "@/lib/bridge";

/// Pink chip that sits beside the login button. Shows whenever the wallet
/// is connected to any non-Arc chain so users always have a one-click way
/// back. Click → switchChain to Arc Testnet. Hides on Arc.
///
/// Why this exists alongside ChainGuard: the bridge page intentionally
/// disables the guard's auto-switch (the user is on Sepolia or Polygon to
/// sign a burn). This chip keeps the option visible at all times so the
/// user can come home from any route, including the bridge.
export function ArcChainChip() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending } = useSwitchChain();

  if (!isConnected) return null;
  if (chainId === arcTestnet.id) return null;

  const current = BRIDGE_CHAINS.find((c) => c.id === chainId);
  const code = current?.code ?? `CHAIN ${chainId}`;

  return (
    <button
      type="button"
      onClick={() => switchChain({ chainId: arcTestnet.id })}
      disabled={isPending}
      className="inline-flex min-h-11 max-w-[min(15rem,42vw)] items-center gap-2 overflow-hidden text-ellipsis whitespace-nowrap border border-accent bg-canvas px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-accent hover:bg-accent hover:text-accent-ink disabled:opacity-60 max-[359px]:max-w-[7.5rem] max-[359px]:px-2"
      title="Switch your wallet back to Arc Testnet"
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
      ON {code} · {isPending ? "SWITCHING…" : "BACK TO ARC"}
    </button>
  );
}
