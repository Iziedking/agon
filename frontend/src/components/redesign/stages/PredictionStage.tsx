"use client";

import { useMemo } from "react";
import { BracketedCell, Robot, robotVariantForId } from "@/components/redesign";
import { nameFor, useAgentNames } from "@/hooks/useAgentNames";
import type { StandingsEntry } from "@/lib/live";

/// Promoted stage for ANALYST contests and PREDICTION challenges. Renders:
///   - A large probability chart (0..1 vertical, questions left→right). For
///     each question we draw the "outcome" edge (top = outcome 1, bottom = 0)
///     and overlay each agent's call as a colored dot connected to the edge.
///   - A per-agent calibration scorecard underneath: correct/total + which
///     question numbers they nailed.

const VARIANT_COLOR: Record<string, string> = {
  violet: "#7C5CFF",
  pink: "#FF3D8A",
  gold: "#D78A2B",
  mint: "#2BD4A3",
  crimson: "#E0345A",
};
const ERR = "#E0345A";

// Chart dimensions in viewBox units.
const CHART_W = 720;
const CHART_H = 200;
const PAD_X = 32;
const PAD_Y = 24;

export function PredictionStage({ entries }: { entries: StandingsEntry[] }) {
  const names = useAgentNames(entries.map((e) => e.agentId));

  // Aggregate the question count from whichever entry carries calls first.
  const totalQs = useMemo(() => {
    for (const e of entries) {
      if (e.progress?.kind === "analyst") return e.progress.calls.length;
    }
    return 0;
  }, [entries]);

  // Outcomes are identical across all agents; pull from the first analyst row.
  const outcomes = useMemo(() => {
    for (const e of entries) {
      if (e.progress?.kind === "analyst") return e.progress.calls.map((c) => c.outcome);
    }
    return [];
  }, [entries]);

  if (totalQs === 0) {
    return (
      <BracketedCell pad="sm">
        <p className="px-2 py-4 font-mono text-sm text-ink-2">
          waiting for the first prediction frame. analysts file their calls and the chart fills in.
        </p>
      </BracketedCell>
    );
  }

  const colW = (CHART_W - PAD_X * 2) / Math.max(1, totalQs);

  return (
    <div className="flex flex-col gap-5">
      {/* CHART */}
      <BracketedCell pad="sm">
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
          <span aria-hidden className="text-accent">■</span> CALL CHART
          <span className="ml-2 text-ink-3">· DOTS = AGENT CALLS · TOP = OUTCOME 1 · BOTTOM = OUTCOME 0</span>
        </div>
        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H + PAD_Y * 2}`}
          className="mt-3 h-[220px] w-full"
        >
          {/* 0 and 1 baselines */}
          <line
            x1={PAD_X}
            x2={CHART_W - PAD_X}
            y1={PAD_Y}
            y2={PAD_Y}
            stroke="var(--hairline-strong)"
            strokeWidth="0.5"
          />
          <line
            x1={PAD_X}
            x2={CHART_W - PAD_X}
            y1={PAD_Y + CHART_H}
            y2={PAD_Y + CHART_H}
            stroke="var(--hairline-strong)"
            strokeWidth="0.5"
          />
          {/* 0.5 reference dashed */}
          <line
            x1={PAD_X}
            x2={CHART_W - PAD_X}
            y1={PAD_Y + CHART_H / 2}
            y2={PAD_Y + CHART_H / 2}
            stroke="var(--ink-3)"
            strokeWidth="0.4"
            strokeDasharray="3 3"
          />
          <text x={PAD_X - 6} y={PAD_Y + 4} textAnchor="end" fontSize="9" fontFamily="monospace" fill="var(--ink-3)">1</text>
          <text x={PAD_X - 6} y={PAD_Y + CHART_H} textAnchor="end" fontSize="9" fontFamily="monospace" fill="var(--ink-3)">0</text>

          {/* Per-question column markers: an outcome circle at the right edge */}
          {outcomes.map((o, i) => {
            const x = PAD_X + colW * (i + 0.5);
            const y = o === 1 ? PAD_Y : PAD_Y + CHART_H;
            return (
              <g key={`outcome-${i}`}>
                <text
                  x={x}
                  y={PAD_Y + CHART_H + 16}
                  textAnchor="middle"
                  fontSize="8"
                  fontFamily="monospace"
                  fill="var(--ink-3)"
                >
                  Q{i + 1}
                </text>
                <circle cx={x} cy={y} r="3.5" fill="var(--ink)" />
              </g>
            );
          })}

          {/* Each agent's calls */}
          {entries.map((e) => {
            if (e.progress?.kind !== "analyst") return null;
            const variant = robotVariantForId(e.agentId);
            const accent = VARIANT_COLOR[variant]!;
            return (
              <g key={e.agentId}>
                {e.progress.calls.map((c, i) => {
                  const x = PAD_X + colW * (i + 0.5);
                  const yCall = PAD_Y + (1 - c.p) * CHART_H;
                  const yOutcome = c.outcome === 1 ? PAD_Y : PAD_Y + CHART_H;
                  const color = c.correct ? accent : ERR;
                  return (
                    <g key={i}>
                      <line
                        x1={x}
                        x2={x}
                        y1={yCall}
                        y2={yOutcome}
                        stroke={color}
                        strokeWidth="0.7"
                        opacity={0.5}
                      />
                      <circle cx={x} cy={yCall} r="2.5" fill={color} />
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </BracketedCell>

      {/* CALIBRATION SCORECARDS */}
      <BracketedCell pad="sm">
        <div className="flex flex-col">
          {entries.map((e) => {
            const variant = robotVariantForId(e.agentId);
            const accent = VARIANT_COLOR[variant]!;
            const analyst = e.progress?.kind === "analyst" ? e.progress : null;
            const correct = analyst?.calls.filter((c) => c.correct).length ?? 0;
            const total = analyst?.calls.length ?? 0;
            const correctIdx = analyst
              ? analyst.calls
                  .map((c, i) => ({ c, i }))
                  .filter(({ c }) => c.correct)
                  .map(({ i }) => `Q${i + 1}`)
                  .join(" ")
              : "";
            return (
              <div
                key={e.agentId}
                className="grid grid-cols-[2rem_auto_1fr_auto] items-center gap-4 border-b border-[color:var(--hairline)] py-3 last:border-0"
              >
                <span className={`font-stencil text-[16px] ${e.rank === 1 ? "text-accent" : "text-ink"}`}>
                  #{e.rank}
                </span>
                <div className="flex items-center gap-3">
                  <Robot variant={variant} size={28} decorative />
                  <div className="min-w-0">
                    <div className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink truncate">
                      {nameFor(names, e.agentId)}
                    </div>
                    <div className="font-mono text-[10px] text-ink-3">
                      {analyst ? `${correct}/${total} CORRECT` : "queued"}
                      {correctIdx ? ` · NAILED ${correctIdx}` : ""}
                    </div>
                  </div>
                </div>
                <div
                  className="h-2 border border-[color:var(--hairline-strong)] bg-canvas-2"
                  style={{ minWidth: 80 }}
                >
                  <div
                    className="h-full"
                    style={{
                      width: total > 0 ? `${(correct / total) * 100}%` : "0%",
                      background: accent,
                    }}
                  />
                </div>
                <span
                  key={e.score}
                  className="tick-up min-w-[64px] text-right font-mono text-[12px] tabular-nums text-ink"
                >
                  {Math.round(e.score).toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      </BracketedCell>
    </div>
  );
}
