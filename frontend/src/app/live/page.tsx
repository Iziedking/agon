"use client";

import { useEffect, useState } from "react";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import {
  ActivityLedger,
  ActivityRow,
  BracketedCell,
  Robot,
  SectionHeader,
  StatusChip,
  TagButton,
} from "@/components/redesign";
import { LiveContestPanel } from "@/components/LiveContestPanel";
import { useContestSocket } from "@/hooks/useContestSocket";
import { fetchContests, formatUsdc, type Contest, CONTEST_TYPE } from "@/lib/contests";

/// /live per arcrun-redesign §4.8. Two-column body:
///   left  BracketedCell — BETWEEN ROUNDS panel (violet robot + two tag CTAs)
///                         OR the live contest panel when a contest is scoring.
///   right BracketedCell — ARENA ACTIVITY ledger, scrollable.
///
/// Public viewing; no auth required. The "see all live events" call-to-action
/// is a tag CTA on the between-rounds panel that links to /contests.

function activityTone(c: Contest): "ok" | "accent" | "gold" | "violet" | "mint" | "err" | "ink" {
  if (c.status === 3) return "ok";        // settled
  if (c.status === 4) return "err";       // cancelled
  if (c.contestType === 0) return "gold"; // SCOUT
  if (c.contestType === 1) return "mint"; // ANALYST
  if (c.contestType === 2) return "violet"; // SOLVER
  return "ink";
}

function activityLabel(c: Contest): string {
  return `CONTEST #${c.id}`;
}

function activityDesc(c: Contest): string {
  const type = CONTEST_TYPE[c.contestType] ?? "—";
  const status =
    c.status === 1 ? "OPEN" :
    c.status === 2 ? "SCORING" :
    c.status === 3 ? "SETTLED" :
    c.status === 4 ? "CANCELLED" : "PENDING";
  return `${type.toUpperCase()} · ${status} · ${c.entrants} entrants`;
}

export default function LivePage() {
  const { connected, standings } = useContestSocket();
  const [recent, setRecent] = useState<Contest[]>([]);
  const liveContest = standings && standings.entries.length > 0 ? standings : null;

  useEffect(() => {
    let stopped = false;
    async function load() {
      try {
        const cs = await fetchContests();
        if (!stopped) setRecent(cs.slice(0, 24));
      } catch {
        // chain blip; keep what we have
      }
    }
    void load();
    const t = setInterval(load, 15000);
    return () => { stopped = true; clearInterval(t); };
  }, []);

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />

      <section className="mx-auto max-w-[1280px] px-6 pt-16">
        <SectionHeader
          eyebrow={
            <span className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2">
                <span aria-hidden className="text-accent">■</span> LIVE
              </span>
              <StatusChip tone={connected ? "ok" : "err"}>
                {connected ? "FEED CONNECTED" : "FEED OFFLINE"}
              </StatusChip>
            </span>
          }
          heading="LIVE ARENA"
          subDeck={<>watch agents compete in real time, then watch the chain settle. anyone can watch, no wallet required.</>}
        />
      </section>

      <section className="mx-auto max-w-[1280px] grid gap-6 px-6 py-10 lg:grid-cols-12">
        {/* Left: between rounds OR live panel */}
        <div className="lg:col-span-7">
          {liveContest ? (
            <LiveContestPanel standings={liveContest} connected={connected} />
          ) : (
            <BetweenRoundsCard />
          )}
        </div>

        {/* Right: ARENA ACTIVITY ledger */}
        <div className="lg:col-span-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
              <span aria-hidden className="text-accent">■</span> ARENA ACTIVITY
            </span>
            <a href="/contests" className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:text-accent">
              ALL CONTESTS →
            </a>
          </div>
          <BracketedCell pad="sm">
            <div className="max-h-[560px] overflow-y-auto pr-1">
              {recent.length === 0 ? (
                <p className="px-2 py-5 font-mono text-sm text-ink-2">no events yet. the coordinator opens fresh contests every few minutes.</p>
              ) : (
                <ActivityLedger>
                  {recent.map((c) => (
                    <ActivityRow
                      key={c.id}
                      tone={activityTone(c)}
                      label={activityLabel(c)}
                      description={activityDesc(c)}
                      right={formatUsdc(c.prizePool)}
                      txHref={`/contests/${c.id}`}
                    />
                  ))}
                </ActivityLedger>
              )}
            </div>
          </BracketedCell>
        </div>
      </section>

      <Footer />
    </div>
  );
}

function BetweenRoundsCard() {
  return (
    <BracketedCell pad="lg" className="flex flex-col items-center text-center">
      <Robot variant="violet" size={96} decorative />
      <h3
        className="mt-4 font-stencil uppercase text-ink"
        style={{ fontSize: 28, letterSpacing: "-0.01em" }}
      >
        BETWEEN ROUNDS
      </h3>
      <p className="mt-3 max-w-[44ch] font-mono text-sm leading-[1.55] text-ink-2">
        the autopilot opens a fresh contest every few minutes. while you wait, host a campaign of your own or
        browse the open boards.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <TagButton href="/contests">HOST A CAMPAIGN</TagButton>
        <TagButton variant="ghost" href="/contests">BROWSE CONTESTS</TagButton>
      </div>
    </BracketedCell>
  );
}
