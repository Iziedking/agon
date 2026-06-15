"use client";

import { useEffect, useMemo, useState } from "react";
import { notFound, useParams } from "next/navigation";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import { BracketedCell, Robot, robotVariantForId, StatusChip, TagButton } from "@/components/redesign";
import { EventHero, EventStage, normalizeStageKind, RealSolves, type StageKind } from "@/components/redesign/stages";
import { PrizeSplitNote } from "@/components/redesign/PrizeSplitNote";
import { useContestSocket } from "@/hooks/useContestSocket";
import { fetchArcanaPins, type PinnedMarket } from "@/lib/arcanaPins";
import { fetchResults, entriesFromResults } from "@/lib/results";
import { nameFor, useAgentNames } from "@/hooks/useAgentNames";
import { useLiveNarrative, progressSummary } from "@/hooks/useLiveNarrative";
import { useAgentSkins, skinFor } from "@/hooks/useAgentNames";
import { fetchContest, CONTEST_TYPE, formatUsdc, type Contest } from "@/lib/contests";
import { fetchChallenge, CHALLENGE_KIND, type Challenge } from "@/lib/challenges";
import type { StandingsEntry } from "@/lib/live";
import { computeWinProbabilities, formatProb, probFor, type WinProbability } from "@/lib/winProbability";

/// /live/[source]/[id]: the focused watcher. Reads the on-chain shape of the
/// event for the header (so a cold load doesn't depend on the WS), then
/// subscribes to the live broadcast for the standings frames. Routes the
/// per-kind stage through EventStage. Click → /contests/[id] (or
/// /challenges/[id]) for the write transactions (enter, join, claim).

type Source = "contest" | "challenge";

function statusForContest(s: number): { tone: "ok" | "warn" | "err" | "ink"; label: string } {
  if (s === 1) return { tone: "ok", label: "OPEN" };
  if (s === 2) return { tone: "warn", label: "SCORING" };
  if (s === 3) return { tone: "ink", label: "SETTLED" };
  if (s === 4) return { tone: "err", label: "CANCELLED" };
  return { tone: "ink", label: "PENDING" };
}
function statusForChallenge(s: number): { tone: "ok" | "warn" | "err" | "ink"; label: string } {
  if (s === 0) return { tone: "ok", label: "OPEN" };
  if (s === 1) return { tone: "warn", label: "LOCKED" };
  if (s === 2) return { tone: "ink", label: "SETTLED" };
  if (s === 3) return { tone: "err", label: "CANCELLED" };
  return { tone: "ink", label: "PENDING" };
}

export default function FocusedWatcherPage() {
  const params = useParams();
  const source = (Array.isArray(params.source) ? params.source[0] : params.source) as Source | undefined;
  const idStr = Array.isArray(params.id) ? params.id[0] : params.id;
  const id = Number(idStr);

  if (source !== "contest" && source !== "challenge") return notFound();
  if (!Number.isFinite(id)) return notFound();

  return source === "contest" ? <ContestFocus id={id} /> : <ChallengeFocus id={id} />;
}

