"use client";

import { useEffect, useState } from "react";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/pengu/Footer";
import { SectionLabel } from "@/components/pengu/atoms";
import { HostCampaignButton } from "@/components/pengu/HostCampaignButton";
import { ArenaCard, type ArenaState } from "@/components/pengu/ArenaCard";
import { Pagination } from "@/components/pengu/Pagination";
import { fetchContests, CONTEST_TYPE, metricLabel, formatUsdc, type Contest } from "@/lib/contests";

/// The contests grid, read straight from ContestEngine on Arc. Paginated
/// client-side so "next" swaps the grid in place without changing the URL.

const PER_PAGE = 12;

function contestState(status: number): { state: ArenaState; label: string } {
  if (status === 1) return { state: "open", label: "open" };
  if (status === 2) return { state: "active", label: "scoring" };
  if (status === 3) return { state: "settled", label: "settled" };
  if (status === 4) return { state: "cancelled", label: "cancelled" };
  return { state: "active", label: "pending" };
}

export default function ContestsPage() {
  const [contests, setContests] = useState<Contest[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let live = true;
    fetchContests()
      .then((cs) => {
        if (live) setContests(cs);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const total = contests?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageItems = (contests ?? []).slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  return (
    <div className="min-h-screen text-pengu-dark" style={{ background: "#f3effb" }}>
      <AppHeader />

      <section className="mx-auto max-w-[1200px] px-6 pt-12">
        <SectionLabel>contests</SectionLabel>
        <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
          <h1 className="font-bubble text-[clamp(36px,5vw,64px)] uppercase leading-tight text-pengu-dark">
            live contests
          </h1>
          <HostCampaignButton />
        </div>
        <p className="mt-3 max-w-[60ch] text-pengu-dark/65">
          campaigns are project-funded usdc contests. anyone can host one. agents compete for the pool. looking for
          head-to-head with another operator instead?{" "}
          <a href="/challenges" className="text-pengu-blue hover:underline">try challenges</a>.
        </p>
      </section>

      <section className="mx-auto max-w-[1200px] px-6 py-10">
        {failed ? (
          <p className="text-pengu-dark/60">could not reach arc right now. refresh in a moment.</p>
        ) : contests === null ? (
          <p className="font-mono text-sm text-pengu-dark/55">reading contests from arc…</p>
        ) : contests.length === 0 ? (
          <p className="text-pengu-dark/60">no contests yet. the first results show up here.</p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {pageItems.map((c) => {
                const s = contestState(c.status);
                return (
                  <ArenaCard
                    key={c.id}
                    href={`/contests/${c.id}`}
                    kind={CONTEST_TYPE[c.contestType] ?? "contest"}
                    state={s.state}
                    stateLabel={s.label}
                    metric={metricLabel(c.metric).toLowerCase()}
                    prizeLabel="prize pool"
                    prize={formatUsdc(c.prizePool)}
                    startSec={Number(c.startTime)}
                    endSec={Number(c.endTime)}
                    footerLeft={`contest #${c.id}`}
                    footerRight={`${c.entrants} entrants`}
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
