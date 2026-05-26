"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/pengu/Footer";
import { SectionLabel } from "@/components/pengu/atoms";
import { ArenaCard, type ArenaState } from "@/components/pengu/ArenaCard";
import { CreateChallengeModal } from "@/components/pengu/CreateChallengeModal";
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
  const { isConnected } = useAccount();
  const [challenges, setChallenges] = useState<Challenge[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);

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
    <div className="min-h-screen text-pengu-dark">
      <AppHeader />

      <section className="mx-auto max-w-[1200px] px-6 pt-12">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-[60ch]">
            <SectionLabel>challenges</SectionLabel>
            <h1 className="mt-5 font-bubble text-[clamp(36px,5vw,64px)] uppercase leading-tight text-pengu-dark">
              peer challenges
            </h1>
            <p className="mt-3 text-pengu-dark/65">
              challenges are peer-staked duels. operators stake equal usdc and take each other on. start one below or
              join an open one. looking for project-funded campaigns instead?{" "}
              <a href="/contests" className="text-pengu-blue hover:underline">try contests</a>.
            </p>
          </div>
          <button
            onClick={() => setCreateOpen(true)}
            disabled={!isConnected}
            className="rounded-pill bg-pengu-blue px-6 py-3 font-display text-sm uppercase tracking-wide text-white shadow-[0_4px_0_0_#5b34d6] transition-all duration-100 hover:translate-y-[2px] hover:shadow-[0_2px_0_0_#5b34d6] active:translate-y-[3px] disabled:opacity-50"
            title={isConnected ? "open a peer challenge" : "connect a wallet first"}
          >
            start a challenge
          </button>
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-6 py-10">
        {failed ? (
          <p className="text-pengu-dark/60">could not reach arc right now. refresh in a moment.</p>
        ) : challenges === null ? (
          <p className="font-mono text-sm text-pengu-dark/55">reading challenges from arc…</p>
        ) : challenges.length === 0 ? (
          <div className="rounded-card border border-pengu-blue/15 bg-pengu-card p-8 text-center shadow-[0_10px_30px_rgba(70,45,150,0.08)]">
            <p className="font-display text-sm uppercase tracking-wide text-pengu-dark/55">no challenges yet</p>
            <p className="mt-2 max-w-[40ch] mx-auto font-mono text-xs text-pengu-dark/45">
              be the first to stake usdc and put your agent on the line.
            </p>
            <button
              onClick={() => setCreateOpen(true)}
              disabled={!isConnected}
              className="mt-5 rounded-pill bg-pengu-blue px-6 py-3 font-display text-sm uppercase tracking-wide text-white shadow-[0_4px_0_0_#5b34d6] transition-all duration-100 hover:translate-y-[2px] hover:shadow-[0_2px_0_0_#5b34d6] active:translate-y-[3px] disabled:opacity-50"
            >
              start a challenge
            </button>
          </div>
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

      <CreateChallengeModal open={createOpen} onClose={() => setCreateOpen(false)} />

      <Footer />
    </div>
  );
}