function ContestFocus({ id }: { id: number }) {
  const { connected, standings, pinnedArcana, lastTick } = useContestSocket();
  const [c, setC] = useState<Contest | null | undefined>(undefined);
  const [arcanaPins, setArcanaPins] = useState<PinnedMarket[]>([]);

  useEffect(() => {
    let stopped = false;
    async function load() {
      try {
        const next = await fetchContest(id);
        if (!stopped) setC(next ?? null);
      } catch {
        if (!stopped) setC(null);
      }
    }
    void load();
    // Refresh every 15s for status flips (open → scoring → settled).
    const t = setInterval(load, 15000);
    return () => { stopped = true; clearInterval(t); };
  }, [id]);

  // HTTP-fetched pins are the fallback when the WS contest_open frame was
  // missed (page load mid-contest, refresh, etc). Falls behind the live
  // standings, which is fine since pins are static once set.
  useEffect(() => {
    let stopped = false;
    void fetchArcanaPins("contest", id).then((markets) => {
      if (!stopped) setArcanaPins(markets);
    });
    return () => { stopped = true; };
  }, [id]);

  // Keep the last standings frame for THIS contest. The socket exposes a single
  // latest frame across every live event, so when another contest broadcasts,
  // `standings.contestId` stops matching and the stage would blank to
  // "initializing" then refill on our next frame — a visible flash. Retaining
  // the last matching frame locally keeps the stage stable between our frames.
  const [live, setLive] = useState<NonNullable<typeof standings> | null>(null);
  useEffect(() => { setLive(null); }, [id]);
  useEffect(() => {
    if (standings && standings.contestId === id) setLive(standings);
  }, [standings, id]);
  // Results snapshot. Live frames win; this fallback shows the field and final
  // ranks when there is no live frame (a refresh of a settled or already-run
  // event), instead of "stage initializing". Refetched on the 15s status poll.
  const [snap, setSnap] = useState<StandingsEntry[]>([]);
  useEffect(() => {
    let stopped = false;
    const load = () => fetchResults("contests", id).then((r) => { if (!stopped) setSnap(entriesFromResults(r)); });
    void load();
    const t = setInterval(load, 15000);
    return () => { stopped = true; clearInterval(t); };
  }, [id]);
  const entries: StandingsEntry[] = live && live.entries.length > 0 ? live.entries : snap;
  const kindLabel = c ? (CONTEST_TYPE[c.contestType] ?? "CONTEST").toUpperCase() : "—";
  const stageKind = normalizeStageKind(live?.contestType ?? kindLabel);
  const status = c ? statusForContest(c.status) : { tone: "ink" as const, label: "LOADING" };
  const isLive = c?.status === 1 || c?.status === 2;

  return (
    <Shell>
      <BackBar />
      {c === undefined ? (
        <p className="font-mono text-sm text-ink-2">reading the contest from arc…</p>
      ) : c === null ? (
        <NotFoundCard kind="contest" id={id} />
      ) : (
        <>
          <EventHero
            source="contest"
            id={id}
            kindLabel={kindLabel}
            statusLabel={status.label}
            statusTone={status.tone}
            poolLabel="PRIZE POOL"
            pool={formatUsdc(c.prizePool)}
            endSec={isLive ? Number(c.endTime) : null}
            endHint="results land shortly after"
            meta={`${c.entrants} ENTRANTS · TOP ${c.topN} SHARE`}
          />
          <PrizeSplitNote source="contest" id={id} />

          <ConnectionLine connected={connected} live={!!live && entries.length > 0} />

          <NarrativeLine
            entries={entries}
            lastTick={lastTick && lastTick.source === "contest" && lastTick.eventId === id ? lastTick : null}
          />

          <div className="mt-6 grid gap-6 lg:grid-cols-12">
            <div className="lg:col-span-8">
              <StageWithNarrative
                entries={entries}
                stageKind={stageKind}
                eventId={id}
                settled={c.status === 3}
                pinnedArcanaMarkets={
                  pinnedArcana?.contestId === id
                    ? pinnedArcana.markets
                    : arcanaPins.length > 0
                      ? arcanaPins
                      : undefined
                }
              />
            </div>
            <aside className="lg:col-span-4">
              <Standings entries={entries} stakedCount={c.entrants} />
              <Actions href={`/contests/${id}`} status={status.label} />
            </aside>
          </div>
        </>
      )}
    </Shell>
  );
}

