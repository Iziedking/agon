"use client";

import { useEffect, useState } from "react";
import { TagButton } from "@/components/redesign";
import { fetchMission } from "@/lib/missions";

/// Shown on a contest detail page when that contest is actually a mission. It
/// probes the missions endpoint client-side and, if present, surfaces a banner
/// routing to the mission arena. Renders nothing for an ordinary contest.
export function MissionBanner({ contestId }: { contestId: number }) {
  const [title, setTitle] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchMission(contestId).then((s) => {
      if (live && s?.mission) setTitle(s.mission.title);
    });
    return () => {
      live = false;
    };
  }, [contestId]);

  if (title === null) return null;

  return (
    <div className="mb-8 flex flex-wrap items-center justify-between gap-3 border border-[color:var(--hairline)] bg-canvas-2 px-5 py-4">
      <div className="flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.12em] text-ink">
        <span aria-hidden className="text-accent">■</span>
        THIS CONTEST IS A MISSION · {title}
      </div>
      <TagButton href={`/missions/${contestId}`} size="sm">
        VIEW MISSION ARENA
      </TagButton>
    </div>
  );
}
