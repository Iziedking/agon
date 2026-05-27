"use client";

import { useCallback, useEffect, useState } from "react";
import { BracketedCell, TagButton } from "@/components/redesign";
import {
  STATS,
  MAX_STAT_LEVEL,
  cancelTraining,
  cyclesCost,
  fetchTraining,
  finishEarly,
  startTraining,
  statDescription,
  type Stat,
  type TrainingState,
} from "@/lib/training";

/// Workshop training panel. Shows six stat bars (level out of 20), the active
/// training queue with countdown, and the start / cancel / finish-early
/// controls. Mounts on the operator's own workshop only.

function fmtCountdown(target: number): string {
  const left = Math.max(0, Math.floor((target - Date.now()) / 1000));
  if (left < 60) return `${left}s`;
  const m = Math.floor(left / 60);
  const s = left % 60;
  if (m < 60) return `${m}m ${s.toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm.toString().padStart(2, "0")}m`;
}

export function TrainingPanel({ agentId }: { agentId: number }) {
  const [state, setState] = useState<TrainingState | null | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);

  const refresh = useCallback(async () => {
    const next = await fetchTraining(agentId);
    setState(next);
  }, [agentId]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [refresh]);

  // Poll while a training row is active so completion lands the new level
  // without a manual refresh.
  useEffect(() => {
    if (!state || state === "loading") return;
    if (!state.active) return;
    const t = setInterval(() => { void refresh(); }, 5000);
    return () => clearInterval(t);
  }, [state, refresh]);

  if (state === "loading") {
    return (
      <BracketedCell pad="md">
        <p className="font-mono text-sm text-ink-2">reading training state…</p>
      </BracketedCell>
    );
  }
  if (!state) {
    return (
      <BracketedCell pad="md">
        <p className="font-mono text-sm text-ink-2">could not reach the training service.</p>
      </BracketedCell>
    );
  }

  const active = state.active;
  const activeCompletesAt = active ? Date.parse(active.completesAt) : 0;
  const isActiveComplete = active ? Date.now() >= activeCompletesAt : false;

  async function onStart(stat: Stat) {
    setBusy(true); setError(null);
    const res = await startTraining(agentId, stat);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    await refresh();
  }
  async function onCancel() {
    setBusy(true); setError(null);
    const res = await cancelTraining(agentId);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    await refresh();
  }
  async function onFinishEarly() {
    setBusy(true); setError(null);
    const res = await finishEarly(agentId);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    await refresh();
  }

  return (
    <BracketedCell pad="sm">
      <div className="flex flex-col">
        {STATS.map((s) => {
          const level = state.stats[s] ?? 0;
          const pct = (level / MAX_STAT_LEVEL) * 100;
          const isActive = !!active && active.stat === s;
          const trainingTarget = isActive ? active.toLevel : null;
          const trainingPct = trainingTarget ? (trainingTarget / MAX_STAT_LEVEL) * 100 : 0;
          const cost = cyclesCost(level);
          const maxed = level >= MAX_STAT_LEVEL;

          return (
            <div
              key={s}
              className="grid grid-cols-[8rem_1fr_auto] items-center gap-4 border-b border-[color:var(--hairline)] py-3 last:border-0"
            >
              <div className="min-w-0">
                <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">{s}</div>
                <div className="mt-0.5 font-mono text-[10px] text-ink-3">{statDescription(s)}</div>
              </div>

              <div>
                <div className="relative h-2 w-full border border-[color:var(--hairline-strong)] bg-canvas-2">
                  {/* Current level fill (ink) */}
                  <div className="absolute inset-y-0 left-0 bg-ink" style={{ width: `${pct}%` }} />
                  {/* Pending training target (pink) shown above current */}
                  {isActive ? (
                    <div
                      className="absolute inset-y-0 left-0 bg-accent opacity-70"
                      style={{ width: `${trainingPct}%` }}
                    />
                  ) : null}
                </div>
                <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-ink-3">
                  <span>LEVEL {level} / {MAX_STAT_LEVEL}</span>
                  {isActive ? (
                    <span className="text-accent">
                      → {active.toLevel} · {isActiveComplete ? "READY" : fmtCountdown(activeCompletesAt)}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-none items-center gap-2">
                {isActive ? (
                  isActiveComplete ? (
                    <button
                      onClick={() => void refresh()}
                      className="bg-accent px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press"
                    >
                      CLAIM
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={onFinishEarly}
                        disabled={busy}
                        className="bg-accent px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press disabled:opacity-60"
                      >
                        FINISH NOW
                      </button>
                      <button
                        onClick={onCancel}
                        disabled={busy}
                        className="border border-[color:var(--err)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--err)] hover:bg-canvas-3 disabled:opacity-60"
                      >
                        CANCEL
                      </button>
                    </>
                  )
                ) : maxed ? (
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">MAXED</span>
                ) : active ? (
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">LOCKED</span>
                ) : (
                  <button
                    onClick={() => void onStart(s)}
                    disabled={busy}
                    className="border border-ink bg-canvas px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink hover:bg-canvas-3 disabled:opacity-60"
                  >
                    TRAIN · {cost.toLocaleString()} ⊙
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {error ? <p className="mt-3 font-mono text-[11px] text-[color:var(--err)]">{error}</p> : null}
      <p className="mt-3 font-mono text-[10px] text-ink-3">
        each level adds 1% to scoring. one training slot per agent. cancel refunds 50% cycles; finish-now charges 2× the
        un-served time as cycles.
      </p>
    </BracketedCell>
  );
}
