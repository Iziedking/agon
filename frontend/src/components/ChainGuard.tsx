"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAccount, useSwitchChain } from "wagmi";
import { arcTestnet } from "@/lib/arc";

/// Routes where the user legitimately needs the wallet on a non-Arc chain.
/// The bridge UI signs the burn step on whatever source chain the user picks,
/// so force-switching them back to Arc breaks the flow. ChainGuard turns
/// itself off on these paths and resumes pinning Arc on every other route.
const NON_ARC_ROUTES = ["/bridge"];

/// Strict Arc-testnet enforcement. Mounted in the root layout so the moment a
/// connected wallet is on any chain other than Arc testnet, we prompt a switch
/// (once, automatically) and pin a non-dismissible banner with a manual switch
/// button. Wallets that have not added Arc fall through wagmi's add-chain path
/// because arcTestnet is fully described in lib/arc.ts. The banner uses a
/// z-index above the win modal so a wrong-chain warning is never hidden.
export function ChainGuard() {
  const pathname = usePathname() ?? "/";
  // account.chainId is the wallet's ACTUAL chain. useChainId() reports wagmi's
  // configured active chain, which can read as Arc even when the wallet sits on
  // an unconfigured chain (e.g. ETH mainnet), so the banner would never show.
  const { isConnected, chainId } = useAccount();
  const { switchChain, isPending, error } = useSwitchChain();
  const autoTried = useRef(false);

  const onBridgeRoute = NON_ARC_ROUTES.some((r) => pathname.startsWith(r));
  const wrong = isConnected && chainId !== arcTestnet.id && !onBridgeRoute;

  useEffect(() => {
    if (wrong && !autoTried.current) {
      autoTried.current = true;
      try {
        switchChain({ chainId: arcTestnet.id });
      } catch {
        // user-rejection bubbles into useSwitchChain.error; the banner stays
        // visible so they can retry from the button.
      }
    }
    if (!wrong) autoTried.current = false;
  }, [wrong, switchChain]);

  if (!wrong) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[60] flex flex-wrap items-center justify-center gap-3 bg-[#e0466e] px-4 py-2 text-white shadow-[0_2px_12px_rgba(0,0,0,0.15)]">
      <span className="font-mono text-xs">
        wrong network · arcrun runs strictly on arc testnet (chain {arcTestnet.id})
      </span>
      <button
        onClick={() => switchChain({ chainId: arcTestnet.id })}
        disabled={isPending}
        className="rounded-full bg-pengu-card px-3 py-1 font-display text-xs uppercase tracking-wide text-[#e0466e] hover:bg-white/90 disabled:opacity-60"
      >
        {isPending ? "switching…" : "switch to arc"}
      </button>
      {error ? <span className="font-mono text-[11px] opacity-90">{error.message}</span> : null}
    </div>
  );
}
