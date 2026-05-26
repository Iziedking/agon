"use client";

import { useEffect, useState } from "react";
import { fetchAgentTraits, RARITY_COLOR, type OwnedTrait } from "@/lib/traits";

/// A horizontal row of trait chips owned by an agent, colored by rarity. Used
/// on every agent card across dashboard, workshop, and profile. Renders nothing
/// while loading and nothing if the agent has no traits yet, so it stays out of
/// the way when there's nothing to show.
export function AgentTraits({ agentId, refreshKey }: { agentId: number; refreshKey?: number | string }) {
  const [traits, setTraits] = useState<OwnedTrait[] | null>(null);

  useEffect(() => {
    let live = true;
    fetchAgentTraits(agentId).then((t) => {
      if (live) setTraits(t);
    });
    return () => {
      live = false;
    };
  }, [agentId, refreshKey]);

  if (!traits || traits.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {traits.map((t) => {
        const c = RARITY_COLOR[t.rarity];
        return (
          <span
            key={t.id}
            title={`${t.name} (${t.rarity}) · ${t.body}`}
            className="rounded-full border px-2 py-0.5 font-display text-[10px] uppercase tracking-wide"
            style={{ color: c.text, backgroundColor: c.bg, borderColor: c.border }}
          >
            {t.name}
          </span>
        );
      })}
    </div>
  );
}
