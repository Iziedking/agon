"use client";

import { useAccount } from "wagmi";

/// Header link to the connected operator's own profile. Hidden until a wallet is
/// connected, since there is no profile without an address.
export function ProfileLink() {
  const { address, isConnected } = useAccount();
  if (!isConnected || !address) return null;
  return (
    <a
      href={`/operators/${address}`}
      className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3 transition-colors hover:text-ink"
    >
      PROFILE
    </a>
  );
}
