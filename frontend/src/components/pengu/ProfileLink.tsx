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
      className="rounded-pill px-4 py-1.5 font-display text-xs uppercase tracking-wide text-pengu-blue2 hover:text-pengu-dark"
    >
      profile
    </a>
  );
}
