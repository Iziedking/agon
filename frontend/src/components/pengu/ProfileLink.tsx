"use client";

import { useOperatorAddress } from "@/hooks/useAuth";

/// Header link to the operator's own profile. Hidden until signed in via
/// either an injected wallet or a SIWE session (Circle passkey).
export function ProfileLink() {
  const { address, isSignedIn } = useOperatorAddress();
  if (!isSignedIn || !address) return null;
  return (
    <a
      href={`/operators/${address}`}
      className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3 transition-colors hover:text-ink"
    >
      PROFILE
    </a>
  );
}
