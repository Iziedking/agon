"use client";

import { useEffect, useState } from "react";
import { AgentAvatar, BracketedCell, robotVariantForId } from "@/components/redesign";
import { nameFor, skinFor, useAgentNames, useAgentSkins } from "@/hooks/useAgentNames";
import type { StandingsEntry } from "@/lib/live";

/// Promoted stage for CUSTOM challenges. No runner-supplied progress; we show
/// a large heartbeat sparkline (score-driven) per agent so the room reads
/// "alive" even without a specific visualization.

const VARIANT_COLOR: Record<string, string> = {
  violet: "#7C5CFF",
  pink: "#FF3D8A",
  gold: "#D78A2B",
  mint: "#2BD4A3",
  crimson: "#E0345A",
};

export function CustomStage({ entries }: { entries: StandingsEntry[] }) {
  const names = useAgentNames(entries.map((e) => e.agentId));
  const skins = useAgentSkins(entries.map((e) => e.agentId));
  const maxScore = Math.max(...entries.map((e) => e.score), 1);
  return (
    <BracketedCell pad="sm">
      <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
        <span aria-hidden className="text-accent">■</span> CUSTOM METRIC
        <span className="ml-2 text-ink-3">· SPONSOR-DEFINED · PULSE TRACKS LIVE SCORE</span>
      </div>
      <div className="mt-4 flex flex-col">
        {entries.map((e) => {
          const variant = robotVariantForId(e.agentId);
          const accent = VARIANT_COLOR[variant]!;
          const pct = Math.min(1, e.score / maxScore);
          return (
            <div
              key={e.agentId}
              className="grid grid-cols-[2rem_auto_1fr_auto] items-center gap-4 border-b border-[color:var(--hairline)] py-3 last:border-0"
            >
              <span className={`font-stencil text-[16px] ${e.rank === 1 ? "text-accent" : "text-ink"}`}>
                #{e.rank}
              </span>
              <div className="flex items-center gap-3">
                <AgentAvatar skin={skinFor(skins, e.agentId)} variant={variant} size={28} />
                <div className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink truncate">
                  {nameFor(names, e.agentId)}
                </div>
              </div>
              <Heartbeat accent={accent} amp={pct} />
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
  );
}

function Heartbeat({ accent, amp }: { accent: string; amp: number }) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPhase((p) => (p + 1) % 1000), 80);
    return () => clearInterval(t);
  }, []);
  const points = Array.from({ length: 32 }, (_, i) => {
    const t = (i + phase) / 32;
    const y = 0.5 + Math.sin(t * Math.PI * 4) * 0.25 * amp;
    return `${(i / 31) * 100},${y * 40}`;
  });
  return (
    <svg viewBox="0 0 100 40" className="h-12 w-full">
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={accent}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
