"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { LoginButton } from "@/components/pengu/LoginButton";
import { ProfileLink } from "@/components/pengu/ProfileLink";
import { ArcRunMark } from "@/components/redesign/ArcRunMark";

/// The product nav. Left: ■ ARCRUN mono wordmark with the pink square mark.
/// Center: mono caps route links separated by 32px on desktop. Right: the
/// login button (which becomes the operator profile chip once signed in).
/// Bottom hairline. 64px tall.
///
/// Mobile (<768px): the centre route list collapses into a hamburger that
/// opens a full-width drawer below the nav. Without this users on phones
/// could not navigate at all.

const ROUTES = [
  { href: "/dashboard", label: "DASHBOARD" },
  { href: "/contests", label: "CONTESTS" },
  { href: "/challenges", label: "CHALLENGES" },
  { href: "/live", label: "LIVE" },
  { href: "/bridge", label: "BRIDGE" },
  { href: "/leaderboard", label: "LEADERBOARD" },
  { href: "/syndicates", label: "SYNDICATES" },
];

export function TopNav() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);

  // Close the drawer on route change so users don't see a stale open state
  // after navigating.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-20 border-b border-[color:var(--hairline)] bg-canvas">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-3 px-4 sm:px-6">
        <a href="/" className="inline-flex items-center text-ink">
          <ArcRunMark />
        </a>

        <nav className="hidden items-center gap-8 md:flex">
          {ROUTES.map((r) => {
            const active = pathname === r.href || pathname.startsWith(`${r.href}/`);
            return (
              <a
                key={r.href}
                href={r.href}
                className={`font-mono text-[11px] uppercase tracking-[0.16em] transition-colors duration-120 ${
                  active ? "text-ink" : "text-ink-3 hover:text-ink"
                }`}
              >
                {r.label}
              </a>
            );
          })}
          <ProfileLink />
        </nav>

        <div className="flex items-center gap-2">
          <LoginButton />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "close menu" : "open menu"}
            aria-expanded={open}
            className="flex h-9 w-9 items-center justify-center border border-[color:var(--hairline-strong)] bg-canvas font-mono text-[14px] text-ink transition-colors hover:bg-canvas-3 md:hidden"
          >
            <span aria-hidden>{open ? "×" : "≡"}</span>
          </button>
        </div>
      </div>

      {open ? (
        <div className="border-t border-[color:var(--hairline)] bg-canvas md:hidden">
          <nav className="mx-auto flex max-w-[1600px] flex-col px-4 py-2 sm:px-6">
            {ROUTES.map((r) => {
              const active = pathname === r.href || pathname.startsWith(`${r.href}/`);
              return (
                <a
                  key={r.href}
                  href={r.href}
                  className={`border-b border-[color:var(--hairline)] py-3 font-mono text-[12px] uppercase tracking-[0.16em] transition-colors last:border-0 ${
                    active ? "text-ink" : "text-ink-3"
                  }`}
                >
                  {r.label}
                </a>
              );
            })}
            <div className="border-b border-[color:var(--hairline)] py-3 last:border-0">
              <ProfileLink />
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
