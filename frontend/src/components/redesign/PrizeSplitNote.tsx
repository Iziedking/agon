"use client";

import { useEffect, useState } from "react";

/// One-line, read-only label of the creator's prize split, shown on the live
/// watcher so viewers know how the pool pays out before settlement. Reads
/// /events/:source/:id/payout. Renders nothing until loaded, and nothing when
/// the event is on the standard split (keeps the header quiet for the common
/// case).

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

const PRESET_LABEL: Record<string, string> = {
  winner_take_all: "winner takes the whole pool",
  top2: "top 2 split 60 / 40",
  top3: "top 3 split 50 / 30 / 20",
  top5_half_field: "top 5 take 50%, the rest of the field splits the other 50%",
  even_all: "everyone who joined splits the pool equally",
};

function customLabel(config: unknown): string {
  const c = config as { winnersBps?: number[]; restSharedBps?: number } | null;
  if (!c || !Array.isArray(c.winnersBps)) return "custom split";
  const winners = c.winnersBps.map((b) => `${Math.round(b / 100)}%`).join(" / ");
  const rest = c.restSharedBps && c.restSharedBps > 0 ? `, ${Math.round(c.restSharedBps / 100)}% shared` : "";
  return `custom: ${winners}${rest}`;
}

export function PrizeSplitNote({ source, id }: { source: "contest" | "challenge"; id: number }) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`${AUTH_URL}/events/${source}/${id}/payout`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { preset?: string | null; config?: unknown } | null) => {
        if (!live || !d?.preset) return;
        setLabel(d.preset === "custom" ? customLabel(d.config) : PRESET_LABEL[d.preset] ?? null);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [source, id]);

  if (!label) return null;
  return (
    <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
      <span aria-hidden className="text-accent">■</span> PRIZE SPLIT · <span className="text-ink-2 normal-case tracking-normal">{label}</span>
    </p>
  );
}
