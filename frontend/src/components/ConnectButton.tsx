"use client";

import { useEffect, useState } from "react";
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { injected } from "wagmi/connectors";
import { arcTestnet } from "@/lib/arc";

/// Wallet connect button. Renders a stable placeholder until mounted to avoid a
/// hydration mismatch (wallet state is client-only).
export function ConnectButton() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { address, isConnected } = useAccount();
  const { connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  if (!mounted) return <button className="btn" disabled>Connect Wallet</button>;

  if (!isConnected) {
    return (
      <button className="btn" onClick={() => connect({ connector: injected() })} disabled={isPending}>
        {isPending ? "Check your wallet..." : "Connect Wallet"}
      </button>
    );
  }

  if (chainId !== arcTestnet.id) {
    return (
      <button className="btn btn-warn" onClick={() => switchChain({ chainId: arcTestnet.id })}>
        Switch to Arc Testnet
      </button>
    );
  }

  const short = `${address!.slice(0, 6)}…${address!.slice(-4)}`;
  return (
    <button className="btn btn-ghost" onClick={() => disconnect()} title="Disconnect">
      {short}
    </button>
  );
}
