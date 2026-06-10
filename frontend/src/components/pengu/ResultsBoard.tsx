"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useContestSocket } from "@/hooks/useContestSocket";
import { useAgentNames, nameFor } from "@/hooks/useAgentNames";
import { OperatorAvatar } from "@/components/pengu/OperatorAvatar";
import { ContestStage } from "@/components/pengu/ContestStage";
import { BracketedCell, StatusChip } from "@/components/redesign";
import { fetchResults, type ArenaResults, type ResultEntrant } from "@/lib/results";
import { formatUsdcString, short } from "@/lib/profiles";

/// The field-and-results board for a contest or challenge detail page. While it
/// is still live it lists the entrants and polls for new ones; for a live
/// contest it also streams running scores from the coordinator socket. Once the
/// winner payouts are posted it switches to the ranked board with a reveal and
/// stops polling. It knows the connected wallet, so the viewer's own row is
/// flagged and a placement banner shows when they win. Reads the auth service,
/// so it works for any contest, current or long settled.

// Stencil rank color: flat ink, pink only marks #1 (one accent per row).
function rankColor(rank: number): string {
  if (rank === 1) return "var(--accent)";
  return "var(--ink)";
}

function YouTag() {
  return (
    <span
      className="flex-none border border-ink bg-canvas px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink"
    >
      YOU
    </span>
  );
}

