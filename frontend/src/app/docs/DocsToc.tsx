"use client";

import { useEffect, useState } from "react";
import { StatusChip } from "@/components/redesign";
import { useAgonNetwork } from "@/hooks/useAgonNetwork";

/// The docs table of contents with scrollspy: as the reader scrolls, the section
/// currently in view is highlighted in the accent color so they always see where
/// they are. Uses an IntersectionObserver over the section ids; the active band
/// sits near the top of the viewport.
export function DocsToc({ items }: { items: { id: string; label: string }[] }) {
  const [active, setActive] = useState<string>(items[0]?.id ?? "");
  const { network } = useAgonNetwork();

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        // Among the sections currently crossing the active band, pick the one
        // highest on screen. If none are in the band, keep the last active so
        // the highlight never blanks out between headings.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      // Active zone: a thin band ~18% from the top of the viewport.
      { rootMargin: "-18% 0px -72% 0px", threshold: 0 },
    );

    const els = items
      .map((i) => document.getElementById(i.id))
      .filter((el): el is HTMLElement => el !== null);
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav className="sticky top-24">
      <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">ON THIS PAGE</div>
      <ul className="mt-4 flex flex-col gap-2.5 border-l border-[color:var(--hairline)] pl-4">
        {items.map((t) => {
          const isActive = active === t.id;
          return (
            <li key={t.id}>
              <a
                href={`#${t.id}`}
                aria-current={isActive ? "true" : undefined}
                className={`font-mono text-[12px] uppercase tracking-[0.10em] transition-colors hover:text-accent ${
                  isActive ? "text-accent" : "text-ink-2"
                }`}
              >
                {t.label}
              </a>
            </li>
          );
        })}
      </ul>
      <div className="mt-6">
        <StatusChip tone={network.readiness === "configured" ? "ok" : "warn"}>{network.brand} {network.environment}</StatusChip>
      </div>
    </nav>
  );
}
