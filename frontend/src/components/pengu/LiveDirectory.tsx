"use client";

import { useEffect, useMemo, useState } from "react";
import { EventCard, type EventTypeLabel } from "@/components/pengu/EventCard";
import { useContestSocket } from "@/hooks/useContestSocket";
import { fetchContests, formatUsdc, CONTEST_TYPE, type Contest } from "@/lib/contests";
import { fetchChallenges, CHALLENGE_KIND, type Challenge } from "@/lib/challenges";

/// The /live directory body. Polls chain every 15s for active contests and
/// challenges, renders each as a small EventCard, and pulses the cards whose
/// id matches the current coordinator broadcast so viewers can see which one
/// is mid-stream right now. Anyone can watch; no auth, no wallet required.

function contestType(c: Contest): EventTypeLabel {
  const name = (CONTEST_TYPE[c.contestType] ?? "").toLowerCase();
  if (name === "scout") return "scout";
  if (name === "analyst") return "analyst";
  if (name === "solver") return "solver";
  return "custom";
}

function challengeType(c: Challenge): EventTypeLabel {
  const name = (CHALLENGE_KIND[c.kind] ?? "").toLowerCase();
  if (name === "prediction") return "prediction";
  if (name === "puzzle") return "puzzle";
  if (name === "volume") return "volume";
  return "custom";
}

function challengeStatusLabel(c: Challenge): "open" | "locked" {
  return c.status === 0 ? "open" : "locked";
}

function contestStatusLabel(c: Contest): "open" | "scoring" {
  return c.status === 1 ? "open" : "scoring";
}

export function LiveDirectory({
  initialContests,
  initialChallenges,
}: {
  initialContests: Contest[];
  initialChallenges: Challenge[];
}) {
  const [contests, setContests] = useState<Contest[]>(initialContests);
  const [challenges, setChallenges] = useState<Challenge[]>(initialChallenges);
  const { connected, standings, challengeStandings } = useContestSocket();

  useEffect(() => {
    let stopped = false;
    async function load() {
      try {
        const [cs, chs] = await Promise.all([fetchContests(), fetchChallenges()]);
        if (stopped) return;
        setContests(cs);
        setChallenges(chs);
      } catch {
        // chain blip; keep what we have, next tick will retry
      }
    }
    const t = setInterval(load, 15000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);

  const activeContests = useMemo(
    () => contests.filter((c) => c.status === 1 || c.status === 2),
    [contests],
  );
  const activeChallenges = useMemo(
    () => challenges.filter((c) => c.status === 0 || c.status === 1),
    [challenges],
  );

  const liveContestId = standings && standings.entries.length > 0 ? standings.contestId : null;
  const liveChallengeId = challengeStandings && challengeStandings.entries.length > 0 ? challengeStandings.challengeId : null;

  const totalActive = activeContests.length + activeChallenges.length;

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="inline-flex items-center gap-2 font-display text-xs uppercase tracking-wide text-pengu-blue">
          <span className={`h-2 w-2 rounded-full ${connected ? "animate-pulse-live bg-[#22c55e]" : "bg-pengu-dark/30"}`} />
          {connected ? "feed connected" : "feed offline"}
        </span>
        <span className="font-mono text-xs text-pengu-dark/55">
          {totalActive} {totalActive === 1 ? "event" : "events"} live · click any card to watch
        </span>
      </div>

      {totalActive === 0 ? (
        <div className="mt-6 rounded-card border border-pengu-blue/15 bg-white p-8 text-center shadow-[0_10px_30px_rgba(70,45,150,0.08)]">
          <p className="font-display text-sm uppercase tracking-wide text-pengu-dark/55">
            no events live right now
          </p>
          <p className="mt-2 font-mono text-xs text-pengu-dark/45">
            the autopilot opens a fresh contest every couple of minutes. check back, or host your own challenge.
          </p>
        </div>
      ) : null}

      {activeContests.length > 0 ? (
        <section className="mt-8">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-display text-base uppercase tracking-wide text-pengu-dark">
              contests · {activeContests.length}
            </h2>
            <span className="font-mono text-[11px] text-pengu-dark/45">project-funded pools</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {activeContests.map((c) => (
              <EventCard
                key={`c-${c.id}`}
                kind="contest"
                href={`/contests/${c.id}`}
                id={c.id}
                type={contestType(c)}
                status={contestStatusLabel(c)}
                poolLabel="prize pool"
                pool={formatUsdc(c.prizePool)}
                entrants={String(c.entrants)}
                endSec={Number(c.endTime) || null}
                liveBroadcast={liveContestId === c.id}
              />
            ))}
          </div>
        </section>
      ) : null}

      {activeChallenges.length > 0 ? (
        <section className="mt-10">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-display text-base uppercase tracking-wide text-pengu-dark">
              challenges · {activeChallenges.length}
            </h2>
            <span className="font-mono text-[11px] text-pengu-dark/45">peer-staked, winner takes the pot</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {activeChallenges.map((c) => {
              const pot = c.stake * BigInt(Math.max(c.entrants, 1));
              const endSec = c.status === 0 ? Number(c.joinDeadline) : Number(c.resolveDeadline);
              return (
                <EventCard
                  key={`ch-${c.id}`}
                  kind="challenge"
                  href={`/challenges/${c.id}`}
                  id={c.id}
                  type={challengeType(c)}
                  status={challengeStatusLabel(c)}
                  poolLabel={c.status === 0 ? "stake to enter" : "pot so far"}
                  pool={`${(Number(c.status === 0 ? c.stake : pot) / 1e6).toFixed(2)} USDC`}
                  entrants={`${c.entrants}/${c.maxEntrants}`}
                  endSec={endSec || null}
                  liveBroadcast={liveChallengeId === c.id}
                />
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
