"use client";

import { useMemo, useState } from "react";

/// Prize-distribution picker shown right after a contest / challenge is
/// created (we need the event id, which only exists once the on-chain tx
/// confirms). POSTs the chosen preset to /events/:source/:id/payout so the
/// coordinator splits the pool that way at settlement. Picking nothing leaves
/// the event on the standard curve. Distribution is orthogonal to scoring:
/// scoring decides the ranking, this decides how the pool splits over it.

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

type PresetKey =
  | "winner_take_all"
  | "top2"
  | "top3"
  | "top5_half_field"
  | "even_all"
  | "custom";

const PRESETS: Array<{ id: PresetKey; title: string; body: string }> = [
  { id: "winner_take_all", title: "winner takes all", body: "rank 1 takes the whole pool." },
  { id: "top2", title: "two winners", body: "60 / 40 to the top two." },
  { id: "top3", title: "three winners", body: "50 / 30 / 20 to the top three." },
  { id: "top5_half_field", title: "top 5 and field", body: "top five share half the pool, everyone else who joined splits the rest." },
  { id: "even_all", title: "even split", body: "everyone who joined splits the pool equally." },
  { id: "custom", title: "custom", body: "set your own winner shares and a remainder for the field." },
];

/// Parse a comma list of percentages ("50, 30, 20") into integer basis points.
/// Returns null on any non-numeric or negative entry.
function parsePercents(raw: string): number[] | null {
  const parts = raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  const out: number[] = [];
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isFinite(n) || n < 0) return null;
    out.push(Math.round(n * 100)); // percent -> basis points
  }
  return out;
}

export function PayoutPresetPicker({
  source,
  eventId,
}: {
  source: "contest" | "challenge";
  eventId: number;
}) {
  const [picked, setPicked] = useState<PresetKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedLabel, setSavedLabel] = useState<string | null>(null);

  // Custom inputs, as percentages so the host thinks in plain numbers.
  const [winnersPct, setWinnersPct] = useState("50, 30, 20");
  const [restPct, setRestPct] = useState("0");

  const customCheck = useMemo(() => {
    const winnersBps = parsePercents(winnersPct);
    const restList = parsePercents(restPct);
    if (!winnersBps || !restList || restList.length > 1) {
      return { ok: false as const, reason: "use numbers like 50, 30, 20" };
    }
    const restSharedBps = restList[0] ?? 0;
    const sum = winnersBps.reduce((a, b) => a + b, 0) + restSharedBps;
    if (sum !== 10000) {
      return { ok: false as const, reason: `shares add up to ${(sum / 100).toFixed(0)}%, they must total 100%` };
    }
    return { ok: true as const, winnersBps, restSharedBps };
  }, [winnersPct, restPct]);

  async function commit(preset: PresetKey, config?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${AUTH_URL}/events/${source}/${eventId}/payout`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset, config }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `http ${res.status}`);
      }
      setPicked(preset);
      setSavedLabel(PRESETS.find((p) => p.id === preset)?.title ?? preset);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not save");
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-3 font-mono text-[11px] uppercase tracking-[0.16em]">
        <span aria-hidden className="text-accent">■</span>
        <span className="text-ink-3">PRIZE SPLIT</span>
        <span className="text-ink">choose one</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {PRESETS.map((p) => {
          const active = picked === p.id;
          return (
            <button
              key={p.id}
              onClick={() => {
                if (p.id === "custom") { setPicked("custom"); return; }
                void commit(p.id);
              }}
              disabled={busy}
              className={`flex flex-col gap-1.5 border p-3 text-left transition disabled:opacity-60 ${
                active ? "border-accent bg-canvas-2" : "border-[color:var(--hairline)] bg-canvas hover:border-ink"
              }`}
            >
              <span className="font-stencil text-[16px] uppercase leading-tight text-ink">{p.title}</span>
              <span className="font-mono text-[10px] leading-[1.45] text-ink-2">{p.body}</span>
            </button>
          );
        })}
      </div>

      {picked === "custom" ? (
        <div className="flex flex-col gap-2 border border-[color:var(--hairline)] bg-canvas p-3">
          <label className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
            WINNER SHARES (%, RANK 1 FIRST)
          </label>
          <input
            value={winnersPct}
            onChange={(e) => setWinnersPct(e.target.value)}
            placeholder="50, 30, 20"
            className="border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2 font-mono text-sm text-ink outline-none focus:border-ink"
          />
          <label className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
            SHARED ACROSS THE REST OF THE FIELD (%)
          </label>
          <input
            value={restPct}
            onChange={(e) => setRestPct(e.target.value)}
            placeholder="0"
            className="border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2 font-mono text-sm text-ink outline-none focus:border-ink"
          />
          <div className="mt-1 flex items-center justify-between gap-3">
            <span className={`font-mono text-[10px] ${customCheck.ok ? "text-ink-3" : "text-[color:var(--err)]"}`}>
              {customCheck.ok ? "totals 100%" : customCheck.reason}
            </span>
            <button
              onClick={() => customCheck.ok && void commit("custom", { winnersBps: customCheck.winnersBps, restSharedBps: customCheck.restSharedBps })}
              disabled={busy || !customCheck.ok}
              className="bg-accent px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press disabled:opacity-50"
            >
              SAVE SPLIT
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="font-mono text-[11px] text-[color:var(--err)]">{error}</p>
      ) : savedLabel ? (
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
          prize split saved · {savedLabel}
        </p>
      ) : (
        <p className="font-mono text-[10px] text-ink-3">
          skip to use the standard split. you can keep this open while operators join.
        </p>
      )}
    </div>
  );
}
