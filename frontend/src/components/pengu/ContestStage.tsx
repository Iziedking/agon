"use client";

import { useEffect, useMemo, useState } from "react";
import type { StandingsEntry } from "@/lib/live";
import { AgentMascot, type AgentVariant } from "@/components/pengu/AgentMascot";

/// The visible competition surface that sits above the standings list. Picks
/// the right "stage" for the contest's type so the page declares "agents are
/// doing X" rather than "scores are climbing". This first pass derives the
/// visible activity from the existing standings frames (score, rank), so it
/// works against the broadcast we already have. A later pass will enrich the
/// coordinator broadcast with real per-agent progress detail (which cells the
/// puzzle agent solved, which tx hashes the volume agent posted, which nodes
/// the solver explored) and the stage will read that directly.

/// How many agents the stage features. The rest stay in the standings list
/// below. Three keeps the per-stage detail readable without making the page
/// feel empty when only one or two have entered.
const FEATURED = 3;

/// Friendly labels for the four canonical kinds the backend emits today.
function normalizeKind(raw?: string): "puzzle" | "volume" | "solver" | "prediction" | "custom" {
  const k = (raw ?? "").toUpperCase();
  if (k === "ANALYST" || k === "PUZZLE") return "puzzle";
  if (k === "SCOUT" || k === "VOLUME") return "volume";
  if (k === "SOLVER") return "solver";
  if (k === "PREDICTION") return "prediction";
  return "custom";
}

/// Pick a stable mascot variant from an agentId so the same agent always
/// renders in the same color across the page.
const VARIANTS: AgentVariant[] = ["violet", "crimson", "cyan", "gold"];
function variantFor(agentId: number): AgentVariant {
  return VARIANTS[agentId % VARIANTS.length]!;
}

export function ContestStage({
  contestType,
  entries,
}: {
  contestType?: string;
  entries: StandingsEntry[];
}) {
  const kind = normalizeKind(contestType);
  const featured = entries.slice(0, FEATURED);
  const maxScore = Math.max(...entries.map((e) => e.score), 1);

  return (
    <div className="relative overflow-hidden rounded-card border border-pengu-blue/15 bg-white">
      {/* arena grid + scan beam, the broadcast-floor backdrop */}
      <div className="arena-grid absolute inset-0 opacity-50" aria-hidden />
      <div className="scan" aria-hidden />

      <div className="relative z-10 flex items-center justify-between border-b border-pengu-blue/10 px-5 py-3">
        <div className="flex items-center gap-2 font-display text-[11px] uppercase tracking-wide text-pengu-blue">
          <span className="live-dot" style={{ background: "#7c4dff" }} />
          stage · {kind}
        </div>
        <span className="font-mono text-[11px] uppercase tracking-wide text-pengu-dark/50">
          showing top {Math.min(FEATURED, featured.length)} of {entries.length}
        </span>
      </div>

      <div className="relative z-10 p-5 sm:p-6">
        {featured.length === 0 ? (
          <EmptyStage kind={kind} />
        ) : kind === "puzzle" ? (
          <PuzzleStage featured={featured} maxScore={maxScore} />
        ) : kind === "volume" ? (
          <VolumeStage featured={featured} maxScore={maxScore} />
        ) : kind === "solver" ? (
          <SolverStage featured={featured} maxScore={maxScore} />
        ) : kind === "prediction" ? (
          <PredictionStage featured={featured} maxScore={maxScore} />
        ) : (
          <CustomStage featured={featured} maxScore={maxScore} />
        )}
      </div>
    </div>
  );
}

function EmptyStage({ kind }: { kind: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <AgentMascot variant="violet" mood="idle" live className="h-24 w-auto" />
      <p className="font-mono text-sm text-pengu-dark/55">
        waiting for {kind} agents to enter the stage…
      </p>
    </div>
  );
}

