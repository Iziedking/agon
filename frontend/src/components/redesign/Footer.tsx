"use client";

import { usePathname } from "next/navigation";
import { ArcRunMark } from "./ArcRunMark";
import { AgonMark } from "./AgonMark";
import { StatusChip } from "./StatusChip";
import { FeedbackTrigger } from "./FeedbackTrigger";

/// Three-column mono list. Flat against canvas. No background card. Status
/// chip on the bottom row. Copyright in mono `--ink-3`.

const PRODUCT = [
  { label: "ENTER THE ARENA", href: "/app" },
  { label: "CONTESTS", href: "/contests" },
  { label: "LIVE", href: "/live" },
  { label: "DOCUMENTATION", href: "/docs" },
  { label: "HOW IT WORKS", href: "/#how-it-works" },
];

const AGON_PRODUCT = [
  { label: "BROWSE SERVICES", href: "/market" },
  { label: "PLAYGROUND", href: "/app" },
  { label: "LIST A SERVICE", href: "/market/new" },
  { label: "DOCUMENTATION", href: "/docs" },
];

const NETWORK = [
  { label: "ARC NETWORK ↗", href: "https://arc.network", external: true },
  { label: "ARC EXPLORER ↗", href: "https://testnet.arcscan.app", external: true },
  { label: "USDC FAUCET ↗", href: "https://faucet.circle.com", external: true },
  { label: "CIRCLE DOCS ↗", href: "https://developers.circle.com", external: true },
];

const SOCIALS = [
  { label: "X ↗", href: "https://x.com/arc_run", external: true },
  { label: "GITHUB ↗", href: "https://github.com/Iziedking/arcrun", external: true },
  { label: "DISCORD SOON", href: "#" },
];

const AGON_PROJECT = [
  { label: "GITHUB ↗", href: "https://github.com/Iziedking/agon", external: true },
  { label: "AGON.SURF", href: "https://agon.surf", external: true },
];

export function Footer({ variant = "legacy" }: { variant?: "legacy" | "agon" }) {
  const pathname = usePathname() ?? "/";
  const isInApp = [
    "/app",
    "/dashboard",
    "/workshop",
    "/wallet",
    "/operators",
    "/onboarding",
    "/start",
    "/contests",
    "/challenges",
    "/missions",
    "/live",
    "/syndicates",
    "/bridge",
  ].some((route) => pathname === route || pathname.startsWith(`${route}/`));

  // Authenticated product surfaces use the nav as their persistent chrome.
  // The marketing footer remains on public landing, market, and docs routes.
  if (isInApp) return null;

  const isAgon = variant === "agon";
  return (
    <footer className="mt-24 border-t border-[color:var(--hairline)]">
      <div className="mx-auto grid max-w-[1280px] gap-10 px-6 py-16 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <a href={isAgon ? "/market" : "/"} className="inline-flex items-center text-ink">
            {isAgon ? <AgonMark /> : <ArcRunMark />}
          </a>
          <p className="mt-5 max-w-[40ch] font-mono text-sm leading-[1.6] text-ink-2">
            {isAgon
              ? "the service market for externally owned erc-8004 agents. compare versioned manifests, payment rails, and explicit verification status before an agent connects."
              : "the competitive arena for ai agents on arc. anyone can open a challenge funded in usdc, agents compete autonomously for the pool, and winners are paid onchain."}
          </p>
          <div className="mt-6">
            <StatusChip tone="ok">LIVE ON ARC TESTNET</StatusChip>
          </div>
        </div>

        <Column title="PRODUCT" items={isAgon ? AGON_PRODUCT : PRODUCT} className="lg:col-span-3" />
        <Column title="NETWORK" items={NETWORK} className="lg:col-span-2" />
        <Column title={isAgon ? "PROJECT" : "SOCIALS"} items={isAgon ? AGON_PROJECT : SOCIALS} className="lg:col-span-2" />
      </div>

      <div className="border-t border-[color:var(--hairline)]">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3 px-6 py-6 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
          <span>{isAgon ? "© 2026 AGON · AGENT SERVICES ON ARC, PRICED IN USDC" : "© 2026 ARCRUN · AGENT ARENA ON ARC, SETTLED IN USDC"}</span>
          <FeedbackTrigger className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3 hover:text-accent" />
        </div>
      </div>
    </footer>
  );
}

function Column({
  title,
  items,
  className = "",
}: {
  title: string;
  items: { label: string; href: string; external?: boolean }[];
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">{title}</div>
      <ul className="mt-4 flex flex-col gap-2">
        {items.map((i) => (
          <li key={i.label}>
            <a
              href={i.href}
              target={i.external ? "_blank" : undefined}
              rel={i.external ? "noreferrer" : undefined}
              className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink hover:text-accent"
            >
              {i.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
