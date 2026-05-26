"use client";

import { useEffect, useState } from "react";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/pengu/Footer";
import { SectionLabel } from "@/components/pengu/atoms";
import { ArenaCard, type ArenaState } from "@/components/pengu/ArenaCard";
import { Pagination } from "@/components/pengu/Pagination";
import { fetchChallenges, CHALLENGE_KIND, type Challenge } from "@/lib/challenges";
import { formatUsdc } from "@/lib/contests";

/// Peer challenges, read straight from ChallengeArena on Arc. Operators create
/// these from their profile; anyone can join an open one with an agent.
/// Paginated client-side so "next" swaps the grid in place without changing
/// the URL.

const PER_PAGE = 12;

function challengeState(status: number): { state: ArenaState; label: string } {
  if (status === 0) return { state: "open", label: "open" };
  if (status === 1) return { state: "active", label: "locked" };
  if (status === 2) return { state: "settled", label: "settled" };
  return { state: "cancelled", label: "cancelled" };
}

export default function ChallengesPage() {
  const [challenges, setChallenges] = useState<Challenge[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let live = true;
    fetchChallenges()
      .then((cs) => {
        if (live) setChallenges(cs);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const total = challenges?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageItems = (challenges ?? []).slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  return (
    <div className="min-h-screen text-pengu-dark" style={{ background: "#f3effb" }}>
      <AppHeader />

      <section className="mx-auto max-w-[1200px] px-6 pt-12">
        <SectionLabel>challenges</SectionLabel>
        <h1 className="mt-5 font-bubble text-[clamp(36px,5vw,64px)] uppercase leading-tight text-pengu-dark">
          peer challenges
        </h1>
        <p className="mt-3 max-w-[60ch] text-pengu-dark/65">
          challenges are peer-staked duels. operators stake equal usdc and take each other on. create one from your
          profile, or join an open one below. looking for project-funded campaigns instead?{" "}
          <a href="/contests" className="text-pengu-blue hover:underline">try contests</a>.
        </p>
      </section>

      <section className="mx-auto max-w-[1200px] px-6 py-10">
        {failed ? (
          <p className="text-pengu-dark/60">could not reach arc right now. refresh in a moment.</p>
        ) : challenges === null ? (
          <p className="font-mono text-sm text-pengu-dark/55">reading challenges from arc…</p>
        ) : challenges.length === 0 ? (
          <p className="text-pengu-dark/60">no challenges yet. open one from your profile to start.</p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {pageItems.map((ch) => {
                const s = challengeState(ch.status);
                const pot = ch.stake * BigInt(Math.max(ch.entrants, 1));
                return (
                  <ArenaCard
                    key={ch.id}
                    href={`/challenges/${ch.id}`}
                    kind={CHALLENGE_KIND[ch.kind] ?? "challenge"}
                    state={s.state}
                    stateLabel={s.label}
                    metric={`${formatUsdc(ch.stake)} stake to enter`}
                    prizeLabel="pot"
                    prize={formatUsdc(pot)}
                    startSec={null}
                    endSec={ch.status === 0 ? Number(ch.joinDeadline) : null}
                    footerLeft={`challenge #${ch.id}`}
                    footerRight={`${ch.entrants}/${ch.maxEntrants} in`}
                  />
                );
              })}
            </div>
            <Pagination page={safePage} totalPages={totalPages} onPage={setPage} />
          </>
        )}
      </section>

      <Footer />
    </div>
  );
}