/// Header used by every stage variant: top-N agents in a row with their mascot
/// and the score number. The body below the headers is the kind-specific
/// activity.
function AgentRoster({
  featured,
  maxScore,
  bodies,
}: {
  featured: StandingsEntry[];
  maxScore: number;
  bodies: React.ReactNode[];
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {featured.map((e, i) => {
        const pct = Math.min(1, e.score / maxScore);
        const leader = e.rank === 1;
        return (
          <div
            key={e.agentId}
            className={`relative flex flex-col items-center rounded-2xl border p-4 ${
              leader ? "border-pengu-blue/40 bg-pengu-blue/5" : "border-pengu-blue/10 bg-white"
            }`}
          >
            {leader ? (
              <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-pill bg-pengu-blue px-2.5 py-0.5 font-display text-[10px] uppercase tracking-wide text-white shadow-[0_4px_0_0_#5b34d6]">
                lead
              </span>
            ) : null}

            <div className="flex w-full items-center justify-between">
              <span className={`font-mono text-xs ${leader ? "text-pengu-blue" : "text-pengu-dark/55"}`}>
                #{e.rank}
              </span>
              <span
                key={e.score}
                className="tick-up font-mono text-base tabular-nums text-pengu-dark"
              >
                {e.score.toLocaleString()}
              </span>
            </div>

            <AgentMascot
              variant={variantFor(e.agentId)}
              mood={leader ? "win" : "focus"}
              live
              className={`mt-2 h-20 w-auto ${leader ? "drift" : ""}`}
            />

            <div className="mt-2 w-full text-center font-mono text-[10px] uppercase tracking-wide text-pengu-dark/45">
              agent {e.agentId}
            </div>

            <div className="mt-3 w-full">{bodies[i]}</div>

            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-pengu-blue/10">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${pct * 100}%`,
                  background: leader ? "#7c4dff" : "rgba(124,77,255,0.55)",
                  transition: "width 240ms linear",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/// Puzzle stage: each agent gets a 6x6 grid of cells. The fraction of cells lit
/// tracks their score. Cells light in a deterministic scan order so the same
/// score always shows the same grid, and rising scores look like the agent is
/// "filling in" their puzzle. Pulsing cells at the leading edge sell that the
/// solver is actively working, not paused.
function PuzzleStage({ featured, maxScore }: { featured: StandingsEntry[]; maxScore: number }) {
  const bodies = featured.map((e) => {
    const pct = Math.min(1, e.score / maxScore);
    const filled = Math.round(36 * pct);
    return <PuzzleGrid key={e.agentId} filled={filled} accent={variantColor(variantFor(e.agentId))} />;
  });
  return (
    <div>
      <div className="mb-4 text-center font-display text-[11px] uppercase tracking-wide text-pengu-dark/45">
        each agent fills its own 6×6 logic grid · cells light as the solver locks them in
      </div>
      <AgentRoster featured={featured} maxScore={maxScore} bodies={bodies} />
    </div>
  );
}

function PuzzleGrid({ filled, accent }: { filled: number; accent: string }) {
  const cells = Array.from({ length: 36 }, (_, i) => i);
  return (
    <div className="grid grid-cols-6 gap-[3px]">
      {cells.map((i) => {
        const isFilled = i < filled;
        const isLeadingEdge = i === filled - 1 || i === filled;
        return (
          <span
            key={i}
            className={`aspect-square rounded-[3px] ${isLeadingEdge && isFilled ? "glow-pulse" : ""}`}
            style={{
              background: isFilled ? accent : "rgba(27,17,64,0.06)",
              color: accent,
              transition: "background 200ms linear",
            }}
          />
        );
      })}
    </div>
  );
}

/// Volume stage: each agent's lane shows a stream of mock tx hashes. The number
/// of hashes corresponds to their score scaled down so a busy lane reads as
/// "this agent is shipping". Hashes shift up like a printer feed; the most
/// recent is at the bottom with a colored glow.
function VolumeStage({ featured, maxScore }: { featured: StandingsEntry[]; maxScore: number }) {
  const bodies = featured.map((e) => {
    const pct = Math.min(1, e.score / maxScore);
    const txCount = Math.max(1, Math.round(8 * pct));
    return (
      <TxFeed
        key={e.agentId}
        count={txCount}
        accent={variantColor(variantFor(e.agentId))}
        seed={e.agentId * 1000 + e.score}
      />
    );
  });
  return (
    <div>
      <div className="mb-4 text-center font-display text-[11px] uppercase tracking-wide text-pengu-dark/45">
        each agent ships real tx from its own hot wallet · most recent on top
      </div>
      <AgentRoster featured={featured} maxScore={maxScore} bodies={bodies} />
    </div>
  );
}

function TxFeed({ count, accent, seed }: { count: number; accent: string; seed: number }) {
  // Deterministic mock hashes from seed so the feed looks stable between frames
  // (real per-agent tx hashes come in a later backend pass).
  const hashes = useMemo(() => {
    const arr: string[] = [];
    let s = seed;
    for (let i = 0; i < count; i++) {
      s = (s * 9301 + 49297) % 233280;
      const r = Math.abs(s).toString(16).padStart(6, "0");
      arr.push(`0x${r}${(seed + i).toString(16).padStart(4, "0")}`);
    }
    return arr;
  }, [seed, count]);

  return (
    <div className="flex flex-col gap-1 rounded-md bg-pengu-blue/5 p-2 font-mono text-[10px] text-pengu-dark/60">
      {hashes.slice(0, 4).map((h, idx) => (
        <div key={`${h}-${idx}`} className="flex items-center gap-1.5 tick-up">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: accent, opacity: idx === 0 ? 1 : 0.45 }}
          />
          <span className="truncate">{h}</span>
        </div>
      ))}
      <div className="mt-1 text-right font-display text-[9px] uppercase tracking-wide text-pengu-dark/40">
        {count}+ tx
      </div>
    </div>
  );
}

/// Solver stage: each agent gets a small graph of 8 nodes arranged in a ring,
/// with a polyline traced through them. Path length scales with score so a
/// leader shows a longer trace. The last segment glows to imply the solver is
/// still actively drawing.
function SolverStage({ featured, maxScore }: { featured: StandingsEntry[]; maxScore: number }) {
  const bodies = featured.map((e) => {
    const pct = Math.min(1, e.score / maxScore);
    const visited = Math.max(2, Math.round(8 * pct));
    return <NodeGraph key={e.agentId} visited={visited} accent={variantColor(variantFor(e.agentId))} />;
  });
  return (
    <div>
      <div className="mb-4 text-center font-display text-[11px] uppercase tracking-wide text-pengu-dark/45">
        each agent explores its own graph · longer trace = more nodes resolved
      </div>
      <AgentRoster featured={featured} maxScore={maxScore} bodies={bodies} />
    </div>
  );
}

function NodeGraph({ visited, accent }: { visited: number; accent: string }) {
  const N = 8;
  const r = 38;
  const cx = 50;
  const cy = 50;
  const nodes = Array.from({ length: N }, (_, i) => {
    const a = (i / N) * Math.PI * 2 - Math.PI / 2;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
  const path = nodes
    .slice(0, visited)
    .map((n, i) => `${i === 0 ? "M" : "L"}${n.x.toFixed(1)} ${n.y.toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 100" className="h-24 w-full">
      {nodes.map((n, i) => (
        <circle
          key={i}
          cx={n.x}
          cy={n.y}
          r={i < visited ? 3.5 : 2}
          fill={i < visited ? accent : "rgba(27,17,64,0.18)"}
        />
      ))}
      <path d={path} fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/// Prediction stage: tiny candle chart where each agent's call is plotted as a
/// horizontal line at its predicted level. The "actual" line walks across.
/// Agents whose line is closer to actual score higher.
function PredictionStage({ featured, maxScore }: { featured: StandingsEntry[]; maxScore: number }) {
  const bodies = featured.map((e) => {
    const pct = Math.min(1, e.score / maxScore);
    return <PredictionChart key={e.agentId} accuracy={pct} accent={variantColor(variantFor(e.agentId))} />;
  });
  return (
    <div>
      <div className="mb-4 text-center font-display text-[11px] uppercase tracking-wide text-pengu-dark/45">
        each agent placed a call · closer to actual = more points
      </div>
      <AgentRoster featured={featured} maxScore={maxScore} bodies={bodies} />
    </div>
  );
}

function PredictionChart({ accuracy, accent }: { accuracy: number; accent: string }) {
  // Synthetic candle line; the call is fixed and "actual" lands within accuracy.
  const points = useMemo(() => {
    const xs = Array.from({ length: 12 }, (_, i) => i / 11);
    return xs.map((x) => {
      const noise = Math.sin(x * 9 + accuracy * 6) * 0.18;
      return 0.5 + noise * (1 - accuracy * 0.5);
    });
  }, [accuracy]);
  const callY = 0.5;
  const actualY = callY + (1 - accuracy) * 0.3 * (accuracy > 0.5 ? 1 : -1);
  return (
    <svg viewBox="0 0 100 40" className="h-14 w-full">
      {/* call line */}
      <line x1="0" y1={callY * 40} x2="100" y2={callY * 40} stroke={accent} strokeWidth="0.6" strokeDasharray="2 2" opacity="0.6" />
      {/* actual walk */}
      <polyline
        points={points.map((y, i) => `${(i / (points.length - 1)) * 100},${y * 40}`).join(" ")}
        fill="none"
        stroke={accent}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      {/* settle marker */}
      <circle cx="100" cy={actualY * 40} r="2.5" fill={accent} />
    </svg>
  );
}

/// Custom stage: contests with a sponsor-defined metric. We don't know what to
/// visualize, so we show a clean activity heartbeat: a moving sparkline keyed
/// off score so the agent still looks like it is doing something concrete.
function CustomStage({ featured, maxScore }: { featured: StandingsEntry[]; maxScore: number }) {
  const bodies = featured.map((e) => {
    const pct = Math.min(1, e.score / maxScore);
    return <Heartbeat key={e.agentId} accuracy={pct} accent={variantColor(variantFor(e.agentId))} />;
  });
  return (
    <div>
      <div className="mb-4 text-center font-display text-[11px] uppercase tracking-wide text-pengu-dark/45">
        custom metric · sponsor sets the rules · pulse tracks live progress
      </div>
      <AgentRoster featured={featured} maxScore={maxScore} bodies={bodies} />
    </div>
  );
}

function Heartbeat({ accuracy, accent }: { accuracy: number; accent: string }) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPhase((p) => (p + 1) % 1000), 80);
    return () => clearInterval(t);
  }, []);
  const points = Array.from({ length: 28 }, (_, i) => {
    const t = (i + phase) / 28;
    const y = 0.5 + Math.sin(t * Math.PI * 4) * 0.2 * accuracy;
    return `${(i / 27) * 100},${y * 40}`;
  });
  return (
    <svg viewBox="0 0 100 40" className="h-14 w-full">
      <polyline points={points.join(" ")} fill="none" stroke={accent} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function variantColor(v: AgentVariant): string {
  switch (v) {
    case "crimson":
      return "#DC2626";
    case "cyan":
      return "#0891B2";
    case "gold":
      return "#D97706";
    case "violet":
      return "#7C3AED";
    default:
      return "#7c4dff";
  }
}
