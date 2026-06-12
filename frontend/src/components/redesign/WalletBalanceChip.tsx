"use client";

import { useMemo } from "react";
import { useAccount, useChainId, useReadContract } from "wagmi";
import { erc20Abi, formatUnits } from "viem";
import { useOperatorAddress } from "@/hooks/useAuth";
import { BRIDGE_CHAINS } from "@/lib/bridge";

/// The operator's USDC balance, shown in the nav. Reuses the proven chain-aware
/// read (current wagmi chain, Arc by default) but takes the address from the
/// injected wallet when present and falls back to the operator/Circle address,
/// so email/Circle wallets get a balance too. Two renders because the top bar
/// has no room on phones:
///   - `chip` (default): compact nav chip, shown from sm up.
///   - `row`: full-width row for the mobile drawer.
export function WalletBalanceChip({ variant = "chip" }: { variant?: "chip" | "row" }) {
  const { address: wagmiAddress } = useAccount();
  const { address: opAddress, isSignedIn } = useOperatorAddress();
  const address = (wagmiAddress ?? opAddress) as `0x${string}` | undefined;

  const chainId = useChainId();
  // The wallet's current chain, or Arc when it isn't one we know (e.g. an
  // email wallet with no wagmi chain), so the balance always has a contract.
  const chain = useMemo(
    () => BRIDGE_CHAINS.find((c) => c.id === chainId) ?? BRIDGE_CHAINS.find((c) => c.code === "ARC"),
    [chainId],
  );

  const { data } = useReadContract({
    abi: erc20Abi,
    address: chain?.usdcAddress,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: chain?.id as never,
    query: { enabled: Boolean(address && chain), refetchInterval: 15_000 },
  });

  if (!isSignedIn || !address || !chain) return null;
  const display = typeof data === "bigint" ? Number(formatUnits(data, 6)).toFixed(2) : "—";

  if (variant === "row") {
    return (
      <div className="flex items-center justify-between border-b border-[color:var(--hairline)] py-3 font-mono text-[12px] uppercase tracking-[0.16em] last:border-0">
        <span className="text-ink-3">BALANCE</span>
        <span className="text-ink">
          {display} <span className="text-ink-3">{chain.code} USDC</span>
        </span>
      </div>
    );
  }

  return (
    <span
      className="hidden items-center gap-2 border border-[color:var(--hairline-strong)] bg-canvas px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink sm:inline-flex"
      title={`your USDC balance on ${chain.label}`}
    >
      <span aria-hidden className="text-ink-3">{chain.code}</span>
      <span>{display} USDC</span>
    </span>
  );
}
