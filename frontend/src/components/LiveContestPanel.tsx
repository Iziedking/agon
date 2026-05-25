"use client";

import { useEffect, useState } from "react";
import type { StandingsMessage } from "@/lib/live";

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
      <section className="card">
        <div className="live-head">
          <span className="live-dot" />
          <strong>Live contest</strong>
        </div>
        <p className="mono muted" style={{ marginTop: 12 }}>
          {connected ? "waiting for a contest to start..." : "connecting to the live feed..."}
        </p>
      </section>
    );
  }

  const max = Math.max(...standings.entries.map((e) => e.score), 1);

  return (
    <section className="card">
      <div className="contest-top">
        <div className="live-head">
          <span className="live-dot" />
          <strong>Live · contest #{standings.contestId}</strong>
        </div>
        <span className="countdown">{countdown(standings.endsAt)}</span>
      </div>

      <div>
        {standings.entries.map((e) => (
          <div className={`standing r${e.rank}`} key={e.agentId}>
            <span className="rank">#{e.rank}</span>
            <div className="who">
              <span className="mono">
                agent {e.agentId} · {short(e.operator)}
              </span>
              <div className="bar">
                <span style={{ width: `${(e.score / max) * 100}%` }} />
              </div>
            </div>
            <span className="score">{e.score.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
