"use client";

import { useEffect, useState } from "react";

/// The shared card for contests and challenges. Crest and live status up top, the
/// USDC number as the hero, a draining time bar (when we know the window), and an
/// entrants footer. Client-side so the bar and countdown tick. Props are plain
/// values, so a server page can render it directly.

export type ArenaState = "open" | "active" | "settled" | "cancelled";

export interface ArenaCardProps {
  href: string;
  kind: string; // SCOUT, PUZZLE, ...
  state: ArenaState;
  stateLabel: string; // open, scoring, locked, settled, cancelled
  metric: string;
  prizeLabel: string; // prize pool, stake to enter, ...
  prize: string; // formatted, e.g. "2.00 USDC"
  startSec?: number | null;
  endSec?: number | null;
  footerLeft: string;
  footerRight: string;
}

function Crest() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 text-pengu-blue" aria-hidden>
      <path
        d="M12 2 21 7 21 17 12 22 3 17 3 7Z"
        fill="currentColor"
        fillOpacity="0.18"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function fmtRemaining(endSec: number, nowSec: number): string {
  const left = Math.max(0, endSec - nowSec);
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  if (h > 0) return `${h}h ${m}m left`;
  if (m > 0) return `${m}m ${s}s left`;
  return `${s}s left`;
}

export function ArenaCard(p: ArenaCardProps) {
  const [, tick] = useState(0);
  const live = p.state === "open" && !!p.endSec;
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [live]);

  const nowSec = Math.floor(Date.now() / 1000);
  const showTime = live && p.endSec! > nowSec;
  let fill = 1;
  if (showTime && p.startSec && p.endSec! > p.startSec) {
    fill = Math.min(1, Math.max(0, (p.endSec! - nowSec) / (p.endSec! - p.startSec)));
  }

  const stateCls =
    p.state === "open" ? "text-[#22c55e]" : p.state === "active" ? "text-pengu-dark" : "text-pengu-dark/45";

  return (
    <a
      href={p.href}
      className="flex flex-col rounded-card border border-pengu-blue/15 bg-pengu-card p-6 shadow-[0_10px_30px_rgba(70,45,150,0.08)] transition-transform duration-150 hover:-translate-y-1"
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 font-display text-xs uppercase tracking-wide text-pengu-blue">
          <Crest />
          {p.kind}
        </span>
        <span className={`flex items-center gap-1.5 font-display text-xs uppercase ${stateCls}`}>
          {p.state === "open" && <span className="h-2 w-2 rounded-full bg-[#22c55e] animate-pulse-live" />}
          {p.stateLabel}
        </span>
      </div>

      <div className="mt-4 font-display text-xs uppercase tracking-wide text-pengu-dark/45">{p.metric}</div>
      <div className="mt-3 font-display text-[40px] leading-none text-pengu-blue">{p.prize}</div>
      <div className="mt-1 font-display text-[11px] uppercase tracking-wide text-pengu-dark/40">{p.prizeLabel}</div>

      {showTime ? (
        <div className="mt-5">
          {p.startSec ? (
            <div className="h-2 w-full overflow-hidden rounded-full bg-pengu-blue/10">
              <div className="h-full rounded-full bg-pengu-blue transition-all duration-500" style={{ width: `${fill * 100}%` }} />
            </div>
          ) : null}
          <div className="mt-2 font-mono text-xs text-pengu-blue">{fmtRemaining(p.endSec!, nowSec)}</div>
        </div>
      ) : (
        <div className="mt-5 font-mono text-xs text-pengu-dark/45">{p.stateLabel}</div>
      )}

      <div className="mt-auto flex items-center justify-between border-t border-pengu-blue/10 pt-3">
        <span className="font-mono text-xs text-pengu-dark/45">{p.footerLeft}</span>
        <span className="font-mono text-xs text-pengu-dark/45">{p.footerRight}</span>
      </div>
    </a>
  );
}
