"use client";

import { useEffect, useState } from "react";
import { Marquee } from "@/components/pengu/Marquee";
import { describeActivity, fetchActivity, type ActivityEvent } from "@/lib/activity";

/// A compact, scrolling band of recent arena events for the landing page. Shows
/// nothing while empty so the home doesn't render a hollow strip; once events
/// arrive they loop infinitely via Marquee and refresh every 10s.
export function HomeActivityStrip() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);

  useEffect(() => {
    let stop = false;
    async function load() {
      const e = await fetchActivity(24);
      if (!stop) setEvents(e);
    }
    load();
    const t = setInterval(load, 10000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  if (events.length === 0) return null;

  return (
    <section className="mx-auto max-w-[1200px] px-6 py-10">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-[#22c55e] animate-pulse-live" />
        <span className="font-display text-xs uppercase tracking-wide text-pengu-blue">live on the arena</span>
      </div>

      <div className="mt-4">
        <Marquee duration={90}>
          {events.map((ev, i) => {
            const d = describeActivity(ev);
            return (
              <a
                key={`${ev.txHash}-${i}`}
                href={d.href}
                className="flex flex-none items-center gap-2 rounded-full border border-pengu-blue/15 bg-white px-4 py-2 shadow-[0_4px_12px_rgba(70,45,150,0.05)] transition-transform duration-150 hover:-translate-y-0.5"
              >
                <span className="rounded-full bg-pengu-blue/10 px-2 py-0.5 font-display text-[10px] uppercase tracking-wide text-pengu-blue">
                  {d.label}
                </span>
                <span className="whitespace-nowrap font-mono text-xs text-pengu-dark/75">{d.text}</span>
              </a>
            );
          })}
        </Marquee>
      </div>
    </section>
  );
}
