"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { fetchMissions, formatUsdc6, type MissionListItem } from "@/lib/missions";

/// A thin global alert bar, shown under the nav the moment a mission goes live,
/// so a heavily-funded mission is never missed even if you are on another page.
/// Polls the mission index; "live" follows the contest (open or scoring), with a
/// status fallback. Hidden on the mission's own arena, and dismissible per
/// mission (a new mission re-shows it).
export function LiveMissionBanner() {
  const pathname = usePathname() ?? "/";
  const [live, setLive] = useState<MissionListItem | null>(null);
  const [dismissed, setDismissed] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const rows = await fetchMissions();
      if (!alive) return;
      setLive(rows.find((r) => r.live ?? r.status === "open") ?? null);
    };
    void load();
    const t = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!live) return null;
  if (pathname === `/missions/${live.contestId}`) return null;
  if (dismissed === live.contestId) return null;

  return (
    <div className="border-b border-[color:var(--hairline)] bg-canvas-2">
      <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-2 sm:px-6">
        <span aria-hidden className="text-accent">
          ■
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink">MISSION LIVE</span>
        <span className="hidden min-w-0 truncate font-mono text-[11px] text-ink-2 sm:inline">
          {live.title} · {formatUsdc6(live.spent6) === "0.00 USDC" ? "open now" : `${live.operatives} in`}
        </span>
        <Link
          href={`/missions/${live.contestId}`}
          className="ml-auto font-mono text-[11px] uppercase tracking-[0.12em] text-accent hover:underline"
        >
          ENTER ARENA →
        </Link>
        <button
          type="button"
          onClick={() => setDismissed(live.contestId)}
          aria-label="dismiss"
          className="font-mono text-[14px] leading-none text-ink-3 hover:text-ink"
        >
          ×
        </button>
      </div>
    </div>
  );
}
