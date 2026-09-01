"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { MarketShell } from "@/components/bnb/MarketShell";
import { BNB_MARKET_CONFIG } from "@/lib/bnb/feature-flags";
import { type BnbChainId } from "@/lib/bnb/chains";
import { readMarketQuery, buildMarketSearch } from "@/lib/bnb/market-query";

export default function NewListingPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const chainId = readMarketQuery(searchParams).chainId;
  const isAgonPrepared = searchParams.get("source") === "agon";
  const [acknowledged, setAcknowledged] = useState(false);
  const listingEnabled = BNB_MARKET_CONFIG.DEFAULT_LISTING_ENABLED;

  const checkState = useMemo(
    () => (acknowledged ? "ready" : "needs-confirm"),
    [acknowledged],
  );

  function setChain(nextChainId: BnbChainId) {
    const next = buildMarketSearch({
      chainId: nextChainId,
      category: "all",
      query: "",
      activatableOnly: false,
    });
    router.push(`${pathname}?${next.toString()}`);
  }

  if (!listingEnabled) {
    return (
      <MarketShell chainId={chainId} onChainChange={setChain}>
        <section className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
          <h1 className="text-3xl font-semibold sm:text-4xl">List flow is currently disabled</h1>
          <p className="mt-2 text-sm text-[color:var(--ink-2)]">
            This route is intentionally read-only in the current environment. Set
            <code className="mx-2 rounded-sm bg-[color:var(--canvas-2)] px-2 py-1 text-[11px]">NEXT_PUBLIC_BNB_MARKET_LISTING_ENABLED=true</code>
            to continue.
          </p>
          <Link href="/" className="mt-5 inline-flex h-11 items-center rounded-sm border border-[color:var(--hairline-strong)] px-5 text-sm">
            Return to discovery
          </Link>
        </section>
      </MarketShell>
    );
  }

  return (
    <MarketShell chainId={chainId} onChainChange={setChain}>
      <section className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
        <h1 className="text-3xl font-semibold sm:text-4xl">List an agent on BNB Market</h1>
        <p className="mt-2 text-sm text-[color:var(--ink-2)]">
          This page is the public first-screen entry for the listing flow. We only expose the steps below until identity, evidence, and rail checks are verified.
        </p>

        <div className="mt-6 rounded-sm border border-[color:var(--hairline)] bg-[color:var(--canvas-2)] p-5">
          <p className="text-sm uppercase tracking-[0.14em] text-[color:var(--ink-3)]">Current mode</p>
          <h2 className="mt-2 text-2xl font-semibold">
            {isAgonPrepared ? "Reference-ready provider route" : "Self-serve onboarding route"}
          </h2>
          <p className="mt-2 text-sm text-[color:var(--ink-2)]">
            We keep the public path explicit. No service can be activated from this route.
            You can use this screen to prepare intent, manifest pointers, and authority boundaries.
          </p>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <article className="rounded-sm border border-[color:var(--hairline)] p-4">
            <h2 className="text-lg font-semibold">1) Prepare listing details</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-[color:var(--ink-2)]">
              <li>Set target outcome and category.</li>
              <li>Define endpoint, response schema, and expected authority.</li>
              <li>Upload the exact manifest to permanent storage.</li>
            </ul>
          </article>
          <article className="rounded-sm border border-[color:var(--hairline)] p-4">
            <h2 className="text-lg font-semibold">2) Publish only after checks</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-[color:var(--ink-2)]">
              <li>Verify chain ownership and endpoint health.</li>
              <li>Capture ownership proof and replay-safe reference data.</li>
              <li>Prepare transaction intent with chain and method constraints.</li>
            </ul>
          </article>
          <article className="rounded-sm border border-[color:var(--hairline)] p-4">
            <h2 className="text-lg font-semibold">3) Sign with approval</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-[color:var(--ink-2)]">
              <li>Approve once to submit the prepared intent.</li>
              <li>Store receipt proof and method details in the listing details panel.</li>
              <li>Publish state moves only after external proof is in place.</li>
            </ul>
          </article>
          <article className="rounded-sm border border-[color:var(--hairline)] p-4">
            <h2 className="text-lg font-semibold">Checklist</h2>
            <label className="mt-3 block">
              <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
              <span className="ml-2 text-sm">
                I confirm every action stays user-owned and no fake evidence is shown.
              </span>
            </label>
            <p className="mt-3 text-sm text-[color:var(--ink-2)]">
              {checkState === "needs-confirm"
                ? "Checklist must be accepted before you can begin publishing."
                : "Checklist accepted. Route state is ready for live connector wiring."}
            </p>
          </article>
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={!acknowledged}
            className="inline-flex h-11 items-center rounded-sm border border-[color:var(--hairline-strong)] px-5 text-sm disabled:cursor-not-allowed disabled:opacity-40"
          >
            Connect connector and continue
          </button>
          <Link href={`/market?chain=${chainId}`} className="inline-flex h-11 items-center rounded-sm border border-[color:var(--hairline-strong)] px-5 text-sm">
            Back to market
          </Link>
          <a
            href="https://www.bnbchain.org/en/blog/build-the-era-build-the-official-bnb-agent-studio-marketplace"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 items-center rounded-sm px-5 text-sm text-[color:var(--ink-3)] underline underline-offset-4"
          >
            Track rules
          </a>
        </div>
      </section>
    </MarketShell>
  );
}
