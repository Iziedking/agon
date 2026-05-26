"use client";

import { useEffect, useState } from "react";
import type { AgentVariant } from "@/components/pengu/AgentMascot";
import { AgentMascot } from "@/components/pengu/AgentMascot";

/// One mini-card on /live: either a contest or a challenge, in any active
/// state. Stays compact, links to the detail page where the full stage and
/// standings live. The card itself only carries: what kind, what status, the
/// pool number, time left, entrants. A small "live" pulse appears when the
/// coordinator is currently broadcasting standings for this id.

export type EventKind = "contest" | "challenge";
export type EventTypeLabel = "scout" | "analyst" | "solver" | "prediction" | "puzzle" | "volume" | "custom";

const VARIANT_BY_TYPE: Record<EventTypeLabel, AgentVariant> = {
  scout: "gold",
  volume: "gold",
  analyst: "cyan",
  prediction: "cyan",
  solver: "violet",
  puzzle: "violet",
  custom: "crimson",
};

const COLOR_BY_TYPE: Record<EventTypeLabel, string> = {
  scout: "#D97706",
  volume: "#D97706",
  analyst: "#0891B2",
  prediction: "#0891B2",
  solver: "#7C3AED",
  puzzle: "#7C3AED",
  custom: "#DC2626",
};

interface Props {
  kind: EventKind;
  href: string;
  id: number;
  type: EventTypeLabel;
  status: "open" | "scoring" | "locked";
  poolLabel: string;
  pool: string;
  entrants: string;
  endSec: number | null;
  /// True when the coordinator is currently streaming standings for this id.
  liveBroadcast?: boolean;
}

function fmtRemaining(endSec: number, nowSec: number): string {
  const left = Math.max(0, endSec - nowSec);
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function EventCard({ kind, href, id, type, status, poolLabel, pool, entrants, endSec, liveBroadcast }: Props) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!endSec) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [endSec]);

  const nowSec = Math.floor(Date.now() / 1000);
  const showTime = !!endSec && endSec > nowSec;
  const variant = VARIANT_BY_TYPE[type] ?? "violet";
  const accent = COLOR_BY_TYPE[type] ?? "#7c4dff";

  const statusLabel =
    status === "open" ? "open" : status === "scoring" ? "scoring" : "locked · scoring";
  const statusClass =
    status === "open" ? "text-[#22c55e]" : status === "scoring" ? "text-pengu-blue" : "text-pengu-blue";

  return (
    <a
      href={href}
      className="group relative flex flex-col overflow-hidden rounded-card border border-pengu-blue/15 bg-pengu-card p-5 shadow-[0_10px_30px_rgba(70,45,150,0.08)] transition-transform duration-150 hover:-translate-y-1"
      style={{ borderTopColor: accent, borderTopWidth: 3 }}
    >
      <div
        className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full opacity-20"
        style={{ background: accent, filter: "blur(36px)" }}
        aria-hidden
      />

      <div className="relative flex items-center justify-between">
        <span
          className="rounded-pill px-2.5 py-1 font-display text-[10px] uppercase tracking-wide"
          style={{ background: `${accent}18`, color: accent }}
        >
          {kind === "contest" ? "contest" : "challenge"} · {type}
        </span>
        <span className={`flex items-center gap-1.5 font-display text-[10px] uppercase tracking-wide ${statusClass}`}>
          {liveBroadcast ? (
            <span className="h-1.5 w-1.5 rounded-full bg-pengu-blue animate-pulse-live" />
          ) : status === "open" ? (
            <span className="h-1.5 w-1.5 rounded-full bg-[#22c55e]" />
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-pengu-blue" />
          )}
          {liveBroadcast ? "racing" : statusLabel}
        </span>
      </div>

      <div className="relative mt-3 flex items-end gap-3">
        <AgentMascot variant={variant} mood={liveBroadcast ? "focus" : "idle"} live={liveBroadcast} className="h-16 w-auto" />
        <div className="min-w-0">
          <div className="font-display text-[10px] uppercase tracking-wide text-pengu-dark/45">{poolLabel}</div>
          <div className="font-display text-2xl leading-none text-pengu-dark">{pool}</div>
        </div>
      </div>

      <div className="relative mt-4 flex items-center justify-between border-t border-pengu-blue/10 pt-3 font-mono text-[11px] text-pengu-dark/55">
        <span>
          {kind === "contest" ? "contest" : "challenge"} <span className="text-pengu-dark">#{id}</span>
        </span>
        <span>{entrants} entrant{entrants === "1" ? "" : "s"}</span>
      </div>

      <div className="relative mt-1 flex items-center justify-between font-mono text-[11px] text-pengu-dark/55">
        <span>{showTime ? `${fmtRemaining(endSec, nowSec)} left` : "window closing"}</span>
        <span className="font-display text-[10px] uppercase tracking-wide text-pengu-blue opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          watch →
        </span>
      </div>
    </a>
  );
}
