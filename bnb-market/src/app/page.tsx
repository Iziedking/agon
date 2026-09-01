"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";

import { MarketShell } from "@/components/bnb/MarketShell";
import { buildMarketSearch, listCategoriesForChain, readMarketQuery } from "@/lib/bnb/market-query";
import { BNB_MAINNET_ID, type BnbChainId } from "@/lib/bnb/chains";

export default function Home() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = useMemo(() => readMarketQuery(searchParams), [searchParams]);
  const chainId = state.chainId;
  const category = state.category;
  const networkLabel = useMemo(
    () => (chainId === BNB_MAINNET_ID ? "BNB Mainnet • live focus" : "BNB Testnet • rehearsal"),
    [chainId],
  );
  const categoryCards = useMemo(() => listCategoriesForChain(chainId), [chainId]);

  function setChain(nextChainId: BnbChainId) {
    const next = buildMarketSearch({
      ...state,
      chainId: nextChainId,
    });
    router.push(`${pathname}?${next.toString()}`);
  }

  const isCategoryFiltered = category !== "all";

  return (
    <MarketShell chainId={chainId} onChainChange={setChain}>
      <section className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
        <div className="mb-4 text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-3)]">
          BNB Market · {networkLabel}
        </div>
        <h1 className="max-w-[16ch] text-4xl font-semibold sm:text-5xl">Choose an agent that protects your position in 1 minute</h1>
        <p className="mt-4 max-w-[70ch] leading-relaxed text-[color:var(--ink-2)]">
          Pick an outcome, compare what each agent can do, and continue only when chain, authority, and evidence are clear.
        </p>

        <div className="mt-6 inline-flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.13em]">
          <span className="rounded-sm border border-[color:var(--hairline)] px-3 py-2 text-[color:var(--ok)]">Data-first flow</span>
          <span className="rounded-sm border border-[color:var(--hairline)] px-3 py-2 text-[color:var(--warn)]">No dead ends</span>
          <span className="rounded-sm border border-[color:var(--hairline)] px-3 py-2 text-[color:var(--accent)]">Mainnet is active</span>
        </div>

          {isCategoryFiltered ? (
          <div className="mt-6 rounded-sm border border-[color:var(--hairline)] bg-[color:var(--canvas-2)] px-4 py-3 text-sm">
            Category filter active: <strong>{category}</strong>
            <Link href="/" className="ml-2 underline underline-offset-4">
              Clear filter
            </Link>
          </div>
        ) : null}

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {categoryCards.map((entry) => (
            <Link
              key={entry.id}
              href={`/market?chain=${chainId}&category=${entry.id}`}
              className="block rounded-sm border border-[color:var(--hairline)] p-4 transition hover:border-[color:var(--hairline-strong)]"
            >
              <p className="text-[11px] uppercase tracking-[0.15em] text-[color:var(--ok)]">
                {entry.count} ready
              </p>
              <h2 className="mt-2 text-2xl font-semibold">{entry.name}</h2>
              <p className="mt-2 text-sm text-[color:var(--ink-2)]">{entry.oneLineGoal}</p>
              <p className="mt-4 text-xs uppercase tracking-[0.12em] text-[color:var(--ink-3)]">Open category →</p>
            </Link>
          ))}
        </div>

        <div className="mt-8 text-sm text-[color:var(--ink-2)]">
          <p>
            Want to list an agent? <Link href={`/market/new?chain=${chainId}`} className="underline underline-offset-4">Start listing</Link>.
          </p>
          <p className="mt-2">
            Need to compare all categories first?{" "}
            <Link href={`/market?chain=${chainId}&category=all`} className="underline underline-offset-4">
              Open the full market
            </Link>
          </p>
        </div>

        <section className="mt-12 border-y border-[color:var(--hairline)] py-8">
          <h2 className="text-2xl font-semibold">Judge journey starts here</h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {categoryCards.map((entry) => (
              <li key={entry.id} className="border border-[color:var(--hairline)] p-4">
                <h3 className="text-sm font-semibold uppercase tracking-[0.12em]">{entry.name}</h3>
                <p className="mt-2 text-sm text-[color:var(--ink-2)]">{entry.prompt}</p>
              </li>
            ))}
          </ul>
        </section>
      </section>
    </MarketShell>
  );
}
