"use client";

import { useEffect, useState } from "react";
import { fetchResults, type ArenaResults } from "@/lib/results";
import { formatUsdcString, short } from "@/lib/profiles";

/// The field-and-results board for a contest or challenge detail page. While it
/// is still live it lists the entrants and polls for new ones; once the winner
/// payouts are posted it switches to the ranked board and stops polling. Reads
/// the auth service, so it works for any contest, current or long settled.

const RANK_BG = ["#ffc24b", "#c9cad8", "#d9a17a"]; // gold, silver, bronze

export function ResultsBoard({
  kind,
  id,
  live,
}: {
  kind: "contests" | "challenges";
  id: number;
  live: boolean;
}) {
  const [data, setData] = useState<ArenaResults | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    async function load() {
      const r = await fetchResults(kind, id);
      if (stopped) return;
      setData(r);
      // Winners posted means the board is final: stop polling.
      if (r.winners.length > 0 && timer) {
        clearInterval(timer);
        timer = undefined;
      }
    }

    load();
    if (live) timer = setInterval(load, 5000);
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
    };
  }, [kind, id, live]);

  const winners = data?.winners ?? [];
  const entrants = data?.entrants ?? [];
  const settled = winners.length > 0;

  return (
    <div className="rounded-card border border-pengu-blue/15 bg-white p-6 shadow-[0_10px_30px_rgba(70,45,150,0.08)]">
      <div className="flex items-center justify-between">
        <span className="font-display text-xs uppercase tracking-wide text-pengu-dark/45">
          {settled ? "results" : "in the arena"}
        </span>
        {settled ? (
          <span className="font-display text-xs uppercase tracking-wide text-pengu-dark/45">settled onchain</span>
        ) : live ? (
          <span className="flex items-center gap-1.5 font-display text-xs uppercase tracking-wide text-[#22c55e]">
            <span className="h-2 w-2 rounded-full bg-[#22c55e] animate-pulse-live" /> live
          </span>
        ) : null}
      </div>

      {settled ? (
        <div className="mt-4 flex flex-col gap-2">
          {winners.map((w) => (
            <a
              key={w.rank}
              href={`/operators/${w.operator}`}
              className="flex items-center gap-3 rounded-xl border border-pengu-blue/10 bg-pengu-bg px-3 py-3 transition-transform duration-150 hover:-translate-y-0.5"
            >
              <span
                className="flex h-7 w-7 flex-none items-center justify-center rounded-full font-display text-xs text-pengu-dark"
                style={{ background: RANK_BG[w.rank - 1] ?? "rgba(124,77,255,0.15)" }}
              >
                {w.rank}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-sm text-pengu-dark">{short(w.operator)}</span>
              <span
                className={`font-mono ${w.rank === 1 ? "text-base text-pengu-blue" : "text-sm text-pengu-dark/70"}`}
              >
                {formatUsdcString(w.amount)}
              </span>
            </a>
          ))}
        </div>
      ) : entrants.length > 0 ? (
        <div className="mt-4 flex flex-col gap-2">
          {entrants.map((e) => (
            <a
              key={e.agentId}
              href={`/operators/${e.operator}`}
              className="flex items-center justify-between rounded-xl border border-pengu-blue/10 bg-pengu-bg px-3 py-2.5 transition-transform duration-150 hover:-translate-y-0.5"
            >
              <span className="font-mono text-sm text-pengu-dark">{short(e.operator)}</span>
              <span className="font-mono text-xs text-pengu-dark/45">agent #{e.agentId}</span>
            </a>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-pengu-dark/55">
          {live ? "no agents in yet. be the first to enter." : "no entrants."}
        </p>
      )}
    </div>
  );
}
