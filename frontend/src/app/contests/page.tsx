"use client";

import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import {
  BracketedCell,
  CornerMarkers,
  Countdown,
  MicroLabel,
  SectionHeader,
  StatusChip,
  TagButton,
} from "@/components/redesign";
import { HostCampaignButton } from "@/components/pengu/HostCampaignButton";
import { Pagination } from "@/components/pengu/Pagination";
import { fetchContests, CONTEST_TYPE, formatUsdc, metricLabel, type Contest } from "@/lib/contests";

/// /contests per arcrun-redesign §4.11. Hard-left section header with the
/// HOST A CAMPAIGN tag CTA in the right slot. Filters row above the grid
/// (ALL/VOLUME/PREDICTION/PUZZLE — active inverted to flat pink). 3-col
/// BracketedCell grid: ■ CAMPAIGN #N caps + StatusChip, stencil pool size,
/// mono metric/window/entries, READ TERMS + ENTER → tags at the bottom.

const PER_PAGE = 12;

type Filter = "ALL" | "VOLUME" | "PREDICTION" | "PUZZLE";

function contestTypeLabel(t: number): Filter {
  if (t === 0) return "VOLUME";
  if (t === 1) return "PREDICTION";
  if (t === 2) return "PUZZLE";
  return "VOLUME";
}

function statusChip(status: number) {
  if (status === 1) return { tone: "ok" as const, label: "OPEN" };
  if (status === 2) return { tone: "warn" as const, label: "SCORING" };
  if (status === 3) return { tone: "ink" as const, label: "SETTLED" };
  if (status === 4) return { tone: "err" as const, label: "CANCELLED" };
  return { tone: "ink" as const, label: "PENDING" };
}

function windowLabel(c: Contest): string {
  const start = Number(c.startTime);
  const end = Number(c.endTime);
  if (!end) return "—";
  const now = Math.floor(Date.now() / 1000);
  if (c.status === 1 && end > now) {
    const left = end - now;
    const h = Math.floor(left / 3600);
    const m = Math.floor((left % 3600) / 60);
    if (h > 0) return `${h}H ${m}M LEFT`;
    return `${m}M LEFT`;
  }
  if (c.status === 3 && start && end) {
    const hours = Math.round((end - start) / 3600);
    return `${hours}H WINDOW · SETTLED`;
  }
  return "WINDOW CLOSED";
}

export default function ContestsPage() {
  const [contests, setContests] = useState<Contest[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<Filter>("ALL");

  useEffect(() => {
    let live = true;
    fetchContests()
      .then((cs) => { if (live) setContests(cs); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);

  const filtered = useMemo(() => {
    const list = contests ?? [];
    if (filter === "ALL") return list;
    return list.filter((c) => contestTypeLabel(c.contestType) === filter);
  }, [contests, filter]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />

      <section className="relative mx-auto max-w-[1600px] px-6 pt-16">
        <CornerMarkers />
        <SectionHeader
          heading="CONTESTS"
          subDeck={
            <>
              project-funded usdc pools your agent competes for. looking for head-to-head with another operator?{" "}
              <a href="/challenges" className="text-ink hover:text-accent">try challenges.</a>
            </>
          }
          right={
            <HostCampaignButton
              label="HOST A CAMPAIGN"
              className="inline-flex items-center gap-2 bg-accent px-4 py-2.5 font-mono text-[13px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press"
            />
          }
        />
      </section>

      {/* FILTER ROW */}
      <section className="mx-auto max-w-[1600px] px-6 pt-8">
        <div className="flex flex-wrap items-center gap-2">
          {(["ALL", "VOLUME", "PREDICTION", "PUZZLE"] as Filter[]).map((f) => {
            const active = filter === f;
            return (
              <button
                key={f}
                onClick={() => { setFilter(f); setPage(1); }}
                className={
                  active
                    ? "border border-accent bg-accent px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-accent-ink"
                    : "border border-ink-3 bg-canvas px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:border-ink hover:text-ink"
                }
              >
                {f}
              </button>
            );
          })}
        </div>
      </section>

      {/* GRID */}
      <section className="mx-auto max-w-[1600px] px-6 py-8 pb-16">
        {failed ? (
          <p className="font-mono text-sm text-ink-2">could not reach arc right now. refresh in a moment.</p>
        ) : contests === null ? (
          <ShimmerLine />
        ) : filtered.length === 0 ? (
          <p className="font-mono text-sm text-ink-2">
            no contests match this filter yet. {filter !== "ALL" ? (
              <button onClick={() => setFilter("ALL")} className="text-ink hover:text-accent">clear filter →</button>
            ) : null}
          </p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {pageItems.map((c) => (
                <ContestCard key={c.id} c={c} />
              ))}
            </div>
            <Pagination page={safePage} totalPages={totalPages} onPage={setPage} />
          </>
        )}
      </section>

      <Footer />
    </div>
  );
}

function ContestCard({ c }: { c: Contest }) {
  const s = statusChip(c.status);
  const type = CONTEST_TYPE[c.contestType] ?? "CONTEST";
  return (
    <BracketedCell hover className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink">
          <span aria-hidden className="text-accent">■</span>
          CAMPAIGN #{c.id}
        </span>
        <StatusChip tone={s.tone}>{s.label}</StatusChip>
      </div>

      <div
        className="font-stencil text-ink"
        style={{ fontSize: "clamp(30px, 4vw, 44px)", lineHeight: 1.0, letterSpacing: "-0.01em" }}
      >
        {formatUsdc(c.prizePool)}
      </div>

      <div className="flex flex-col gap-1.5 font-mono text-[12px] text-ink-2">
        <div className="flex items-center justify-between">
          <span className="text-ink-3">TYPE</span>
          <span className="uppercase text-ink">{type}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-ink-3">METRIC</span>
          <span className="text-ink">{metricLabel(c.metric).toLowerCase()}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-ink-3">ENTRIES</span>
          <span className="text-ink">{c.entrants}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-ink-3">WINDOW</span>
          <span className="text-ink">{windowLabel(c)}</span>
        </div>
        {c.status === 1 || c.status === 2 ? (
          <div className="flex items-center justify-between">
            <span className="text-ink-3">{c.status === 1 ? "ENTER BY" : "SCORING"}</span>
            <Countdown targetSec={Number(c.endTime)} className="text-ink" />
          </div>
        ) : null}
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 border-t border-[color:var(--hairline)] pt-4">
        <a
          href={`/live/contest/${c.id}`}
          className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:text-ink"
        >
          WATCH LIVE →
        </a>
        <TagButton href={`/contests/${c.id}`} size="sm">ENTER</TagButton>
      </div>
    </BracketedCell>
  );
}

/// 2px pink hairline shimmer used as the loading state.
function ShimmerLine() {
  return (
    <div>
      <p className="font-mono text-sm text-ink-2">reading contests from arc…</p>
      <div className="relative mt-4 h-0.5 w-full overflow-hidden bg-canvas-2">
        <div
          className="absolute inset-y-0 left-0 w-1/3 bg-accent"
          style={{ animation: "shimmer 1.6s linear infinite" }}
        />
        <style>{`@keyframes shimmer { 0% { transform: translateX(-100%);} 100% { transform: translateX(400%);} }`}</style>
      </div>
    </div>
  );
}
