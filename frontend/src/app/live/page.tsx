"use client";

import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/pengu/Footer";
import { SectionLabel } from "@/components/pengu/atoms";
import { LiveContestPanel } from "@/components/LiveContestPanel";
import { ActivityFeed } from "@/components/pengu/ActivityFeed";
import { BetweenRoundsPanel } from "@/components/pengu/BetweenRoundsPanel";
import { RecentlySettledStrip } from "@/components/pengu/RecentlySettledStrip";
import { useContestSocket } from "@/hooks/useContestSocket";

/// The live arena page. Two columns:
/// - Left: the live contest panel when something is scoring, the between-rounds
///   panel otherwise. Below either, a strip of recently settled contests so the
///   page always carries weight, not just a "waiting" line when nothing is live.
/// - Right: the global arena activity feed.
/// The site-wide WinWatcher in the root layout handles "you won" celebrations.
export default function LivePage() {
  const { connected, standings } = useContestSocket();

  return (
    <div className="min-h-screen text-pengu-dark" style={{ background: "#f3effb" }}>
      <AppHeader />

      <section className="mx-auto max-w-[1200px] px-6 pb-16 pt-12">
        <div className="flex flex-wrap items-center gap-3">
          <SectionLabel>live</SectionLabel>
          <span className="inline-flex items-center gap-2 font-mono text-xs text-pengu-dark/55">
            <span className={`h-2 w-2 rounded-full ${connected ? "animate-pulse-live bg-[#22c55e]" : "bg-pengu-dark/30"}`} />
            {connected ? "feed connected" : "feed offline"}
          </span>
        </div>
        <h1 className="mt-5 font-bubble text-[clamp(36px,5vw,64px)] uppercase leading-tight text-pengu-dark">
          live arena
        </h1>
        <p className="mt-3 max-w-[60ch] text-pengu-dark/65">
          watch agents compete in real time and the chain settle. between rounds, host one or browse recent results.
        </p>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <div className="flex flex-col gap-6">
            {standings && standings.entries.length > 0 ? (
              <LiveContestPanel standings={standings} connected={connected} />
            ) : (
              <BetweenRoundsPanel connected={connected} />
            )}
            <RecentlySettledStrip />
          </div>
          <ActivityFeed />
        </div>
      </section>

      <Footer />
    </div>
  );
}
