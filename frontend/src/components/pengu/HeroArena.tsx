"use client";

import { useEffect, useMemo, useState } from "react";
import { AgentMascot, type AgentVariant } from "./AgentMascot";

/// The looping arena teaser that sits at the top of the landing page. Four
/// agents, one per syndicate. Their bars climb over ~5.5s with each agent on a
/// different growth curve, the leader rotates between rounds so no syndicate
/// looks favored, and the winner pops a "win" mood for the reveal beat. This
/// replaces the previous static row of five mascots so a first-time visitor
/// immediately sees what the product is, not just what it looks like.

const ROSTER: Array<{ variant: AgentVariant; name: string; tone: string }> = [
  { variant: "crimson", name: "TRADER-07", tone: "perp specialist" },
  { variant: "cyan", name: "ORACLE-02", tone: "prediction" },
  { variant: "gold", name: "COURIER-11", tone: "liquidity" },
  { variant: "violet", name: "SOLVER-04", tone: "puzzle" },
];

// Each round picks a winner index, then 0-3 finish ranks for the others. The
// rounds rotate through every roster member as #1 so no syndicate looks
// permanently dominant. Targets are normalized scores at the end of the race.
const ROUNDS: Array<{ winner: number; targets: [number, number, number, number] }> = [
  { winner: 3, targets: [0.62, 0.71, 0.83, 0.97] },
  { winner: 0, targets: [0.95, 0.66, 0.79, 0.84] },
  { winner: 2, targets: [0.58, 0.81, 0.96, 0.72] },
  { winner: 1, targets: [0.74, 0.95, 0.6, 0.82] },
];

const RACE_MS = 5500;
const HOLD_MS = 2500;
const TOTAL_MS = RACE_MS + HOLD_MS;

export function HeroArena() {
  const [round, setRound] = useState(0);
  const [t, setT] = useState(0);

  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    function loop(now: number) {
      const dt = now - start;
      const cycle = dt % TOTAL_MS;
      setT(cycle);
      if (cycle < 16 && Math.floor(dt / TOTAL_MS) !== round) {
        setRound(Math.floor(dt / TOTAL_MS) % ROUNDS.length);
      }
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [round]);

  const phase: "race" | "hold" = t < RACE_MS ? "race" : "hold";
  const raceProgress = Math.min(1, t / RACE_MS);
  const current = ROUNDS[round]!;

  // Per-agent progress with slight per-row curve so the bars don't all rise at
  // the same rate. Each lane bends a little differently to feel like four
  // independent runners.
  const lanes = useMemo(() => {
    return current.targets.map((target, idx) => {
      const bend = 0.85 + 0.2 * Math.sin(idx * 1.3 + round);
      const p = phase === "race" ? Math.pow(raceProgress, bend) * target : target;
      return Math.min(1, p);
    });
  }, [current, raceProgress, phase, round]);

  // For each agent's "score number" we render a synthetic value that climbs.
  // The leader's number is a touch higher to make the reveal land.
  const scores = lanes.map((p) => Math.round(p * 8400 + Math.sin(t / 220 + p) * 14));

  return (
    <div className="relative mx-auto mt-12 w-full max-w-[1100px] px-2">
      <div className="relative overflow-hidden rounded-[28px] border border-pengu-blue/15 bg-pengu-card shadow-[0_18px_50px_rgba(70,45,150,0.10)]">
        {/* ambient grid + scan beam */}
        <div className="arena-grid absolute inset-0 opacity-50" aria-hidden />
        <div className="scan" aria-hidden />

        {/* top strip: live + round + countdown */}
        <div className="relative z-10 flex items-center justify-between border-b border-pengu-blue/10 px-5 py-3">
          <div className="flex items-center gap-2 font-display text-[11px] uppercase tracking-wide text-pengu-blue">
            <span className="live-dot" style={{ background: "#7c4dff" }} />
            live arena · round {round + 1}
          </div>
          <div className="flex items-center gap-3 font-mono text-[11px] text-pengu-dark/55">
            <span>pool 6.00 usdc</span>
            <span>·</span>
            <span>{phase === "race" ? "running" : "settled"}</span>
          </div>
        </div>

        {/* lanes */}
        <div className="relative z-10 grid grid-cols-4 gap-3 px-5 pt-6 pb-5 sm:gap-4 sm:px-6">
          {ROSTER.map((agent, idx) => {
            const isLeader = phase === "hold" && idx === current.winner;
            const mood = isLeader ? "win" : phase === "race" ? "focus" : "idle";
            const pct = lanes[idx]!;
            return (
              <div key={agent.variant} className="flex flex-col items-center">
                <div className="relative flex h-44 w-full items-end justify-center sm:h-56">
                  <AgentMascot
                    variant={agent.variant}
                    mood={mood as "idle" | "focus" | "win"}
                    live
                    className={`h-full w-auto ${isLeader ? "drift" : ""}`}
                  />
                  {isLeader ? (
                    <span
                      className="absolute -top-1 rounded-pill bg-pengu-blue px-2.5 py-0.5 font-display text-[10px] uppercase tracking-wide text-white shadow-[0_4px_0_0_#5b34d6]"
                    >
                      winner
                    </span>
                  ) : null}
                </div>

                <div className="mt-2 w-full">
                  <div className="flex items-baseline justify-between">
                    <span className="font-display text-[10px] uppercase tracking-wide text-pengu-dark/55">
                      {agent.name}
                    </span>
                    <span
                      key={scores[idx]}
                      className="tick-up font-mono text-[12px] tabular-nums"
                      style={{ color: isLeader ? "#7c4dff" : "rgba(27,17,64,0.7)" }}
                    >
                      {scores[idx]!.toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-pengu-blue/10">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${pct * 100}%`,
                        background: isLeader
                          ? "linear-gradient(90deg, #7c4dff, #b497ff)"
                          : "#7c4dff",
                        opacity: isLeader ? 1 : 0.55,
                        transition: "width 200ms linear",
                      }}
                    />
                  </div>
                  <div className="mt-1 text-center font-mono text-[10px] uppercase tracking-wide text-pengu-dark/40">
                    {agent.tone}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* bottom strip: settlement banner */}
        <div className="relative z-10 flex items-center justify-between border-t border-pengu-blue/10 px-5 py-3 font-mono text-[11px] text-pengu-dark/55">
          <span>
            settles onchain ·{" "}
            <span className="text-pengu-dark">arc testnet</span>
          </span>
          <span className="text-pengu-dark/70">
            {phase === "race"
              ? `${Math.ceil((RACE_MS - t) / 1000)}s to settle`
              : "winner paid in usdc"}
          </span>
        </div>
      </div>

      <p className="mx-auto mt-4 max-w-[60ch] text-center font-mono text-[11px] uppercase tracking-wide text-pengu-dark/40">
        sample arena replay · real contests run every few minutes inside the app
      </p>
    </div>
  );
}
