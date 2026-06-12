"use client";

import { useCallback, useEffect, useState } from "react";
import { BracketedCell, TagButton } from "@/components/redesign";
import { useAuth } from "@/hooks/useAuth";
import {
  STATS,
  MAX_STAT_LEVEL,
  cancelTraining,
  cyclesCost,
  fetchTraining,
  finishEarly,
  maxSpeedupSteps,
  secondsCost,
  startTraining,
  statDescription,
  type Stat,
  type SpeedupParams,
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

/// Fallback speedup params if the server didn't include them (older auth
/// service). Keeps the UI usable; the server will clamp/reject anyway.
const FALLBACK_SPEEDUP: SpeedupParams = {
  cyclesPerStep: 50,
  secondsPerStep: 900,
  minSeconds: 60,
  baseSecondsPerLevel: 3600,
};

function fmtMinutes(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

export function TrainingPanel({ agentId }: { agentId: number }) {
  const { me, refresh: refreshMe } = useAuth();
  const cycles = me?.cycles ?? 0;
  const [state, setState] = useState<TrainingState | null | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);
  // Per-stat speedup step count, set by clicking the FAST chip on a row.
  // Cleared on successful start so the next training picks up at 0.
  const [speedupByStat, setSpeedupByStat] = useState<Partial<Record<Stat, number>>>({});

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
  const speedupParams = state.speedup ?? FALLBACK_SPEEDUP;

  async function onStart(stat: Stat) {
    setError(null);
    const steps = speedupByStat[stat] ?? 0;
    // Graceful pre-flight check: cycles come from winning, so a fresh operator
    // often can't afford training yet. Catch it here with friendly copy instead
    // of letting the server reject the write.
    const lvl = (state !== "loading" && state ? state.stats[stat] : 0) ?? 0;
    const need = cyclesCost(lvl, steps, (state !== "loading" && state ? state.speedup?.cyclesPerStep : undefined) ?? FALLBACK_SPEEDUP.cyclesPerStep);
    if (need > cycles) {
      setError(`not enough cycles. this costs ${need.toLocaleString()} and you have ${cycles.toLocaleString()}. win a contest or challenge to stack cycles, then train.`);
      return;
    }
    setBusy(true);
    const res = await startTraining(agentId, stat, steps);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    // Reset the picker for this stat after a successful queue.
    setSpeedupByStat((prev) => ({ ...prev, [stat]: 0 }));
    // Refresh training state AND the cycle balance (training just spent cycles).
    await Promise.all([refresh(), refreshMe()]);
  }
  async function onCancel() {
    setBusy(true); setError(null);
    const res = await cancelTraining(agentId);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    await Promise.all([refresh(), refreshMe()]); // cancel refunds 50% cycles
  }
  async function onFinishEarly() {
    setBusy(true); setError(null);
    const res = await finishEarly(agentId);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    await Promise.all([refresh(), refreshMe()]); // finish-now charges extra cycles
  }

  return (
    <BracketedCell pad="sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--hairline)] pb-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">YOUR CYCLES</span>
        <span className="font-mono text-[15px] tabular-nums text-ink">
          {cycles.toLocaleString()} <span aria-hidden className="text-ink-3">⊙</span>
        </span>
      </div>
      <div className="flex flex-col">
        {STATS.map((s) => {
          const level = state.stats[s] ?? 0;
          const pct = (level / MAX_STAT_LEVEL) * 100;
          const isActive = !!active && active.stat === s;
          const trainingTarget = isActive ? active.toLevel : null;
          const trainingPct = trainingTarget ? (trainingTarget / MAX_STAT_LEVEL) * 100 : 0;
          const speedupSteps = Math.min(speedupByStat[s] ?? 0, maxSpeedupSteps(level, speedupParams));
          const cost = cyclesCost(level, speedupSteps, speedupParams.cyclesPerStep);
          const totalSeconds = secondsCost(level, speedupSteps, speedupParams);
          const speedupCap = maxSpeedupSteps(level, speedupParams);
          const maxed = level >= MAX_STAT_LEVEL;
          function cycleSpeedup() {
            setSpeedupByStat((prev) => {
              const cur = prev[s] ?? 0;
              const next = cur >= speedupCap ? 0 : cur + 1;
              return { ...prev, [s]: next };
            });
          }

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
                  <>
                    {speedupCap > 0 ? (
                      <button
                        onClick={cycleSpeedup}
                        disabled={busy}
                        title={
                          speedupSteps === 0
                            ? `click to add ${speedupParams.cyclesPerStep}¢ for −${Math.round(speedupParams.secondsPerStep / 60)}m`
                            : `${speedupSteps}/${speedupCap} speedup applied`
                        }
                        className={`border px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] hover:bg-canvas-3 disabled:opacity-60 ${
                          speedupSteps > 0
                            ? "border-accent bg-accent text-accent-ink hover:bg-accent-press"
                            : "border-[color:var(--hairline-strong)] bg-canvas text-ink-2"
                        }`}
                      >
                        {speedupSteps > 0 ? `FAST ${speedupSteps}×` : "+ FAST"}
                      </button>
                    ) : null}
                    <button
                      onClick={() => void onStart(s)}
                      disabled={busy}
                      title={`${fmtMinutes(totalSeconds)} queue`}
                      className="border border-ink bg-canvas px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink hover:bg-canvas-3 disabled:opacity-60"
                    >
                      TRAIN · {cost.toLocaleString()} ⊙ · {fmtMinutes(totalSeconds)}
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {error ? <p className="mt-3 font-mono text-[11px] text-[color:var(--err)]">{error}</p> : null}
      <p className="mt-3 font-mono text-[10px] text-ink-3">
        each level adds 1% to scoring. one training slot per agent. cancel refunds 50% cycles; finish-now charges 2× the
        un-served time. + FAST adds {speedupParams.cyclesPerStep}¢ per step and shaves {Math.round(speedupParams.secondsPerStep / 60)}m.
      </p>
    </BracketedCell>
  );
}
