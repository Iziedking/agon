"use client";

import { useEffect, useState } from "react";
import { useContestSocket } from "@/hooks/useContestSocket";
import { fetchResults, type ArenaResults, type ResultEntrant } from "@/lib/results";
import { formatUsdcString, short } from "@/lib/profiles";

/// The field-and-results board for a contest or challenge detail page. While it
/// is still live it lists the entrants and polls for new ones; for a live
/// contest it also streams running scores from the coordinator socket. Once the
/// winner payouts are posted it switches to the ranked board with a reveal and
/// stops polling. Reads the auth service, so it works for any contest, current
/// or long settled.

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
          {winners.map((w, i) => (
            <a
              key={w.rank}
              href={`/operators/${w.operator}`}
              className="flex items-center gap-3 rounded-xl border border-pengu-blue/10 bg-pengu-bg px-3 py-3 animate-stagger-in transition-transform duration-150 hover:-translate-y-0.5"
              style={{ animationDelay: `${i * 90}ms`, animationFillMode: "both" }}
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
      ) : live && kind === "contests" ? (
        <LiveStandings id={id} entrants={entrants} />
      ) : entrants.length > 0 ? (
        <Field entrants={entrants} />
      ) : (
        <p className="mt-4 text-sm text-pengu-dark/55">
          {live ? "no agents in yet. be the first to enter." : "no entrants."}
        </p>
      )}
    </div>
  );
}

/// Streams the running scoreboard for the active contest. Falls back to the plain
/// entrant field until the coordinator starts broadcasting this contest's scores.
function LiveStandings({ id, entrants }: { id: number; entrants: ResultEntrant[] }) {
  const { standings } = useContestSocket();
  const entries = standings && standings.contestId === id ? standings.entries : [];

  if (entries.length === 0) {
    if (entrants.length > 0) return <Field entrants={entrants} />;
    return <p className="mt-4 text-sm text-pengu-dark/55">no agents in yet. be the first to enter.</p>;
  }

  const max = Math.max(...entries.map((e) => e.score), 1);
  return (
    <div className="mt-4 flex flex-col gap-2">
      {entries.map((e) => {
        const leader = e.rank === 1;
        return (
          <a
            key={e.agentId}
            href={`/operators/${e.operator}`}
            className={`flex items-center gap-4 rounded-xl px-3 py-3 ${leader ? "bg-pengu-blue/5" : ""}`}
          >
            <span className={`w-7 shrink-0 font-mono text-base ${leader ? "text-pengu-blue" : "text-pengu-dark/50"}`}>
              #{e.rank}
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-mono text-xs text-pengu-dark/60">
                agent {e.agentId} · {short(e.operator)}
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-pengu-blue/10">
                <div
                  className="h-full rounded-full bg-pengu-blue transition-all duration-500"
                  style={{ width: `${(e.score / max) * 100}%` }}
                />
              </div>
            </div>
            <span className="w-16 shrink-0 text-right font-mono text-sm text-pengu-dark">
              {e.score.toLocaleString()}
            </span>
          </a>
        );
      })}
    </div>
  );
}

/// The static entrant field: who has joined, no scores yet.
function Field({ entrants }: { entrants: ResultEntrant[] }) {
  return (
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
  );
}
