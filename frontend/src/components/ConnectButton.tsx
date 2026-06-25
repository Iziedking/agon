"use client";

import { useEffect, useState } from "react";
import { useAccount, useChainId, useDisconnect, useSwitchChain } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { arcTestnet } from "@/lib/arc";

/// Wallet connect button, styled as a pill to match the arena theme. Renders a
/// stable placeholder until mounted to avoid a hydration mismatch.
const pill =
  "rounded-pill px-5 py-2 font-display text-xs uppercase tracking-wide transition-transform duration-150 hover:-translate-y-0.5";

export function ConnectButton() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  if (!mounted) {
    return (
      <button className={`${pill} border border-pengu-blue/40 bg-pengu-card text-pengu-blue/50`} disabled>
        connect wallet
      </button>
    );
  }

  if (!isConnected) {
    return (
      <button
        className={`${pill} border border-pengu-blue/50 bg-pengu-card text-pengu-blue hover:bg-pengu-blue/10`}
        onClick={openConnectModal}
        disabled={!openConnectModal}
      >
        connect wallet
      </button>
    );
  }

  if (chainId !== arcTestnet.id) {
    return (
      <button className={`${pill} bg-[#f4b400] text-pengu-dark`} onClick={() => switchChain({ chainId: arcTestnet.id })}>
        switch to arc
      </button>
    );
  }

  const short = `${address!.slice(0, 6)}…${address!.slice(-4)}`;
  return (
    <button
      className="rounded-pill border border-pengu-blue/30 bg-pengu-card px-4 py-2 font-mono text-xs text-pengu-dark transition-colors hover:bg-pengu-blue/5"
      onClick={() => disconnect()}
      title="Disconnect"
    >
      {short}
    </button>
  );
}
