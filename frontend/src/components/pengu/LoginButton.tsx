"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { LoginModal } from "@/components/pengu/LoginModal";

/// The navbar LOGIN entry. Opens the login popout. Once signed in, it shows the
/// short address (clicking reopens the popout to view the account or sign out).
export function LoginButton() {
  const [open, setOpen] = useState(false);
  const { me } = useAuth();
  const short = me ? `${me.address.slice(0, 6)}…${me.address.slice(-4)}` : null;

  return (
    <>
      {short ? (
        <button
          onClick={() => setOpen(true)}
          className="rounded-pill border border-pengu-blue/30 bg-white px-4 py-2 font-mono text-xs text-pengu-dark transition-colors hover:bg-pengu-blue/5"
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
