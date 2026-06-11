"use client";

import { useCallback } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { arcTestnet } from "@/lib/arc";

/// Returns a function that resolves once the connected wallet is on Arc
/// Testnet. Call `await ensureOnArc()` before any contract write that
/// targets Arc so a user coming back from /bridge with a wallet still on
/// Sepolia or Polygon doesn't trigger a failed tx. If the user rejects
/// the switch the promise rejects, so callers can surface a friendly
/// message instead of letting the underlying writeContract throw.
export function useEnsureArc(): () => Promise<void> {
  // The wallet's ACTUAL connected chain. useChainId() returns wagmi's
  // configured active chain, which can report Arc even when the wallet is on
  // an unconfigured chain like ETH mainnet, so the switch would be skipped.
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  return useCallback(async () => {
    if (chainId === arcTestnet.id) return;
    try {
      await switchChainAsync({ chainId: arcTestnet.id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Switch your wallet to Arc Testnet to continue. ${msg}`,
      );
    }
  }, [chainId, switchChainAsync]);
}
