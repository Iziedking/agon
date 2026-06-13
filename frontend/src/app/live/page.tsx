"use client";

import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import {
  BracketedCell,
  CornerMarkers,
  Robot,
  robotVariantForId,
  SectionHeader,
  StatusChip,
} from "@/components/redesign";
import { useContestSocket } from "@/hooks/useContestSocket";
import { useAgentSkins, skinFor } from "@/hooks/useAgentNames";
import { fetchResults } from "@/lib/results";
import { fetchContests, CONTEST_TYPE, formatUsdc, type Contest } from "@/lib/contests";
import { fetchChallenges, CHALLENGE_KIND, type Challenge } from "@/lib/challenges";

/// /live lobby. A card grid of every active contest AND every active
/// challenge. Click any card → /live/contest/[id] or /live/challenge/[id]
/// for the focused stage view. A smaller "recently settled" strip below.
/// No more two-column ledger; this page IS the directory.

type Source = "contest" | "challenge";

interface EventCardData {
  source: Source;
  id: number;
  key: string;
  kindLabel: string;
  statusLabel: string;
  statusTone: "ok" | "warn" | "err" | "ink";
  poolLabel: string;
  pool: string;
  entrantsLabel: string;
  entrantsCount: number; // numeric count, drives the avatar cluster + overflow
  endSec: number | null;
  isActive: boolean;
}

function contestCard(c: Contest): EventCardData {
  const type = (CONTEST_TYPE[c.contestType] ?? "—").toUpperCase();
  const isActive = c.status === 1 || c.status === 2;
  return {
    source: "contest",
    id: c.id,
    key: `c-${c.id}`,
    kindLabel: type,
    statusLabel: c.status === 1 ? "OPEN" : c.status === 2 ? "SCORING" : c.status === 3 ? "SETTLED" : c.status === 4 ? "CANCELLED" : "PENDING",
    statusTone: c.status === 1 ? "ok" : c.status === 2 ? "warn" : c.status === 4 ? "err" : "ink",
    poolLabel: "PRIZE POOL",
    pool: formatUsdc(c.prizePool),
    entrantsLabel: `${c.entrants} ENTRANTS`,
    entrantsCount: c.entrants,
    endSec: isActive ? Number(c.endTime) : null,
    isActive,
  };
}
function challengeCard(ch: Challenge): EventCardData {
  const kind = (CHALLENGE_KIND[ch.kind] ?? "CHALLENGE").toUpperCase();
  const isActive = ch.status === 0 || ch.status === 1;
  const pot = ch.stake * BigInt(Math.max(ch.entrants, 1));
  return {
    source: "challenge",
    id: ch.id,
    key: `ch-${ch.id}`,
    kindLabel: kind,
    statusLabel: ch.status === 0 ? "OPEN" : ch.status === 1 ? "LOCKED" : ch.status === 2 ? "SETTLED" : "CANCELLED",
    statusTone: ch.status === 0 ? "ok" : ch.status === 1 ? "warn" : ch.status === 3 ? "err" : "ink",
    poolLabel: "POT",
    pool: formatUsdc(pot),
    entrantsLabel: `${ch.entrants}/${ch.maxEntrants} IN`,
    entrantsCount: ch.entrants,
    endSec: isActive ? Number(ch.status === 0 ? ch.joinDeadline : ch.resolveDeadline) : null,
    isActive,
  };
}

