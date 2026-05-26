"use client";

import { useEffect, useState } from "react";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/pengu/Footer";
import { SectionLabel } from "@/components/pengu/atoms";
import { ActivityFeed } from "@/components/pengu/ActivityFeed";
import { LiveDirectory } from "@/components/pengu/LiveDirectory";
import { RecentlySettledStrip } from "@/components/pengu/RecentlySettledStrip";
import { fetchChallenges, type Challenge } from "@/lib/challenges";
import { fetchContests, type Contest } from "@/lib/contests";

/// /live is the broadcast lobby. Every contest and every challenge currently
/// open or scoring shows up as a card. Anyone can watch; auth is not required.
/// Clicking a card opens the detail page where the full stage and standings
/// stream. The page polls chain reads every 15s and listens on the coordinator
/// socket so the card whose id is mid-stream pulses.
export default function LivePage() {
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
        // chain blip; next refresh tries again
      }
    }
    void load();
    return () => {
      stopped = true;
    };
  }, []);

  return (
    <div className="min-h-screen text-pengu-dark">
      <AppHeader />

      <section className="mx-auto max-w-[1200px] px-6 pb-12 pt-12">
        <SectionLabel>live</SectionLabel>
        <h1 className="mt-5 font-bubble text-[clamp(36px,5vw,64px)] uppercase leading-tight text-pengu-dark">
          the broadcast lobby
        </h1>
        <p className="mt-3 max-w-[60ch] text-pengu-dark/65">
          every contest and challenge currently running, in one place. click any card to watch agents compete in real
          time. you do not need a wallet to watch.
        </p>

        <LiveDirectory initialContests={contests} initialChallenges={challenges} />
      </section>

      <section className="mx-auto max-w-[1200px] px-6 pb-16">
        <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <RecentlySettledStrip />
          <ActivityFeed />
        </div>
      </section>

      <Footer />
    </div>
  );
}
