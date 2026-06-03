"use client";

import { useState } from "react";

/// Three-card scoring mode picker used at contest/challenge creation
/// for PREDICTION events. Mounts inside the create modal AFTER the
/// on-chain tx confirms (we don't know the event id until then). The
/// picker POSTs the chosen mode to /events/:source/:id/scoring-mode
/// so the coordinator's settlement path dispatches the right curve.
/// Picking nothing leaves it at the default (PNL_MTM).

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

export type ScoringMode = "pnl_mtm" | "pnl_realized" | "volume";

const MODES: Array<{
  id: ScoringMode;
  pill: string;
  title: string;
  body: string;
  best: string;
}> = [
  {
    id: "pnl_mtm",
    pill: "FAST · DEFAULT",
    title: "mark-to-market",
    body: "pay out by mtm pnl at window close. instant settle. agents' real arcana positions still resolve later, paid directly to hot wallets.",
    best: "short contests, demos, regular cadence",
  },
  {
    id: "pnl_realized",
    pill: "ACCURATE",
    title: "realized pnl",
    body: "pay out by realized pnl after arcana resolves the pinned markets. up to 48h wait. unresolved markets refund.",
    best: "high-stakes campaigns where accuracy beats speed",
  },
  {
    id: "volume",
    pill: "ACTIVITY",
    title: "volume",
    body: "pay out by stake volume share. ignores outcomes entirely. fastest settle.",
    best: "campaigns that want to drive arcana volume on chain",
  },
];

export function ScoringModePicker({
  source,
  eventId,
  onSet,
  defaultMode = "pnl_mtm",
}: {
  source: "contest" | "challenge";
  eventId: number;
  onSet?: (mode: ScoringMode) => void;
  defaultMode?: ScoringMode;
}) {
  const [picked, setPicked] = useState<ScoringMode>(defaultMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function commit(mode: ScoringMode) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${AUTH_URL}/events/${source}/${eventId}/scoring-mode`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `http ${res.status}`);
      }
      setPicked(mode);
      setSaved(true);
      onSet?.(mode);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not save");
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-3 font-mono text-[11px] uppercase tracking-[0.16em]">
        <span aria-hidden className="text-accent">■</span>
        <span className="text-ink-3">SCORE BY</span>
        <span className="text-ink">choose one</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {MODES.map((m) => {
          const active = picked === m.id;
          return (
            <button
              key={m.id}
              onClick={() => void commit(m.id)}
              disabled={busy}
              className={`flex flex-col gap-2 border p-3 text-left transition disabled:opacity-60 ${
                active
                  ? "border-accent bg-canvas-2"
                  : "border-[color:var(--hairline)] bg-canvas hover:border-ink"
              }`}
            >
              <span className={`font-mono text-[9px] uppercase tracking-[0.16em] ${active ? "text-accent" : "text-ink-3"}`}>
                {m.pill}
              </span>
              <span className="font-stencil text-[18px] uppercase leading-tight text-ink">
                {m.title}
              </span>
              <span className="font-mono text-[10px] leading-[1.45] text-ink-2">{m.body}</span>
              <span className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">
                best for: {m.best}
              </span>
            </button>
          );
        })}
      </div>
      {error ? (
        <p className="font-mono text-[11px] text-[color:var(--err)]">{error}</p>
      ) : saved ? (
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
          scoring rule saved · {MODES.find((m) => m.id === picked)?.title}
        </p>
      ) : null}
    </div>
  );
}
