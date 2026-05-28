"use client";

import { usePathname } from "next/navigation";
import { LoginButton } from "@/components/pengu/LoginButton";
import { ProfileLink } from "@/components/pengu/ProfileLink";
import { ArcRunMark } from "@/components/redesign/ArcRunMark";

/// The product nav. Left: ■ ARCRUN mono wordmark with the pink square mark.
/// Center: mono caps route links separated by 32px. Right: the login button
/// (which becomes the operator profile chip once signed in). Bottom hairline.
/// 64px tall.

const ROUTES = [
  { href: "/dashboard", label: "DASHBOARD" },
  { href: "/contests", label: "CONTESTS" },
  { href: "/challenges", label: "CHALLENGES" },
  { href: "/live", label: "LIVE" },
  { href: "/leaderboard", label: "LEADERBOARD" },
  { href: "/syndicates", label: "SYNDICATES" },
];

export function TopNav() {
  const pathname = usePathname() ?? "/";

  return (
    <header className="sticky top-0 z-20 border-b border-[color:var(--hairline)] bg-canvas">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between px-6">
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

        <div className="flex items-center gap-3">
          <LoginButton />
        </div>
      </div>
    </header>
  );
}