function ChallengeFocus({ id }: { id: number }) {
  const { connected, challengeStandings, lastTick } = useContestSocket();
  const [ch, setCh] = useState<Challenge | null | undefined>(undefined);
  const [arcanaPins, setArcanaPins] = useState<PinnedMarket[]>([]);

  useEffect(() => {
    let stopped = false;
    async function load() {
      try {
        const next = await fetchChallenge(id);
        if (!stopped) setCh(next ?? null);
      } catch {
        if (!stopped) setCh(null);
      }
    }
    void load();
    const t = setInterval(load, 15000);
    return () => { stopped = true; clearInterval(t); };
  }, [id]);

  // Challenges don't get a WS pinned-set frame the way contests do, so HTTP
  // is the only source. Empty array for non-PREDICTION challenges; the
  // PredictionStage just won't render the menu, which is correct for
  // PUZZLE / VOLUME / CUSTOM kinds.
  useEffect(() => {
    let stopped = false;
    void fetchArcanaPins("challenge", id).then((markets) => {
      if (!stopped) setArcanaPins(markets);
    });
    return () => { stopped = true; };
  }, [id]);

  // Retain the last frame for THIS challenge so another event's broadcast over
  // the shared socket can't blank the stage between our frames (see ContestFocus).
  const [live, setLive] = useState<NonNullable<typeof challengeStandings> | null>(null);
  useEffect(() => { setLive(null); }, [id]);
  useEffect(() => {
    if (challengeStandings && challengeStandings.challengeId === id) setLive(challengeStandings);
  }, [challengeStandings, id]);
  // Results snapshot fallback (see ContestFocus): a refresh of a settled or
  // already-run challenge shows the field and final ranks, not "initializing".
  const [snap, setSnap] = useState<StandingsEntry[]>([]);
  useEffect(() => {
    let stopped = false;
    const load = () => fetchResults("challenges", id).then((r) => { if (!stopped) setSnap(entriesFromResults(r)); });
    void load();
    const t = setInterval(load, 15000);
    return () => { stopped = true; clearInterval(t); };
  }, [id]);
  const entries: StandingsEntry[] = live && live.entries.length > 0 ? live.entries : snap;
  const kindLabel = ch ? (CHALLENGE_KIND[ch.kind] ?? "CHALLENGE").toUpperCase() : "—";
  const stageKind = normalizeStageKind(kindLabel);
  const status = ch ? statusForChallenge(ch.status) : { tone: "ink" as const, label: "LOADING" };
  const isLive = ch?.status === 0 || ch?.status === 1;
  const pot = ch ? ch.stake * BigInt(Math.max(ch.entrants, 1)) : 0n;
  const endSec = ch ? (ch.status === 0 ? Number(ch.joinDeadline) : Number(ch.resolveDeadline)) : null;

  return (
    <Shell>
      <BackBar />
      {ch === undefined ? (
        <p className="font-mono text-sm text-ink-2">reading the challenge from arc…</p>
      ) : ch === null ? (
        <NotFoundCard kind="challenge" id={id} />
      ) : (
        <>
          <EventHero
            source="challenge"
            id={id}
            kindLabel={kindLabel}
            statusLabel={status.label}
            statusTone={status.tone}
            poolLabel="POT SO FAR"
            pool={formatUsdc(pot)}
            endSec={isLive ? endSec : null}
            endHint={ch.status === 0 ? "scoring opens after" : "results land shortly after"}
            meta={`${ch.entrants}/${ch.maxEntrants} STAKED · ${formatUsdc(ch.stake)} STAKE`}
          />
          <PrizeSplitNote source="challenge" id={id} />

          <ConnectionLine connected={connected} live={!!live && entries.length > 0} />

          <NarrativeLine
            entries={entries}
            lastTick={lastTick && lastTick.source === "challenge" && lastTick.eventId === id ? lastTick : null}
          />

          <div className="mt-6 grid gap-6 lg:grid-cols-12">
            <div className="lg:col-span-8">
              <StageWithNarrative
                entries={entries}
                stageKind={stageKind}
                eventId={id}
                settled={ch.status === 2}
                pinnedArcanaMarkets={arcanaPins.length > 0 ? arcanaPins : undefined}
              />
            </div>
            <aside className="lg:col-span-4">
              <Standings entries={entries} stakedCount={ch.entrants} />
              <Actions href={`/challenges/${id}`} status={status.label} />
            </aside>
          </div>
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />
      <section className="mx-auto w-full max-w-[1600px] px-4 pb-16 pt-12 sm:px-6 lg:px-8">{children}</section>
      <Footer />
    </div>
  );
}

function BackBar() {
  return (
    <div className="mb-6 flex items-center justify-between">
      <a
        href="/live"
        className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:text-ink"
      >
        ← BACK TO LOBBY
      </a>
    </div>
  );
}

function NotFoundCard({ kind, id }: { kind: "contest" | "challenge"; id: number }) {
  return (
    <div className="max-w-[560px]">
      <BracketedCell pad="lg">
        <h1 className="font-stencil uppercase text-ink" style={{ fontSize: 28 }}>
          {kind.toUpperCase()} NOT FOUND
        </h1>
        <p className="mt-3 font-mono text-sm text-ink-2">{kind} #{id} is not on arc yet.</p>
      </BracketedCell>
    </div>
  );
}

function ConnectionLine({ connected, live }: { connected: boolean; live: boolean }) {
  return (
    <div className="mt-6 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
      <StatusChip tone={connected ? "ok" : "err"}>
        {connected ? "FEED CONNECTED" : "FEED OFFLINE"}
      </StatusChip>
      <span>{live ? "STREAMING STANDINGS NOW" : "WAITING FOR NEXT FRAME"}</span>
    </div>
  );
}

/// The full-width "WHAT'S HAPPENING" narrative line, updated per-tick by diffing
/// successive standings frames. It sits ABOVE the two-column grid so both columns
/// then start with their own single section header (OUTPUT on the left, STANDINGS
/// on the right), which lines the output boxes up with the standings rows.
function NarrativeLine({
  entries,
  lastTick,
}: {
  entries: StandingsEntry[];
  /// Latest tick from the prediction scheduler scoped to this event.
  lastTick?: import("@/lib/live").TickMessage | null;
}) {
  const ids = useMemo(() => entries.map((e) => e.agentId), [entries]);
  const names = useAgentNames(ids);
  const nameOf = (id: number) => nameFor(names, id);
  const narrative = useLiveNarrative(entries, nameOf, lastTick);
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 font-mono text-[11px] uppercase tracking-[0.16em]">
      <span aria-hidden className="text-accent">■</span>
      <span className="text-ink-3">WHAT'S HAPPENING</span>
      <span className="text-ink">{narrative}</span>
    </div>
  );
}

/// The per-kind stage column: output scoreboard, the stage itself, and the
/// puzzle solve-audit panel. The narrative headline is rendered separately,
/// full width, by NarrativeLine above the grid.
function StageWithNarrative({
  entries,
  stageKind,
  eventId,
  settled,
  pinnedArcanaMarkets,
}: {
  entries: StandingsEntry[];
  stageKind: StageKind;
  /// Contest or challenge id. Drives the RealSolves audit-trail panel
  /// that surfaces the actual puzzle prompts + each agent's answer.
  eventId: number;
  /// True once the event has settled; gates the expected-answer reveal in
  /// the solve feed so a live race never shows the answer.
  settled: boolean;
  /// For Analyst contests routed through Arcana: the market set the
  /// coordinator pinned at open. Lets the stage render the menu before
  /// any agent enters.
  pinnedArcanaMarkets?: import("@/components/redesign/stages/PredictionStage").PinnedMarket[];
}) {
  return (
    <>
      <EventStage kind={stageKind} entries={entries} pinnedArcanaMarkets={pinnedArcanaMarkets} />
      {stageKind === "puzzle" ? <RealSolves id={eventId} settled={settled} /> : null}
    </>
  );
}

/// Standings rail. Reads from the live WS broadcast first; when the runner
/// hasn't emitted a scoring frame yet the panel falls back to the on-chain
/// entrant count so the user doesn't see "no entrants" while staring at a
/// 2/2 staked challenge. The fallback shape carries no scores, just a
/// "waiting on first frame" line and the staked count. Per-row win-prob
/// estimate sits between the name and the score so it's the first thing
/// the eye picks up.
function Standings({ entries, stakedCount }: { entries: StandingsEntry[]; stakedCount?: number }) {
  const ids = useMemo(() => entries.map((e) => e.agentId), [entries]);
  const names = useAgentNames(ids);
  const skins = useAgentSkins(ids);
  const top = useMemo(() => [...entries].sort((a, b) => a.rank - b.rank).slice(0, 8), [entries]);
  const probs: WinProbability[] = useMemo(() => computeWinProbabilities(entries), [entries]);
  return (
    <div>
      <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
        <span aria-hidden className="text-accent">■</span> STANDINGS
      </div>
      <BracketedCell pad="sm">
        {top.length === 0 ? (
          stakedCount && stakedCount > 0 ? (
            <div className="px-1 py-3 font-mono text-[12px] text-ink-2">
              <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
                {stakedCount} {stakedCount === 1 ? "ENTRANT" : "ENTRANTS"} STAKED
              </div>
              <p className="mt-1.5 text-ink-3">scoring starts when the join window closes.</p>
            </div>
          ) : (
            <p className="px-2 py-4 font-mono text-sm text-ink-2">no entrants yet.</p>
          )
        ) : (
          <div className="flex flex-col">
            {top.map((e) => {
              const variant = robotVariantForId(e.agentId);
              const skin = skinFor(skins, e.agentId);
              const p = probFor(probs, e.agentId);
              const summary = progressSummary(e.progress);
              return (
                <div
                  key={e.agentId}
                  className="flex items-center gap-3 border-b border-[color:var(--hairline)] py-2.5 last:border-0"
                >
                  <span className={`w-6 font-stencil text-[14px] ${e.rank === 1 ? "text-accent" : "text-ink"}`}>
                    #{e.rank}
                  </span>
                  <span className="flex h-5 w-5 flex-none items-center justify-center overflow-hidden bg-canvas-3">
                    {skin ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={skin} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
                    ) : (
                      <Robot variant={variant} size={20} decorative />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[11px] uppercase tracking-[0.12em] text-ink">
                      {nameFor(names, e.agentId)}
                    </div>
                    {summary ? (
                      <div className="mt-0.5 font-mono text-[10px] text-ink-3">{summary}</div>
                    ) : null}
                  </div>
                  <span
                    className={`font-mono text-[11px] ${e.rank === 1 ? "text-accent" : "text-ink-2"}`}
                    title="share of the field's output so far"
                  >
                    {formatProb(p)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </BracketedCell>
    </div>
  );
}

function Actions({ href, status }: { href: string; status: string }) {
  return (
    <div className="mt-6 flex flex-col gap-2">
      <TagButton href={href}>VIEW TERMS</TagButton>
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
        ENTER · JOIN · CLAIM HAPPENS ON THE TERMS PAGE
      </span>
      {status === "SETTLED" ? (
        <p className="mt-2 font-mono text-[11px] text-ink-2">
          contest settled onchain. winners claim from the terms page.
        </p>
      ) : null}
    </div>
  );
}