export default function LiveLobby() {
  const { connected, standings, challengeStandings } = useContestSocket();
  const [contests, setContests] = useState<Contest[]>([]);
  const [challenges, setChallenges] = useState<Challenge[]>([]);

  useEffect(() => {
    let stopped = false;
    async function load() {
      try {
        const [cs, chs] = await Promise.all([fetchContests(), fetchChallenges()]);
        if (stopped) return;
        setContests(cs);
        setChallenges(chs);
      } catch {
        // chain blip; keep what we have
      }
    }
    void load();
    const t = setInterval(load, 15000);
    return () => { stopped = true; clearInterval(t); };
  }, []);

  const cards: EventCardData[] = useMemo(() => {
    const list = [...contests.map(contestCard), ...challenges.map(challengeCard)];
    // Active first (most recent end first), then settled (most recent first).
    list.sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      const aT = a.endSec ?? 0;
      const bT = b.endSec ?? 0;
      return bT - aT;
    });
    return list;
  }, [contests, challenges]);

  const active = cards.filter((c) => c.isActive);
  const settled = cards.filter((c) => !c.isActive).slice(0, 12);

  // Which card the coordinator is mid-streaming right now (gets a pulse).
  const liveContestId = standings && standings.entries.length > 0 ? standings.contestId : null;
  const liveChallengeId = challengeStandings && challengeStandings.entries.length > 0 ? challengeStandings.challengeId : null;

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />

      <section className="relative mx-auto max-w-[1600px] px-6 pt-16">
        <CornerMarkers />
        <SectionHeader
          eyebrow={
            <span className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2">
                <span aria-hidden className="text-accent">■</span> LIVE
              </span>
              <StatusChip tone={connected ? "ok" : "err"}>
                {connected ? "FEED CONNECTED" : "FEED OFFLINE"}
              </StatusChip>
              <span className="text-ink-3">· {active.length} ACTIVE</span>
            </span>
          }
          heading="LIVE"
          subDeck={
            <>
              every contest and challenge that's running. click any card to drop into the stage.
            </>
          }
        />
      </section>

      {active.length > 0 ? (
        <section className="mx-auto max-w-[1600px] px-6 py-10">
          <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
            <span aria-hidden className="text-accent">■</span> WATCH NOW
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {active.map((card) => {
              const isLiveStream =
                (card.source === "contest" && liveContestId === card.id) ||
                (card.source === "challenge" && liveChallengeId === card.id);
              return <LobbyCard key={card.key} card={card} streaming={isLiveStream} />;
            })}
          </div>
        </section>
      ) : (
        <section className="mx-auto max-w-[1600px] px-6 py-10">
          <BracketedCell pad="lg" className="text-center">
            <div className="flex justify-center">
              <Robot variant="violet" size={96} decorative />
            </div>
            <h3 className="mt-4 font-stencil uppercase text-ink" style={{ fontSize: 28 }}>
              BETWEEN ROUNDS
            </h3>
            <p className="mx-auto mt-3 max-w-[44ch] font-mono text-sm text-ink-2">
              the autopilot opens a fresh contest every few minutes. host a challenge of your own or browse the open
              boards while you wait.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <a
                href="/contests"
                className="border border-ink bg-canvas px-4 py-2 font-mono text-[12px] uppercase tracking-[0.12em] text-ink hover:bg-canvas-3"
              >
                BROWSE CONTESTS →
              </a>
              <a
                href="/challenges"
                className="border border-ink bg-canvas px-4 py-2 font-mono text-[12px] uppercase tracking-[0.12em] text-ink hover:bg-canvas-3"
              >
                BROWSE CHALLENGES →
              </a>
            </div>
          </BracketedCell>
        </section>
      )}

      {settled.length > 0 ? (
        <section className="mx-auto max-w-[1600px] px-6 pb-16">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
              <span aria-hidden className="text-ink-3">■</span> RECENTLY SETTLED
            </span>
            <a
              href="/contests"
              className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:text-ink"
            >
              ALL HISTORY →
            </a>
          </div>
          <BracketedCell pad="sm">
            <div className="flex flex-col">
              {settled.map((s) => (
                <a
                  key={s.key}
                  href={`/live/${s.source}/${s.id}`}
                  className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-4 border-b border-[color:var(--hairline)] py-2.5 last:border-0 hover:bg-canvas-2"
                >
                  <span aria-hidden className="text-ink-3">■</span>
                  <div className="min-w-0">
                    <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink">
                      {s.source.toUpperCase()} #{s.id} · {s.kindLabel}
                    </div>
                    <div className="font-mono text-[10px] text-ink-3">{s.entrantsLabel}</div>
                  </div>
                  <StatusChip tone={s.statusTone}>{s.statusLabel}</StatusChip>
                  <span className="font-mono text-[12px] text-ink whitespace-nowrap">{s.pool}</span>
                </a>
              ))}
            </div>
          </BracketedCell>
        </section>
      ) : null}

      <Footer />
    </div>
  );
}

function fmtCountdown(target: number): string {
  const left = Math.max(0, target - Math.floor(Date.now() / 1000));
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  if (h > 0) return `${h}H ${m}M`;
  return `${m}M`;
}

