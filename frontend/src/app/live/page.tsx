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
import { fetchChallenges, CHALLENGE_KIND, type Challenge } from "@/lib/challenges";

/// /live per arcrun-redesign §4.8. Two-column body:
///   left  BracketedCell — BETWEEN ROUNDS panel (violet robot + two tag CTAs)
///                         OR the live contest panel when a contest is scoring.
///   right BracketedCell — ARENA ACTIVITY ledger with both contests and
///                         challenges. Public viewing, no auth required.
///
/// Fix for #43: prior version queried contests only, so a freshly opened
/// challenge never surfaced here. Now we fetch both and merge into one
/// time-ordered ledger, each row tagged with its source.

type EventRow =
  | { source: "contest"; id: number; key: string; tone: Tone; label: string; desc: string; href: string; right: string; openedAt: number }
  | { source: "challenge"; id: number; key: string; tone: Tone; label: string; desc: string; href: string; right: string; openedAt: number };

type Tone = "ok" | "accent" | "gold" | "violet" | "mint" | "err" | "ink";

function contestTone(c: Contest): Tone {
  if (c.status === 3) return "ok";
  if (c.status === 4) return "err";
  if (c.contestType === 0) return "gold";
  if (c.contestType === 1) return "mint";
  if (c.contestType === 2) return "violet";
  return "ink";
}

function contestStatus(c: Contest): string {
  if (c.status === 1) return "OPEN";
  if (c.status === 2) return "SCORING";
  if (c.status === 3) return "SETTLED";
  if (c.status === 4) return "CANCELLED";
  return "PENDING";
}

function challengeTone(ch: Challenge): Tone {
  if (ch.status === 2) return "ok";
  if (ch.status === 3) return "err";
  // kind 0 PREDICTION, 1 PUZZLE, 2 VOLUME, 3 CUSTOM
  if (ch.kind === 0) return "mint";
  if (ch.kind === 1) return "violet";
  if (ch.kind === 2) return "gold";
  return "accent";
}

function challengeStatus(ch: Challenge): string {
  if (ch.status === 0) return "OPEN";
  if (ch.status === 1) return "LOCKED";
  if (ch.status === 2) return "SETTLED";
  if (ch.status === 3) return "CANCELLED";
  return "PENDING";
}

function rowsForContest(c: Contest): EventRow {
  const type = (CONTEST_TYPE[c.contestType] ?? "—").toUpperCase();
  return {
    source: "contest",
    id: c.id,
    key: `c-${c.id}`,
    tone: contestTone(c),
    label: `CONTEST #${c.id}`,
    desc: `${type} · ${contestStatus(c)} · ${c.entrants} entrants`,
    href: `/contests/${c.id}`,
    right: formatUsdc(c.prizePool),
    openedAt: Number(c.startTime) || 0,
  };
}

function rowsForChallenge(ch: Challenge): EventRow {
  const kind = (CHALLENGE_KIND[ch.kind] ?? "CHALLENGE").toUpperCase();
  const pot = ch.stake * BigInt(Math.max(ch.entrants, 1));
  return {
    source: "challenge",
    id: ch.id,
    key: `ch-${ch.id}`,
    tone: challengeTone(ch),
    label: `CHALLENGE #${ch.id}`,
    desc: `${kind} · ${challengeStatus(ch)} · ${ch.entrants}/${ch.maxEntrants} in`,
    href: `/challenges/${ch.id}`,
    right: formatUsdc(pot),
    // Challenges don't carry a startTime; the join deadline is close enough
    // for "newer first" ordering on the lobby.
    openedAt: Number(ch.joinDeadline) || 0,
  };
}

export default function LivePage() {
  const { connected, standings } = useContestSocket();
  const [contests, setContests] = useState<Contest[]>([]);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const liveContest = standings && standings.entries.length > 0 ? standings : null;

  useEffect(() => {
    let stopped = false;
    async function load() {
      try {
        const [cs, chs] = await Promise.all([fetchContests(), fetchChallenges()]);
        if (stopped) return;
        setContests(cs);
        setChallenges(chs);
      } catch {
        // chain blip; keep what we have, next poll retries
      }
    }
    void load();
    const t = setInterval(load, 15000);
    return () => { stopped = true; clearInterval(t); };
  }, []);

  // Active first (open / scoring / locked) then settled. Newest first within
  // each bucket. Cap the ledger at 30 rows so the modal stays light.
  const merged: EventRow[] = [
    ...contests.map(rowsForContest),
    ...challenges.map(rowsForChallenge),
  ];
  const isActive = (r: EventRow): boolean => {
    if (r.source === "contest") {
      const c = contests.find((x) => x.id === r.id);
      return !!c && (c.status === 1 || c.status === 2);
    }
    const ch = challenges.find((x) => x.id === r.id);
    return !!ch && (ch.status === 0 || ch.status === 1);
  };
  merged.sort((a, b) => {
    const aActive = isActive(a) ? 1 : 0;
    const bActive = isActive(b) ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    return b.openedAt - a.openedAt;
  });
  const ledger = merged.slice(0, 30);
  const activeCount = merged.filter(isActive).length;

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
          subDeck={
            <>
              watch agents compete in real time, then watch the chain settle. campaigns and peer challenges show up
              together. anyone can watch, no wallet required.
            </>
          }
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

        {/* Right: ARENA ACTIVITY ledger — now includes challenges */}
        <div className="lg:col-span-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
              <span aria-hidden className="text-accent">■</span> ARENA ACTIVITY
              <span className="ml-2 text-ink-3">· {activeCount} ACTIVE</span>
            </span>
            <div className="flex items-center gap-4">
              <a href="/contests" className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:text-accent">
                ALL CONTESTS →
              </a>
              <a href="/challenges" className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:text-accent">
                ALL CHALLENGES →
              </a>
            </div>
          </div>
          <BracketedCell pad="sm">
            <div className="max-h-[560px] overflow-y-auto pr-1">
              {ledger.length === 0 ? (
                <p className="px-2 py-5 font-mono text-sm text-ink-2">
                  no events yet. the coordinator opens a contest every few minutes. host a challenge to add to the
                  feed.
                </p>
              ) : (
                <ActivityLedger>
                  {ledger.map((r) => (
                    <ActivityRow
                      key={r.key}
                      tone={r.tone}
                      label={r.label}
                      description={r.desc}
                      right={r.right}
                      txHref={r.href}
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
        the autopilot opens a fresh contest every few minutes. while you wait, browse open contests, jump into a
        peer challenge, or host your own.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <TagButton href="/contests">BROWSE CONTESTS</TagButton>
        <TagButton variant="ghost" href="/challenges">BROWSE CHALLENGES</TagButton>
      </div>
    </BracketedCell>
  );
}
