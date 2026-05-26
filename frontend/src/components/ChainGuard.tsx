"use client";

import { useEffect, useRef } from "react";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { arcTestnet } from "@/lib/arc";

/// Strict Arc-testnet enforcement. Mounted in the root layout so the moment a
/// connected wallet is on any chain other than Arc testnet, we prompt a switch
/// (once, automatically) and pin a non-dismissible banner with a manual switch
/// button. Wallets that have not added Arc fall through wagmi's add-chain path
/// because arcTestnet is fully described in lib/arc.ts. The banner uses a
/// z-index above the win modal so a wrong-chain warning is never hidden.
export function ChainGuard() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending, error } = useSwitchChain();
  const autoTried = useRef(false);

  const wrong = isConnected && chainId !== arcTestnet.id;

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
        className="rounded-full bg-white px-3 py-1 font-display text-xs uppercase tracking-wide text-[#e0466e] hover:bg-white/90 disabled:opacity-60"
      >
        {isPending ? "switching…" : "switch to arc"}
      </button>
      {error ? <span className="font-mono text-[11px] opacity-90">{error.message}</span> : null}
    </div>
  );
}
