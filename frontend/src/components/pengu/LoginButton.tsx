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
          className="border border-ink bg-canvas px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink transition-colors hover:bg-canvas-3"
        >
          {short}
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 bg-accent px-4 py-2 font-mono text-[12px] uppercase tracking-[0.12em] text-accent-ink transition-colors hover:bg-accent-press"
          style={{ clipPath: "polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%)" }}
        >
          SIGN IN <span aria-hidden>→</span>
        </button>
      )}
      <LoginModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
