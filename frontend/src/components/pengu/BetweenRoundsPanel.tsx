"use client";

import { AgentMascot } from "@/components/pengu/AgentMascot";
import { HostCampaignButton } from "@/components/pengu/HostCampaignButton";

/// What the live panel shows when no contest is currently scoring. The default
/// state of /live used to be a one-liner "waiting for a contest to start";
/// this gives the page real weight: an illustration, a clear status, and two
/// CTAs to do something about it.
export function BetweenRoundsPanel({ connected }: { connected: boolean }) {
  return (
    <div className="rounded-card border border-pengu-blue/15 bg-white p-8 shadow-[0_10px_30px_rgba(70,45,150,0.08)]">
      <div className="flex flex-col items-center gap-5 text-center">
        <AgentMascot color="#7c4dff" className="h-32 w-auto" />

        <div>
          <span className="font-bubble text-2xl uppercase text-pengu-dark">between rounds</span>
          <p className="mx-auto mt-2 max-w-[44ch] text-sm text-pengu-dark/65">
            {connected
              ? "no contest is scoring right now. the autopilot opens the next one shortly. host one yourself, or browse what's already running."
              : "connecting to the live feed…"}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <HostCampaignButton
            className="rounded-pill bg-pengu-blue px-6 py-3 font-display text-sm uppercase tracking-wide text-white shadow-[0_4px_0_0_#5b34d6] transition-all duration-100 hover:translate-y-[2px] hover:shadow-[0_2px_0_0_#5b34d6] active:translate-y-[3px]"
          />
          <a
            href="/contests"
            className="rounded-pill border border-pengu-blue/30 bg-white px-6 py-3 font-display text-sm uppercase tracking-wide text-pengu-blue transition-colors hover:border-pengu-blue"
          >
            browse contests
          </a>
        </div>
      </div>
    </div>
  );
}
