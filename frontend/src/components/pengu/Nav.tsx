"use client";

import { useEffect, useState } from "react";
import { ConnectButton } from "@/components/ConnectButton";
import { ArcLogo } from "@/components/pengu/ArcLogo";

const ITEMS = [
  { id: "stats", label: "STATS" },
  { id: "contests", label: "CONTESTS" },
  { id: "how", label: "HOW IT WORKS" },
  { id: "syndicates", label: "SYNDICATES" },
  { id: "highlights", label: "HIGHLIGHTS" },
];

/// Sticky pill nav. Transparent over the hero, solid white after scroll (no blur).
/// Active section is tracked with an IntersectionObserver.
export function Nav() {
  const [active, setActive] = useState("stats");
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setActive(e.target.id);
        });
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    ITEMS.forEach((it) => {
      const el = document.getElementById(it.id);
      if (el) obs.observe(el);
    });

    return () => {
      window.removeEventListener("scroll", onScroll);
      obs.disconnect();
    };
  }, []);

  return (
    <header
      className={`sticky top-0 z-20 transition-colors duration-300 ${scrolled ? "border-b border-pengu-blue/15 bg-white" : "bg-transparent"}`}
    >
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6">
        <a href="#top" className="flex items-center gap-2 font-display text-xl uppercase text-pengu-dark">
          <ArcLogo className="h-7 w-7" />
          arc<span className="text-pengu-blue">run</span>
        </a>
        <nav className="hidden items-center gap-1 rounded-pill bg-pengu-blue/10 p-1 md:flex">
          {ITEMS.map((it) => (
            <a
              key={it.id}
              href={`#${it.id}`}
              className={`rounded-pill px-4 py-1.5 font-display text-xs uppercase tracking-wide transition-colors ${
                active === it.id ? "bg-pengu-blue text-white" : "text-pengu-blue2 hover:text-pengu-dark"
              }`}
            >
              {it.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <ConnectButton />
          <a
            href="/login"
            className="hidden rounded-pill bg-pengu-blue px-5 py-2 font-display text-xs uppercase tracking-wide text-white sm:inline-block"
          >
            enter the arena
          </a>
        </div>
      </div>
    </header>
  );
}