export function ResultsBoard({
  kind,
  id,
  live,
  contestType,
}: {
  kind: "contests" | "challenges";
  id: number;
  live: boolean;
  /// Optional stage hint. Contests carry their type on the broadcast; challenges
  /// don't, so the parent page passes the challenge kind label here so the stage
  /// can pick the right visualization.
  contestType?: string;
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
    <BracketedCell pad="md">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
          <span aria-hidden className="text-accent">■</span> {settled ? "RESULTS" : "IN THE ARENA"}
        </span>
        {settled ? (
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">SETTLED ONCHAIN</span>
        ) : live ? (
          <StatusChip tone="ok">LIVE</StatusChip>
        ) : null}
      </div>

      {myWin ? (
        <div className="mt-4 flex items-center gap-4 border border-ink bg-canvas px-4 py-3">
          <span
            className="font-stencil"
            style={{ fontSize: 28, lineHeight: 1, letterSpacing: "-0.01em", color: rankColor(myWin.rank) }}
          >
            #{myWin.rank}
          </span>
          <div className="min-w-0">
            <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">YOU PLACED</div>
            <div className="mt-0.5 font-mono text-[12px] text-ink-2">
              won {formatUsdcString(myWin.amount)} · claim it in the panel
            </div>
          </div>
        </div>
      ) : null}

      {settled ? (
        <div className="mt-4 flex flex-col">
          {winners.map((w) => {
            const mine = me && w.operator.toLowerCase() === me;
            return (
              <a
                key={w.rank}
                href={`/operators/${w.operator}`}
                className={`grid grid-cols-[3rem_auto_1fr_auto_auto] items-center gap-3 border-b border-[color:var(--hairline)] py-3 last:border-0 transition-colors hover:bg-canvas-2 ${
                  mine ? "bg-canvas-2" : ""
                }`}
              >
                <span
                  className="font-stencil"
                  style={{ fontSize: 22, lineHeight: 1, letterSpacing: "-0.01em", color: rankColor(w.rank) }}
                >
                  #{w.rank}
                </span>
                <OperatorAvatar address={w.operator} className="h-6 w-6" />
                <span className="min-w-0 truncate font-mono text-[12px] text-ink">{short(w.operator)}</span>
                {mine ? <YouTag /> : <span />}
                <span
                  className={`font-mono ${w.rank === 1 ? "text-[14px] text-accent" : "text-[12px] text-ink-2"}`}
                >
                  {formatUsdcString(w.amount)}
                </span>
              </a>
            );
          })}
        </div>
      ) : live ? (
        <LiveStandings id={id} entrants={entrants} me={me} kind={kind} contestType={contestType} />
      ) : entrants.length > 0 ? (
        <Field entrants={entrants} me={me} />
      ) : (
        <p className="mt-4 font-mono text-sm text-ink-2">
          {live ? "no agents in yet. be the first to enter." : "no entrants."}
        </p>
      )}
    </BracketedCell>
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
  contestType,
}: {
  id: number;
  entrants: ResultEntrant[];
  me?: string;
  kind: "contests" | "challenges";
  contestType?: string;
}) {
  const { standings, challengeStandings } = useContestSocket();
  const matchingStandings = standings && standings.contestId === id ? standings : null;
  const entries =
    kind === "contests"
      ? matchingStandings
        ? matchingStandings.entries
        : []
      : challengeStandings && challengeStandings.challengeId === id
        ? challengeStandings.entries
        : [];

  // Hook must run on every render: never conditional, never after an early
  // return. Keep it at the top so the hook count is stable across renders
  // (React error #310 otherwise).
  const names = useAgentNames(entries.map((e) => e.agentId));

  if (entries.length === 0) {
    if (entrants.length > 0) return <Field entrants={entrants} me={me} />;
    return <p className="mt-4 font-mono text-sm text-ink-2">no agents in yet. be the first to enter.</p>;
  }

  const max = Math.max(...entries.map((e) => e.score), 1);
  return (
    <div className="mt-4 flex flex-col gap-4">
      {/* visible competition stage above the standings bars, so the surface
          declares what the agents are actually doing. Contests get the type
          from the broadcast; challenges get it from the parent page (the
          challenge kind label like "PUZZLE" or "VOLUME"). */}
      <ContestStage
        contestType={matchingStandings?.contestType ?? contestType}
        entries={entries}
      />


      <div className="flex flex-col">
      {entries.map((e) => {
        const mine = me && e.operator.toLowerCase() === me;
        return (
          <a
            key={e.agentId}
            href={`/operators/${e.operator}`}
            className={`grid grid-cols-[2.5rem_auto_1fr_auto] items-center gap-4 border-b border-[color:var(--hairline)] px-1 py-3 last:border-0 transition-colors hover:bg-canvas-2 ${
              mine ? "bg-canvas-2" : ""
            }`}
          >
            <span
              className="font-stencil"
              style={{ fontSize: 18, lineHeight: 1, letterSpacing: "-0.01em", color: rankColor(e.rank) }}
            >
              #{e.rank}
            </span>
            <OperatorAvatar address={e.operator} className="h-6 w-6" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink">
                <span className="truncate">
                  {nameFor(names, e.agentId)} · {short(e.operator)}
                </span>
                {mine ? <YouTag /> : null}
              </div>
              <div className="mt-1.5 h-1.5 w-full border border-[color:var(--hairline-strong)] bg-canvas-2">
                <div
                  className="h-full bg-accent transition-all duration-500"
                  style={{ width: `${(e.score / max) * 100}%` }}
                />
              </div>
            </div>
            <span className="text-right font-mono text-[12px] tabular-nums text-ink">
              {e.score.toLocaleString()}
            </span>
          </a>
        );
      })}
      </div>
    </div>
  );
}

/// The static entrant field: who has joined, no scores yet. Looks up
/// nicknames so a renamed agent shows its name instead of the bare
/// "agent #17" id. Falls back to the id when no nickname is set.
function Field({ entrants, me }: { entrants: ResultEntrant[]; me?: string }) {
  const names = useAgentNames(entrants.map((e) => e.agentId));
  return (
    <div className="mt-4 flex flex-col">
      {entrants.map((e) => {
        const mine = me && e.operator.toLowerCase() === me;
        const display = nameFor(names, e.agentId);
        return (
          <a
            key={e.agentId}
            href={`/operators/${e.operator}`}
            className={`grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-[color:var(--hairline)] py-2.5 last:border-0 transition-colors hover:bg-canvas-2 ${
              mine ? "bg-canvas-2" : ""
            }`}
          >
            <OperatorAvatar address={e.operator} className="h-6 w-6" />
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-mono text-[12px] text-ink">{short(e.operator)}</span>
              {mine ? <YouTag /> : null}
            </span>
            <span className="truncate font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3" title={`agent #${e.agentId}`}>
              {display}
            </span>
          </a>
        );
      })}
    </div>
  );
}
