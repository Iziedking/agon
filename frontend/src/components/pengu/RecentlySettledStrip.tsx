"use client";

import { useEffect, useState } from "react";
import { CONTEST_TYPE, fetchContests, formatUsdc, type Contest } from "@/lib/contests";

/// A small panel under the live contest panel that lists the four most recent
/// settled contests with their prize pool and a click-through to the detail
/// page. Keeps /live useful even when nothing is currently scoring: there's
/// always recent activity to surface.
export function RecentlySettledStrip() {
  const [items, setItems] = useState<Contest[] | null>(null);

  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const cs = await fetchContests();
        if (!live) return;
        // fetchContests returns newest-first; settled contests are status 3.
        setItems(cs.filter((c) => c.status === 3).slice(0, 4));
      } catch {
        if (live) setItems([]);
      }
    }
    void load();
    const t = setInterval(load, 30000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  if (!items || items.length === 0) return null;

  return (
    <div className="rounded-card border border-pengu-blue/15 bg-pengu-card p-6 shadow-[0_10px_30px_rgba(70,45,150,0.08)]">
      <div className="flex items-center justify-between">
        <span className="font-bubble text-lg uppercase text-pengu-dark">recently settled</span>
        <a href="/contests" className="font-display text-xs uppercase tracking-wide text-pengu-blue hover:underline">
          all →
        </a>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {items.map((c) => (
          <a
            key={c.id}
            href={`/contests/${c.id}`}
            className="flex items-center justify-between gap-3 rounded-xl border border-pengu-blue/10 bg-pengu-bg px-3 py-3 transition-transform duration-150 hover:-translate-y-0.5"
          >
            <span className="min-w-0">
              <span className="font-display text-[10px] uppercase tracking-wide text-pengu-blue">
                {CONTEST_TYPE[c.contestType] ?? "contest"}
              </span>
              <div className="font-mono text-sm text-pengu-dark">contest #{c.id}</div>
            </span>
            <span className="font-mono text-sm text-pengu-blue">{formatUsdc(c.prizePool)}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
