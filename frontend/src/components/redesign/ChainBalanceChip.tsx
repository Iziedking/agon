"use client";

import { useMemo } from "react";
import { useAccount, useChainId, useReadContract } from "wagmi";
import { erc20Abi, formatUnits } from "viem";
import { useLastGoodBalance, balanceAgo } from "@/hooks/useLastGoodBalance";
import { BRIDGE_CHAINS } from "@/lib/bridge";

/// Small mono chip beside the connected-wallet button. Reads USDC balance
/// on whichever chain the wallet is currently on (Arc Testnet by default,
/// any of the bridge source chains when the user is mid-flight on /bridge).
/// Hides when not connected, or when the chain is not one of the registered
/// bridge chains (so it never queries a contract that doesn't exist).
export function ChainBalanceChip() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();

  const chain = useMemo(
    () => BRIDGE_CHAINS.find((c) => c.id === chainId),
    [chainId],
  );

  const { data: balanceWei } = useReadContract({
    abi: erc20Abi,
    address: chain?.usdcAddress,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: chain?.id as never,
    query: {
      enabled: Boolean(address && chain),
      refetchInterval: 15_000,
    },
  });

  // Fall back to the last-known-good balance (with its age) when the live read
  // has no value yet, so an RPC hiccup doesn't blank the chip.
  const cacheKey = address && chain ? `arcrun:bal:${chain.id}:${address.toLowerCase()}` : null;
  const { value, staleSeconds } = useLastGoodBalance(cacheKey, typeof balanceWei === "bigint" ? balanceWei : undefined);

  if (!isConnected || !chain) return null;

  const display = value != null ? Number(formatUnits(value, 6)).toFixed(2) : "—";
  const stale = staleSeconds != null;

  return (
    <span
      className="hidden items-center gap-2 border border-[color:var(--hairline-strong)] bg-canvas px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink sm:inline-flex"
      title={`USDC balance on ${chain.label}${stale ? ` (as of ${balanceAgo(staleSeconds)} · RPC busy)` : ""}`}
    >
      <span aria-hidden className="text-ink-3">{chain.code}</span>
      <span>{stale ? "~" : ""}{display} USDC</span>
    </span>
  );
}
