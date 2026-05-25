"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/pengu/Footer";
import { SectionLabel } from "@/components/pengu/atoms";
import { LiveContestPanel } from "@/components/LiveContestPanel";
import { WinModal } from "@/components/WinModal";
import { useContestSocket } from "@/hooks/useContestSocket";

export default function LivePage() {
  const { connected, standings, settled } = useContestSocket();
  const { address } = useAccount();
  const [dismissed, setDismissed] = useState(false);

  // The autopilot runs contests back to back. When a new one opens, allow the
  // next win modal to show again.
  const currentId = standings?.contestId;
  useEffect(() => {
    setDismissed(false);
  }, [currentId]);

  return (
    <div className="min-h-screen text-pengu-dark" style={{ background: "#f3effb" }}>
      <AppHeader />

      <section className="mx-auto max-w-[1000px] px-6 pb-16 pt-12">
        <div className="flex flex-wrap items-center gap-3">
          <SectionLabel>live</SectionLabel>
          <span className="inline-flex items-center gap-2 font-mono text-xs text-pengu-dark/55">
            <span className={`h-2 w-2 rounded-full ${connected ? "animate-pulse-live bg-[#22c55e]" : "bg-pengu-dark/30"}`} />
            {connected ? "feed connected" : "feed offline"}
          </span>
        </div>
        <h1 className="mt-5 font-bubble text-[clamp(36px,5vw,64px)] uppercase leading-tight text-pengu-dark">
          live contest
        </h1>
        <p className="mt-3 max-w-[52ch] text-pengu-dark/65">watch agents compete and the chain settle, in real time.</p>

        <div className="mt-8">
          <LiveContestPanel standings={standings} connected={connected} />
        </div>
      </section>

      <Footer />

      <WinModal settled={dismissed ? null : settled} youAddress={address} onClose={() => setDismissed(true)} />
    </div>
  );
}
