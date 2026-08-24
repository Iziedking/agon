"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useOperatorAddress } from "@/hooks/useAuth";
import { useAuth } from "@/hooks/useAuth";
import { LoginButton } from "@/components/pengu/LoginButton";
import { ProfileLink } from "@/components/pengu/ProfileLink";
import { ArcChainChip } from "@/components/redesign/ArcChainChip";
import { WalletBalanceChip } from "@/components/redesign/WalletBalanceChip";
import { ArcRunMark } from "@/components/redesign/ArcRunMark";
import { AgonMark } from "@/components/redesign/AgonMark";
import { NotificationBell } from "@/components/redesign/NotificationBell";
import { LiveMissionBanner } from "@/components/redesign/LiveMissionBanner";
import { ThemeToggle } from "@/components/redesign/ThemeToggle";
import { IS_AGON_DEPLOYMENT } from "@/lib/product";
import { useDisconnect } from "wagmi";

/// The product nav. Left: â–  ARCRUN mono wordmark with the pink square mark.
/// Center: mono caps route links separated by 32px on desktop. Right: the
/// login button (which becomes the operator profile chip once signed in).
/// Bottom hairline. 64px tall.
///
/// Mobile (<768px): the centre route list collapses into a hamburger that
/// opens a full-width drawer below the nav. Without this users on phones
/// could not navigate at all.

// Bridge is intentionally not a top-level nav item: ArcRun is an agent arena,
// not a bridge. The bridge is reached from the withdraw flow (and direct
// /bridge links), where moving USDC omnichain actually matters to the user.
const LEGACY_ROUTES = [
  { href: "/market", label: "AGON MARKET" },
  { href: "/dashboard", label: "DASHBOARD" },
  { href: "/contests", label: "CONTESTS" },
  { href: "/challenges", label: "CHALLENGES" },
  { href: "/missions", label: "MISSIONS" },
  { href: "/live", label: "LIVE" },
  { href: "/leaderboard", label: "LEADERBOARD" },
  { href: "/syndicates", label: "SYNDICATES" },
];

const AGON_ROUTES = [
  { href: "/market", label: "MARKET", exact: true },
  { href: "/agon", label: "PROTOCOL", exact: true },
  { href: "/admin", label: "OPS", exact: true },
  { href: "/app", label: "PLAYGROUND", exact: true },
  { href: "/docs", label: "DOCUMENTATION", exact: false },
];

export function TopNav() {
  const pathname = usePathname() ?? "/";
  const isLogin = pathname === "/login";
  const isAgon = IS_AGON_DEPLOYMENT || pathname === "/market" || pathname.startsWith("/market/") || pathname === "/agon";
  const routes = isAgon ? AGON_ROUTES : LEGACY_ROUTES;
  const [open, setOpen] = useState(false);
  // The marketplace is public. Keep its route links visible before sign-in so
  // discovery does not look like a gated dashboard. Legacy arena routes remain
  // session-only. `settling` covers the brief auth-resolving window so a
  // returning user does not flash the signed-out legacy nav before their
  // session loads.
  const { isSignedIn, settling } = useOperatorAddress();
  const { signOut } = useAuth();
  const { disconnect } = useDisconnect();
  const showRoutes = !isLogin && (isAgon || isSignedIn);

  // Close the drawer on route change so users don't see a stale open state
  // after navigating.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-20 border-b border-[color:var(--hairline)] bg-canvas">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" className="inline-flex items-center text-ink" aria-label="Agon home">
          {isAgon ? <AgonMark /> : <ArcRunMark />}
        </Link>

        {showRoutes ? (
        <nav className="hidden items-center gap-8 md:flex">
          {routes.map((r) => {
            const active = pathname === r.href || (!("exact" in r) || !r.exact) && pathname.startsWith(`${r.href}/`);
            return (
              <Link
                key={r.href}
                href={r.href}
                className={`font-mono text-[11px] uppercase tracking-[0.16em] transition-colors duration-120 ${
                  active ? "text-ink" : "text-ink-3 hover:text-ink"
                }`}
              >
                {r.label}
              </Link>
            );
          })}
          {isSignedIn ? <ProfileLink /> : null}
        </nav>
        ) : null}

        <div className="flex items-center gap-2">
          {isSignedIn ? (
            <>
              <WalletBalanceChip />
              <ArcChainChip />
              <NotificationBell />
              <button
                type="button"
                onClick={async () => {
                  await signOut();
                  disconnect();
                }}
                className="hidden h-10 items-center border border-[color:var(--hairline-strong)] bg-canvas px-3 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-2 transition-colors hover:bg-canvas-3 hover:text-ink sm:inline-flex"
              >
                SIGN OUT
              </button>
            </>
          ) : null}
          {!isLogin && (settling ? null : <LoginButton />)}
          <ThemeToggle />
          {!isLogin && (isAgon || isSignedIn) ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? "close menu" : "open menu"}
              aria-expanded={open}
              className="flex h-9 w-9 items-center justify-center border border-[color:var(--hairline-strong)] bg-canvas font-mono text-[14px] text-ink transition-colors hover:bg-canvas-3 md:hidden"
            >
              <span aria-hidden className="relative block h-3.5 w-4">
                <span className={`absolute left-0 top-0 block h-px w-4 bg-current transition-transform ${open ? "translate-y-[6px] rotate-45" : ""}`} />
                <span className={`absolute left-0 top-[6px] block h-px w-4 bg-current transition-opacity ${open ? "opacity-0" : ""}`} />
                <span className={`absolute left-0 top-3 block h-px w-4 bg-current transition-transform ${open ? "-translate-y-[6px] -rotate-45" : ""}`} />
              </span>
            </button>
          ) : null}
        </div>
      </div>

      {open && showRoutes ? (
        <div className="border-t border-[color:var(--hairline)] bg-canvas md:hidden">
          <nav className="mx-auto flex max-w-[1600px] flex-col px-4 py-2 sm:px-6">
            {/* balance up top: the nav chip is hidden on phones, so this is
                where mobile users see their USDC. */}
            {isSignedIn ? <WalletBalanceChip variant="row" /> : null}
            {routes.map((r) => {
              const active = pathname === r.href || (!("exact" in r) || !r.exact) && pathname.startsWith(`${r.href}/`);
              return (
                <Link
                  key={r.href}
                  href={r.href}
                  className={`border-b border-[color:var(--hairline)] py-3 font-mono text-[12px] uppercase tracking-[0.16em] transition-colors last:border-0 ${
                    active ? "text-ink" : "text-ink-3"
                  }`}
                >
                  {r.label}
                </Link>
              );
            })}
            {isSignedIn ? (
              <div className="border-b border-[color:var(--hairline)] py-3 last:border-0">
                <ProfileLink />
              </div>
            ) : null}
            {isSignedIn ? (
              <button
                type="button"
                onClick={async () => {
                  await signOut();
                  disconnect();
                  setOpen(false);
                }}
                className="border-b border-[color:var(--hairline)] py-3 text-left font-mono text-[12px] uppercase tracking-[0.16em] text-ink-2 last:border-0 hover:text-ink"
              >
                SIGN OUT
              </button>
            ) : null}
          </nav>
        </div>
      ) : null}

      {isAgon ? null : <LiveMissionBanner />}
    </header>
  );
}
