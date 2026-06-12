"use client";

import { useReadContract } from "wagmi";
import { erc20Abi, formatUnits } from "viem";
import { useOperatorAddress } from "@/hooks/useAuth";
import { USDC, arcTestnet } from "@/lib/arc";

/// The operator's Arc USDC balance, read from the chain by their address so it
/// works for both wallet kinds: injected (wagmi) and email/Circle wallets. The
/// read is a public RPC call pinned to Arc, so it doesn't need a connected
/// wallet, just the address.
///
/// Two renders, because the top bar has no room for a balance on phones:
///   - `chip` (default): compact nav chip, shown from sm up.
///   - `row`: full-width row for the mobile drawer.
export function WalletBalanceChip({ variant = "chip" }: { variant?: "chip" | "row" }) {
  const { address, isSignedIn } = useOperatorAddress();

  const { data } = useReadContract({
    abi: erc20Abi,
    address: USDC,
    functionName: "balanceOf",
    args: address ? [address as `0x${string}`] : undefined,
    chainId: arcTestnet.id,
    query: { enabled: Boolean(address), refetchInterval: 15_000 },
  });

  if (!isSignedIn || !address) return null;
  const display = typeof data === "bigint" ? Number(formatUnits(data, 6)).toFixed(2) : "—";

  if (variant === "row") {
    return (
      <div className="flex items-center justify-between border-b border-[color:var(--hairline)] py-3 font-mono text-[12px] uppercase tracking-[0.16em] last:border-0">
        <span className="text-ink-3">BALANCE</span>
        <span className="text-ink">{display} USDC</span>
      </div>
    );
  }

  return (
    <span
      className="hidden items-center gap-2 border border-[color:var(--hairline-strong)] bg-canvas px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink sm:inline-flex"
      title="your USDC balance on arc"
    >
      <span aria-hidden className="text-ink-3">USDC</span>
      <span>{display}</span>
    </span>
  );
}
