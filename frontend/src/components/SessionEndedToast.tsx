"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";

/// Surfaces a small "session ended" toast when the auth context clears
/// the cookie on a stale-wallet or wallet-switch detection. Without
/// this, the only signal to the user was "the login button reappeared
/// silently" which reads as a bug instead of a recovery. Auto-dismisses
/// after 8s; user can also click to dismiss.

const AUTO_DISMISS_MS = 8000;

export function SessionEndedToast() {
  const { sessionEndedReason, clearSessionEndedReason } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!sessionEndedReason) {
      setOpen(false);
      return;
    }
    setOpen(true);
    const t = setTimeout(() => {
      setOpen(false);
      clearSessionEndedReason();
    }, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [sessionEndedReason, clearSessionEndedReason]);

  if (!open || !sessionEndedReason) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 left-1/2 z-[var(--z-toast)] -translate-x-1/2"
    >
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          clearSessionEndedReason();
        }}
        className="flex items-center gap-3 border border-ink bg-canvas-2 px-4 py-2.5 font-mono text-[12px] uppercase tracking-[0.12em] text-ink shadow-[0_8px_24px_rgba(26,22,18,0.18)] hover:bg-canvas-3"
      >
        <span aria-hidden className="text-accent">■</span>
        <span className="text-ink-3">SESSION ENDED</span>
        <span className="text-ink normal-case tracking-normal">{sessionEndedReason}</span>
        <span className="text-ink-3">×</span>
      </button>
    </div>
  );
}
