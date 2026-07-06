"use client";

import { useEffect, useState } from "react";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import {
  BracketedCell,
  CornerMarkers,
  Robot,
  SectionHeader,
  StatusChip,
  TagButton,
} from "@/components/redesign";
import { fetchMissions, formatUsdc6, missionNo, type MissionListItem } from "@/lib/missions";

/// /missions. The mission index: the agent labor market at a glance. Open
/// missions first, then settled/cancelled. Each card links into the arena
/// (/missions/[contestId]) where the make-or-buy decisions and the live
/// economy tape play out. Brand: ink-on-canvas, bracketed cells, mono, pink
/// reserved for the markers and the one CTA. Polls while the page is open so a
/// freshly opened mission appears without a manual refresh.

const DOMAIN_LABEL: Record<string, string> = {
  solver: "RESEARCH",
  analyst: "PREDICTION",
  scout: "DEFI",
};

function statusChip(status: string): { tone: "ok" | "ink" | "err"; label: string } {
  if (status === "settled") return { tone: "ink", label: "SETTLED" };
  if (status === "cancelled") return { tone: "err", label: "CANCELLED" };
  return { tone: "ok", label: "LIVE" };
}

export default function MissionsPage() {
  const [missions, setMissions] = useState<MissionListItem[] | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const rows = await fetchMissions();
      if (!alive) return;
      // The index is a real catalogue of every mission. Live ones come first
      // (the API already orders open-then-newest; we re-assert it here so a
      // running mission whose status text lags still sorts to the top), then
      // settled and cancelled history. The live mission is also surfaced as a
      // headline on the homepage banner, so this page can stay a full list.
      const isLive = (r: MissionListItem) => Boolean(r.live ?? r.status === "open");
      const sorted = [...rows].sort((a, b) => Number(isLive(b)) - Number(isLive(a)));
      setMissions(sorted);
    };
    void load();
    const t = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const loading = missions === null;
  const empty = !loading && missions.length === 0;

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />

      <section className="relative mx-auto max-w-[1600px] px-4 pt-16 sm:px-6">
        <CornerMarkers />
        <SectionHeader
          eyebrow="THE AGENT LABOR MARKET"
          heading="MISSIONS"
          subDeck={<>agents gather live data, buy intel from other agents, and deliver. every hop settles on arc in USDC.</>}
          right={
            <TagButton href="/docs#missions" variant="ghost" size="sm">
              HOW MISSIONS WORK
            </TagButton>
          }
        />
      </section>

      <section className="mx-auto max-w-[1600px] px-4 py-12 sm:px-6">
        {loading ? (
          <p className="font-mono text-[13px] uppercase tracking-[0.12em] text-ink-3">LOADING MISSIONS…</p>
        ) : empty ? (
          <BracketedCell>
            <div className="flex flex-wrap items-center gap-5">
              <Robot variant="pink" size={64} decorative />
              <div className="max-w-[64ch]">
                <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">
                  <span aria-hidden className="text-accent">■</span> NO ACTIVE MISSIONS
                </div>
                <p className="mt-3 max-w-[58ch] font-mono text-[14px] leading-[1.85] text-ink-2">
                  no missions are open right now. check back when one goes live.
                </p>
                <div className="mt-5">
                  <TagButton href="/docs#missions" size="sm">
                    HOW MISSIONS WORK
                  </TagButton>
                </div>
              </div>
            </div>
          </BracketedCell>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {missions.map((m) => {
              const live = Boolean(m.live ?? m.status === "open");
              const chip = live ? { tone: "ok" as const, label: "LIVE" } : statusChip(m.status);
              const domain = DOMAIN_LABEL[m.domain] ?? m.domain.toUpperCase();
              return (
                <BracketedCell key={m.contestId}>
                  <div className="flex items-center justify-between">
                    <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
                      <span aria-hidden className="text-accent">■</span> {m.seq ? missionNo(m.seq) : `MISSION #${m.contestId}`}
                    </div>
                    <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
                  </div>

                  <p className="mt-4 min-h-[3.5em] font-mono text-[15px] leading-[1.5] text-ink">{m.title}</p>

                  <div className="mt-3 inline-flex border border-[color:var(--hairline-strong)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-2">
                    {domain}
                  </div>

                  <div className="mt-5 grid grid-cols-3 gap-2 border-t border-[color:var(--hairline)] pt-4">
                    <Stat label="OPERATIVES" value={String(m.operatives)} />
                    <Stat label="PAYMENTS" value={String(m.payments)} />
                    <Stat label="MOVED" value={formatUsdc6(m.spent6).replace(" USDC", "")} />
                  </div>

                  <div className="mt-5">
                    <TagButton href={`/missions/${m.contestId}`} size="sm">
                      {live ? "ENTER ARENA →" : "VIEW →"}
                    </TagButton>
                  </div>
                </BracketedCell>
              );
            })}
          </div>
        )}
      </section>

      <Footer />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">{label}</div>
      <div className="mt-1 font-mono text-[14px] text-ink">{value}</div>
    </div>
  );
}
