"use client";

import { useEffect, useState } from "react";
import { StatusChip } from "@/components/redesign";

/// Header strip rendered above every focused stage on /live/[source]/[id].
/// Shows source + id eyebrow, status chip, the pool/pot in stencil-display,
/// and a live countdown when an end time is available.

interface Props {
  source: "contest" | "challenge";
  id: number;
  kindLabel: string;
  statusLabel: string;
  statusTone: "ok" | "warn" | "err" | "ink";
  poolLabel: string;
  pool: string;
  /// Epoch seconds when the window closes. Null = no countdown.
  endSec: number | null;
  /// What happens after the countdown hits zero. e.g. "scoring next" or
  /// "results land ~30s after this hits zero". Rendered as a quiet line
  /// under the countdown so the user understands the round isn't finished
  /// the moment the clock stops.
  endHint?: string;
  /// Secondary line: e.g. "metric · entrants" for context.
  meta?: string;
}

function fmtCountdown(target: number): string {
  const left = Math.max(0, target - Math.floor(Date.now() / 1000));
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, "0")}s`;
  return `${s}s`;
}

export function EventHero({ source, id, kindLabel, statusLabel, statusTone, poolLabel, pool, endSec, endHint, meta }: Props) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!endSec) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [endSec]);

  const isLive = !!endSec && endSec > Math.floor(Date.now() / 1000);
  // A LOCKED event is full and racing NOW: the runner fires on lock and settles
  // within a couple of minutes. The on-chain resolve deadline can still be far
  // off (it's anchored to the join window), so counting down to it would falsely
  // read "29m left" while the race is actually live. Show a racing state instead.
  const racing = statusLabel.toUpperCase() === "LOCKED";

  return (
    <div className="flex flex-wrap items-end justify-between gap-6 border-b border-[color:var(--hairline)] pb-8">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
          <span aria-hidden className="text-accent">■</span>
          {source} #{id} · {kindLabel}
          <StatusChip tone={statusTone}>{statusLabel}</StatusChip>
        </div>
        <div className="mt-4 flex items-baseline gap-6">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">{poolLabel}</div>
            <div
              className="mt-1 font-stencil text-accent"
              style={{ fontSize: "clamp(40px, 7vw, 72px)", lineHeight: 0.95, letterSpacing: "-0.02em" }}
            >
              {pool}
            </div>
          </div>
          {racing ? (
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">STATUS</div>
              <div
                className="mt-1 font-stencil text-accent"
                style={{ fontSize: "clamp(28px, 4vw, 44px)", lineHeight: 0.95 }}
              >
                LIVE
              </div>
              <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
                racing now · results land shortly
              </div>
            </div>
          ) : endSec ? (
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">
                {isLive ? "TIME LEFT" : "WINDOW"}
              </div>
              <div
                className="mt-1 font-stencil text-ink"
                style={{ fontSize: "clamp(28px, 4vw, 44px)", lineHeight: 0.95 }}
              >
                {isLive ? fmtCountdown(endSec) : "CLOSED"}
              </div>
              {endHint && isLive ? (
                <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
                  {endHint}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        {meta ? (
          <div className="mt-4 font-mono text-[12px] uppercase tracking-[0.12em] text-ink-3">{meta}</div>
        ) : null}
      </div>
    </div>
  );
}
