"use client";

import { useEffect, useState } from "react";
import { useOperatorAddress } from "@/hooks/useAuth";
import { fetchAgents } from "@/lib/agents";
import { Robot, TagButton } from "@/components/redesign";

/// First-run gate for the /app home. A brand-new visitor (no agent claimed)
/// gets a locked welcome over the home: the nav is hidden, nothing is
/// clickable, and the only live control is START, which sends them into
/// onboarding. The gate lifts the moment they hold an agent, and a persisted
/// flag keeps returning (or disconnected) users from ever seeing it again.
///
/// Fail-open by design: if the agent read errors or detection is uncertain we
/// do NOT gate, so a network blip can never lock a real user out.

const ONBOARDED_KEY = "arcrun_onboarded";

export function FirstRunGate() {
  const { address } = useOperatorAddress();
  const [mounted, setMounted] = useState(false);
  const [gated, setGated] = useState(false);
  const [flash, setFlash] = useState(false);

  // Render nothing until mounted so the server markup (the full home) and the
  // first client paint match; the gate fades in a frame later if needed.
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Onboarded before -> never gate again, even when signed out.
    if (window.localStorage.getItem(ONBOARDED_KEY) === "1") {
      setGated(false);
      return;
    }
    // Never onboarded and not connected: this is a fresh visitor -> gate.
    if (!address) {
      setGated(true);
      return;
    }
    let stop = false;
    fetchAgents(address as `0x${string}`)
      .then((agents) => {
        if (stop) return;
        if (agents.length > 0) {
          window.localStorage.setItem(ONBOARDED_KEY, "1");
          setGated(false);
        } else {
          setGated(true);
        }
      })
      .catch(() => {
        // Fail open: a read error must never lock someone out.
        if (!stop) setGated(false);
      });
    return () => {
      stop = true;
    };
  }, [address]);

  // Lock scroll under the gate.
  useEffect(() => {
    if (!gated || !mounted) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [gated, mounted]);

  if (!mounted || !gated) return null;

  function pokeFlash() {
    setFlash(true);
    setTimeout(() => setFlash(false), 1400);
  }

  return (
    <div
      onClick={pokeFlash}
      className="fixed inset-0 z-[100] flex items-center justify-center px-6 backdrop-blur-[2px]"
      style={{ backgroundColor: "rgba(244,241,237,0.96)" }}
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to ArcRun"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[460px] border border-ink bg-canvas p-8 text-center shadow-[0_12px_40px_rgba(26,22,18,0.18)]"
      >
        <div className="flex justify-center">
          <Robot variant="pink" size={72} decorative />
        </div>
        <div className="mt-5 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">
          <span aria-hidden className="text-accent">■</span> WELCOME TO ARCRUN
        </div>
        <h1 className="mt-2 font-stencil uppercase text-ink" style={{ fontSize: 30, lineHeight: 1.05 }}>
          START HERE
        </h1>
        <p className="mt-3 font-mono text-[12px] leading-[1.6] text-ink-2">
          claim your agent and send it to work. takes under a minute.
        </p>
        <div className="mt-6 flex justify-center">
          <TagButton href="/onboarding/welcome">START</TagButton>
        </div>
        <p
          aria-live="polite"
          className="mt-4 font-mono text-[11px] uppercase tracking-[0.12em] transition-opacity duration-150"
          style={{ color: "var(--accent)", opacity: flash ? 1 : 0 }}
        >
          Tap START to begin
        </p>
      </div>
    </div>
  );
}