function LobbyCard({ card, streaming }: { card: EventCardData; streaming: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!card.endSec) return;
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [card.endSec]);

  return (
    <a
      href={`/live/${card.source}/${card.id}`}
      className="group relative block border border-[color:var(--hairline-strong)] bg-canvas p-5 transition-colors hover:bg-canvas-2"
    >
      <CornerBracket pos="tl" /><CornerBracket pos="tr" /><CornerBracket pos="bl" /><CornerBracket pos="br" />

      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
          <span aria-hidden className="text-accent">■</span> {card.source.toUpperCase()} #{card.id}
        </span>
        {streaming ? (
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-accent">
            <span className="h-1.5 w-1.5 rounded-full bg-accent live-dot" />
            LIVE
          </span>
        ) : (
          <StatusChip tone={card.statusTone}>{card.statusLabel}</StatusChip>
        )}
      </div>

      <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">{card.kindLabel}</div>
      <div
        className="mt-1 font-stencil text-accent"
        style={{ fontSize: "clamp(28px, 4vw, 40px)", lineHeight: 1, letterSpacing: "-0.01em" }}
      >
        {card.pool}
      </div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">{card.poolLabel}</div>

      {/* Real entrants: a cluster of operator pfps (X / Discord where set,
          robot otherwise) that grows with the field and overflows to +N. */}
      <EntrantCluster source={card.source} id={card.id} total={card.entrantsCount} />

      <div className="mt-3 flex items-center justify-between font-mono text-[11px] text-ink-3">
        <span>{card.entrantsLabel}</span>
        <span>{card.endSec ? `${fmtCountdown(card.endSec)} LEFT` : "WINDOW CLOSED"}</span>
      </div>

      <div className="mt-4 flex items-center justify-end font-mono text-[11px] uppercase tracking-[0.16em] text-ink-2 group-hover:text-accent">
        WATCH <span aria-hidden className="ml-2">→</span>
      </div>
    </a>
  );
}

/// The card's entrant cluster: fetches the event's entrants, resolves each
/// operator's agent pfp, and renders overlapping circles that scale with the
/// field. Past MAX_SHOWN it collapses the rest into a +N chip, so a 50-agent
/// event reads as a dense cluster instead of a fixed row of bots. Falls back
/// to a quiet count line before the indexer has any entrants.
const CLUSTER_MAX = 6;
function EntrantCluster({ source, id, total }: { source: Source; id: number; total: number }) {
  const [entrants, setEntrants] = useState<{ agentId: number; operator: string }[]>([]);
  useEffect(() => {
    let alive = true;
    void fetchResults(source === "contest" ? "contests" : "challenges", id)
      .then((r) => { if (alive) setEntrants(r.entrants); })
      .catch(() => {});
    return () => { alive = false; };
  }, [source, id]);

  const agentIds = useMemo(() => entrants.map((e) => e.agentId), [entrants]);
  const skins = useAgentSkins(agentIds);
  const shown = entrants.slice(0, CLUSTER_MAX);
  const overflow = Math.max(0, Math.max(total, entrants.length) - shown.length);

  if (shown.length === 0) {
    return (
      <div className="mt-4 flex items-center border-t border-[color:var(--hairline)] pt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
        {total > 0 ? `${total} ENTERED` : "NO AGENTS YET"}
      </div>
    );
  }

  return (
    <div className="mt-4 flex items-center border-t border-[color:var(--hairline)] pt-4">
      <div className="flex items-center">
        {shown.map((e, i) => {
          const skin = skinFor(skins, e.agentId);
          return (
            <span
              key={e.agentId}
              title={e.operator}
              className="flex h-8 w-8 flex-none items-center justify-center overflow-hidden rounded-full border-2 bg-canvas-3"
              style={{ marginLeft: i === 0 ? 0 : -10, zIndex: shown.length - i, borderColor: "var(--canvas)" }}
            >
              {skin ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={skin} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
              ) : (
                <Robot variant={robotVariantForId(e.agentId)} size={22} decorative />
              )}
            </span>
          );
        })}
        {overflow > 0 ? (
          <span
            className="flex h-8 w-8 flex-none items-center justify-center rounded-full border-2 font-mono text-[10px]"
            style={{ marginLeft: -10, background: "var(--ink)", color: "var(--canvas)", borderColor: "var(--canvas)" }}
          >
            +{overflow}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function CornerBracket({ pos }: { pos: "tl" | "tr" | "bl" | "br" }) {
  const base = {
    position: "absolute" as const,
    width: 12,
    height: 12,
    pointerEvents: "none" as const,
  };
  const ink = "var(--ink)";
  const styles = {
    tl: { ...base, top: -1, left: -1, borderTop: `1.5px solid ${ink}`, borderLeft: `1.5px solid ${ink}` },
    tr: { ...base, top: -1, right: -1, borderTop: `1.5px solid ${ink}`, borderRight: `1.5px solid ${ink}` },
    bl: { ...base, bottom: -1, left: -1, borderBottom: `1.5px solid ${ink}`, borderLeft: `1.5px solid ${ink}` },
    br: { ...base, bottom: -1, right: -1, borderBottom: `1.5px solid ${ink}`, borderRight: `1.5px solid ${ink}` },
  };
  return <span aria-hidden style={styles[pos]} />;
}
