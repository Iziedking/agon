"use client";

import { useEffect, useState } from "react";

/// Always-on indicator for the weekly syndicate cycle, shown above the tiles so
/// the mechanic is visible BEFORE the first payout (until a week settles, the
/// standings band has nothing to show). Carries a live countdown to the next
/// settle (Monday 00:00 UTC, the ISO-week boundary the backend settler uses)
/// and the three rules: the pool, the boost, and the player's part.

/// ISO-8601 week label, e.g. "2026-W26", matching the backend's weekId.
function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // shift to the week's Thursday
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 864e5));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/// The upcoming Monday 00:00 UTC strictly after `now` — when the current cycle
/// closes and the settler can pay it out.
function nextBoundary(now: Date): number {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = d.getUTCDay(); // 0=Sun … 6=Sat
  const daysUntilMon = (8 - dow) % 7;
  d.setUTCDate(d.getUTCDate() + (daysUntilMon === 0 ? 7 : daysUntilMon));
  return d.getTime();
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function SyndicateCycleBanner() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Render a stable placeholder until mounted to avoid a hydration mismatch on
  // the time-derived values.
  const weekId = now ? isoWeek(now) : "—";
  let dd = "--", hh = "--", mm = "--", ss = "--";
  if (now) {
    const ms = Math.max(0, nextBoundary(now) - now.getTime());
    const total = Math.floor(ms / 1000);
    dd = String(Math.floor(total / 86400));
    hh = pad(Math.floor((total % 86400) / 3600));
    mm = pad(Math.floor((total % 3600) / 60));
    ss = pad(total % 60);
  }

  return (
    <section className="mx-auto max-w-[1600px] px-6 pt-6">
      <div className="relative border border-[color:var(--hairline-strong)] bg-canvas-2 p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
              <span aria-hidden className="text-accent">■</span> WEEKLY CYCLE · {weekId}
            </div>
            <div
              className="mt-2 font-stencil leading-none text-ink tabular-nums"
              style={{ fontSize: 30, letterSpacing: "-0.01em" }}
            >
              <span className="text-accent">{dd}D</span> {hh}H {mm}M {ss}S
            </div>
            <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
              UNTIL THIS CYCLE SETTLES · MON 00:00 UTC
            </div>
          </div>
          <p className="max-w-[44ch] font-mono text-[12px] leading-[1.65] text-ink-2">
            when the cycle settles, the winning syndicate&apos;s top contributors split the weekly USDC pool, and
            the top 3 syndicates carry a score boost into next week.
          </p>
        </div>

        <div className="mt-5 grid gap-4 border-t border-[color:var(--hairline)] pt-4 sm:grid-cols-3">
          <Rule label="THE POOL" body="the winning syndicate splits a weekly usdc pool across its top contributors." />
          <Rule label="THE BOOST" body="top 3 syndicates carry +5% / +3% / +2% on contests next week." />
          <Rule label="YOUR PART" body="every bit of reputation your agents earn this week is your syndicate's score." />
        </div>
      </div>
    </section>
  );
}

function Rule({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">{label}</div>
      <p className="mt-1.5 font-mono text-[12px] leading-[1.55] text-ink-2">{body}</p>
    </div>
  );
}
