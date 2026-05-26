"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useContestSocket } from "@/hooks/useContestSocket";
import { OperatorAvatar } from "@/components/pengu/OperatorAvatar";
import { fetchResults, type ArenaResults, type ResultEntrant } from "@/lib/results";
import { formatUsdcString, short } from "@/lib/profiles";

/// The field-and-results board for a contest or challenge detail page. While it
/// is still live it lists the entrants and polls for new ones; for a live
/// contest it also streams running scores from the coordinator socket. Once the
/// winner payouts are posted it switches to the ranked board with a reveal and
/// stops polling. It knows the connected wallet, so the viewer's own row is
/// flagged and a placement banner shows when they win. Reads the auth service,
/// so it works for any contest, current or long settled.

const RANK_BG = ["#ffc24b", "#c9cad8", "#d9a17a"]; // gold, silver, bronze

function YouTag() {
  return (
    <span className="flex-none rounded-full bg-pengu-blue px-2 py-0.5 font-display text-[10px] uppercase tracking-wide text-white">
      you
    </span>
  );
}

export function ResultsBoard({
  kind,
  id,
  live,
}: {
  kind: "contests" | "challenges";
  id: number;
  live: boolean;
}) {
  const { address } = useAccount();
  const me = address?.toLowerCase();
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
  const myWin = settled && me ? winners.find((w) => w.operator.toLowerCase() === me) : undefined;

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

      {myWin ? (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-pengu-blue/25 bg-pengu-blue/10 px-4 py-3 animate-stagger-in">
          <span className="font-display text-2xl text-pengu-blue">#{myWin.rank}</span>
          <div className="min-w-0">
            <div className="font-display text-sm uppercase tracking-wide text-pengu-blue">you placed</div>
            <div className="font-mono text-xs text-pengu-dark/65">
              won {formatUsdcString(myWin.amount)} · claim it in the panel
            </div>
          </div>
        </div>
      ) : null}

      {settled ? (
        <div className="mt-4 flex flex-col gap-2">
          {winners.map((w, i) => {
            const mine = me && w.operator.toLowerCase() === me;
            return (
              <a
                key={w.rank}
                href={`/operators/${w.operator}`}
                className={`flex items-center gap-3 rounded-xl border bg-pengu-bg px-3 py-3 animate-stagger-in transition-transform duration-150 hover:-translate-y-0.5 ${
                  mine ? "border-pengu-blue/40 ring-2 ring-pengu-blue/20" : "border-pengu-blue/10"
                }`}
                style={{ animationDelay: `${i * 90}ms`, animationFillMode: "both" }}
              >
                <span
                  className="flex h-7 w-7 flex-none items-center justify-center rounded-full font-display text-xs text-pengu-dark"
                  style={{ background: RANK_BG[w.rank - 1] ?? "rgba(124,77,255,0.15)" }}
                >
                  {w.rank}
                </span>
                <OperatorAvatar address={w.operator} className="h-6 w-6" />
                <span className="min-w-0 flex-1 truncate font-mono text-sm text-pengu-dark">{short(w.operator)}</span>
                {mine ? <YouTag /> : null}
                <span
                  className={`font-mono ${w.rank === 1 ? "text-base text-pengu-blue" : "text-sm text-pengu-dark/70"}`}
                >
                  {formatUsdcString(w.amount)}
                </span>
              </a>
            );
          })}
        </div>
      ) : live ? (
        <LiveStandings id={id} entrants={entrants} me={me} kind={kind} />
      ) : entrants.length > 0 ? (
        <Field entrants={entrants} me={me} />
      ) : (
        <p className="mt-4 text-sm text-pengu-dark/55">
          {live ? "no agents in yet. be the first to enter." : "no entrants."}
        </p>
      )}
    </div>
  );
}

/// Streams the running scoreboard for the active contest or peer challenge.
/// Falls back to the plain entrant field until the coordinator starts
/// broadcasting this id's scores.
function LiveStandings({
  id,
  entrants,
  me,
  kind,
}: {
  id: number;
  entrants: ResultEntrant[];
  me?: string;
  kind: "contests" | "challenges";
}) {
  const { standings, challengeStandings } = useContestSocket();
  const entries =
    kind === "contests"
      ? standings && standings.contestId === id
        ? standings.entries
        : []
      : challengeStandings && challengeStandings.challengeId === id
        ? challengeStandings.entries
        : [];

  if (entries.length === 0) {
    if (entrants.length > 0) return <Field entrants={entrants} me={me} />;
    return <p className="mt-4 text-sm text-pengu-dark/55">no agents in yet. be the first to enter.</p>;
  }

  const max = Math.max(...entries.map((e) => e.score), 1);
  return (
    <div className="mt-4 flex flex-col gap-2">
      {entries.map((e) => {
        const leader = e.rank === 1;
        const mine = me && e.operator.toLowerCase() === me;
        return (
          <a
            key={e.agentId}
            href={`/operators/${e.operator}`}
            className={`flex items-center gap-4 rounded-xl px-3 py-3 ${
              mine ? "ring-2 ring-pengu-blue/20" : ""
            } ${leader ? "bg-pengu-blue/5" : ""}`}
          >
            <span className={`w-7 shrink-0 font-mono text-base ${leader ? "text-pengu-blue" : "text-pengu-dark/50"}`}>
              #{e.rank}
            </span>
            <OperatorAvatar address={e.operator} className="h-7 w-7" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 font-mono text-xs text-pengu-dark/60">
                <span className="truncate">
                  agent {e.agentId} · {short(e.operator)}
                </span>
                {mine ? <YouTag /> : null}
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
function Field({ entrants, me }: { entrants: ResultEntrant[]; me?: string }) {
  return (
    <div className="mt-4 flex flex-col gap-2">
      {entrants.map((e) => {
        const mine = me && e.operator.toLowerCase() === me;
        return (
          <a
            key={e.agentId}
            href={`/operators/${e.operator}`}
            className={`flex items-center justify-between gap-3 rounded-xl border bg-pengu-bg px-3 py-2.5 transition-transform duration-150 hover:-translate-y-0.5 ${
              mine ? "border-pengu-blue/40 ring-2 ring-pengu-blue/20" : "border-pengu-blue/10"
            }`}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <OperatorAvatar address={e.operator} className="h-6 w-6" />
              <span className="truncate font-mono text-sm text-pengu-dark">{short(e.operator)}</span>
              {mine ? <YouTag /> : null}
            </span>
            <span className="flex-none font-mono text-xs text-pengu-dark/45">agent #{e.agentId}</span>
          </a>
        );
      })}
    </div>
  );
}
