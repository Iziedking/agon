"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { useAuth } from "@/hooks/useAuth";
import { LoginModal } from "@/components/pengu/LoginModal";

/// The navbar LOGIN entry. Two states share the button:
/// - Connected wallet (wagmi) OR active SIWE session: shows the short address
///   so the header reflects reality even before the SIWE round-trip completes.
///   The SIWE session address wins if both exist (e.g., right after the JWT
///   issues), so a wallet swap in MetaMask without a fresh SIWE doesn't make
///   the header lie about who's signed in to the backend.
/// - Neither: shows the chunky "sign in" CTA that opens the login popout.
export function LoginButton() {
  const [open, setOpen] = useState(false);
  const { me } = useAuth();
  const { address: wallet, isConnected } = useAccount();
  const display = me?.address ?? (isConnected ? wallet : null);
  const short = display ? `${display.slice(0, 6)}…${display.slice(-4)}` : null;

  return (
    <>
      {short ? (
        <button
          onClick={() => setOpen(true)}
          className="rounded-pill border border-pengu-blue/30 bg-pengu-card px-4 py-2 font-mono text-xs text-pengu-dark transition-colors hover:bg-pengu-blue/5"
        >
          {short}
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="rounded-pill bg-pengu-blue px-6 py-2 font-display text-xs uppercase tracking-wide text-white transition-transform duration-150 hover:-translate-y-0.5"
        >
          sign in
        </button>
      )}
      <LoginModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
