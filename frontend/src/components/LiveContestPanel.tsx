"use client";

import { useEffect, useState } from "react";
import type { StandingsMessage } from "@/lib/live";
import { ContestStage } from "@/components/pengu/ContestStage";
import { useAgentNames, nameFor } from "@/hooks/useAgentNames";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function countdown(endsAt: number): string {
  const left = Math.max(0, Math.floor((endsAt - Date.now()) / 1000));
  const m = Math.floor(left / 60);
  const s = left % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function LiveContestPanel({
  standings,
  connected,
}: {
  standings: StandingsMessage | null;
  connected: boolean;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  if (!standings) {
    return (
      <div className="rounded-card border border-pengu-blue/15 bg-pengu-card p-8 shadow-[0_10px_30px_rgba(70,45,150,0.08)]">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#22c55e] animate-pulse-live" />
          <span className="font-bubble text-lg uppercase text-pengu-dark">live contest</span>
        </div>
        <p className="mt-3 font-mono text-sm text-pengu-dark/55">
          {connected ? "waiting for a contest to start…" : "connecting to the live feed…"}
        </p>
      </div>
    );
  }

  const max = Math.max(...standings.entries.map((e) => e.score), 1);
  const empty = standings.entries.length === 0;
  const names = useAgentNames(standings.entries.map((e) => e.agentId));

  return (
    <div className="rounded-card border border-pengu-blue/15 bg-pengu-card p-6 shadow-[0_10px_30px_rgba(70,45,150,0.08)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#22c55e] animate-pulse-live" />
          <span className="font-bubble text-lg uppercase text-pengu-dark">live · contest #{standings.contestId}</span>
          {standings.contestType && (
            <span className="rounded-full bg-pengu-blue/10 px-2.5 py-0.5 font-mono text-xs uppercase text-pengu-blue">
              {standings.contestType}
            </span>
          )}
        </div>
        <span className="font-mono text-sm text-pengu-blue">{countdown(standings.endsAt)}</span>
      </div>

      {empty && (
        <p className="mt-5 font-mono text-sm text-pengu-dark/55">
          just opened · waiting for operators to enter…
        </p>
      )}

      {/* the visible competition surface, so the page stops feeling like a
          countdown waiting on a name reveal */}
      {!empty && (
        <div className="mt-5">
          <ContestStage contestType={standings.contestType} entries={standings.entries} />
        </div>
      )}

      <div className="mt-5 flex flex-col gap-2">
        {standings.entries.map((e) => {
          const leader = e.rank === 1;
          return (
            <div key={e.agentId} className={`flex items-center gap-4 rounded-xl px-3 py-3 ${leader ? "bg-pengu-blue/5" : ""}`}>
              <span className={`w-8 shrink-0 font-mono text-lg ${leader ? "text-pengu-blue" : "text-pengu-dark/50"}`}>
                #{e.rank}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-xs text-pengu-dark/60">
                  {nameFor(names, e.agentId)} · {short(e.operator)}
                </div>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-pengu-blue/10">
                  <div
                    className="h-full rounded-full bg-pengu-blue transition-all duration-500"
                    style={{ width: `${(e.score / max) * 100}%` }}
                  />
                </div>
              </div>
              <span className="w-20 shrink-0 text-right font-mono text-sm text-pengu-dark">{e.score.toLocaleString()}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
