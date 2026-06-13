"use client";

import { useEffect, useMemo, useState } from "react";
import { Robot, robotVariantForId } from "./Robot";
import { useAgentSkins, skinFor } from "@/hooks/useAgentNames";
import { fetchResults } from "@/lib/results";

/// A cluster of an event's real entrant avatars: one per agent that joined,
/// showing the operator's X / Discord pfp where set and the syndicate robot
/// otherwise. Scales with the field (4 joined → 4 avatars) and collapses to a
/// +N chip past `max`. An event with no entrants yet shows a single default
/// robot keyed off its id, so empty cards stay quiet instead of faking a field.
export function EntrantAvatars({
  source,
  id,
  total,
  size = 24,
  max = 5,
}: {
  source: "contest" | "challenge";
  id: number;
  /// On-chain entrant count, drives the +N overflow even before the indexer
  /// has every row.
  total: number;
  size?: number;
  max?: number;
}) {
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
  const shown = entrants.slice(0, max);
  const overflow = Math.max(0, Math.max(total, entrants.length) - shown.length);
  const box = size + 4;

  if (shown.length === 0) {
    return (
      <span className="block">
        <Robot variant={robotVariantForId(id)} size={size} decorative />
      </span>
    );
  }

  return (
    <div className="flex items-center">
      {shown.map((e, i) => {
        const skin = skinFor(skins, e.agentId);
        return (
          <span
            key={e.agentId}
            title={e.operator}
            className="flex flex-none items-center justify-center overflow-hidden rounded-full border bg-canvas-3"
            style={{ width: box, height: box, marginLeft: i === 0 ? 0 : -8, zIndex: shown.length - i, borderColor: "var(--canvas)" }}
          >
            {skin ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={skin} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
            ) : (
              <Robot variant={robotVariantForId(e.agentId)} size={size - 2} decorative />
            )}
          </span>
        );
      })}
      {overflow > 0 ? (
        <span
          className="flex flex-none items-center justify-center rounded-full border font-mono text-[9px]"
          style={{ width: box, height: box, marginLeft: -8, background: "var(--ink)", color: "var(--canvas)", borderColor: "var(--canvas)" }}
        >
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}
