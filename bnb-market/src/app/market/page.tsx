"use client";

import { Suspense, useMemo, useState, type ChangeEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { MarketShell } from "@/components/bnb/MarketShell";
import { ServiceCard } from "@/components/bnb/ServiceCard";
import { BNB_CATEGORIES, type BnbCategory } from "@/lib/bnb/catalog";
import { BNB_MARKET_CONFIG } from "@/lib/bnb/feature-flags";
import { readMarketQuery, buildMarketSearch, listCategoriesForChain, listServicesForQuery, type MarketQueryState } from "@/lib/bnb/market-query";
import { type BnbChainId } from "@/lib/bnb/chains";
import { addCompareId, removeCompareId, serializeCompareIds } from "@/lib/bnb/compare";

function MarketContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const state = useMemo(() => readMarketQuery(searchParams), [searchParams]);
  const [query, setQuery] = useState(state.query);
  const [activatableOnly, setActivatableOnly] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const chainId = state.chainId;
  const selectedCategory = state.category;

  const queryState = useMemo<MarketQueryState>(() => ({
    chainId,
    category: selectedCategory,
    query,
    activatableOnly,
  }), [chainId, selectedCategory, query, activatableOnly]);

  const categoryStats = useMemo(() => listCategoriesForChain(chainId), [chainId]);
  const allServices = useMemo(() => listServicesForQuery(queryState), [queryState]);
  const listingEnabled = BNB_MARKET_CONFIG.DEFAULT_LISTING_ENABLED;

  function updateSearch(next: MarketQueryState) {
    const params = buildMarketSearch(next);
    router.push(`${pathname}?${params.toString()}`);
  }

  function setChain(nextChainId: BnbChainId) {
    setCompareIds([]);
    updateSearch({
      ...queryState,
      chainId: nextChainId,
    });
  }

  function setCategory(value: BnbCategory | "all") {
    updateSearch({
      ...queryState,
      category: value,
    });
  }

  function handleQueryChange(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.value;
    setQuery(next);
    updateSearch({
      ...queryState,
      query: next,
    });
  }

  function clearFilters() {
    setQuery("");
    setActivatableOnly(false);
    updateSearch({
      chainId,
      category: "all",
      query: "",
      activatableOnly: false,
    });
  }

  function toggleActivatableOnly() {
    const next = !activatableOnly;
    setActivatableOnly(next);
    updateSearch({
      ...queryState,
      activatableOnly: next,
    });
  }

  function toggleCompare(serviceId: string) {
    setCompareIds((current) => {
      if (current.includes(serviceId)) return removeCompareId(current, serviceId);
      return addCompareId(current, serviceId);
    });
  }

  if (!listingEnabled) {
    return (
      <MarketShell chainId={chainId} onChainChange={setChain}>
        <section className="mx-auto w-full max-w-[1200px] px-4 py-10 sm:px-6">
          <h1 className="text-3xl font-semibold sm:text-4xl">Marketplace disabled in this build</h1>
          <p className="mt-2 max-w-[68ch] text-sm text-[color:var(--ink-2)]">
            Listing view is intentionally gated by configuration. Enable `NEXT_PUBLIC_BNB_MARKET_LISTING_ENABLED=true` in the active environment
            once catalog ingestion is connected.
          </p>
          <a
            href="/"
            className="mt-5 inline-flex h-11 items-center rounded-sm border border-[color:var(--hairline-strong)] px-4 text-sm underline underline-offset-4"
          >
            Return to discovery
          </a>
        </section>
      </MarketShell>
    );
  }

  const showNoData = allServices.length === 0;

  return (
    <MarketShell chainId={chainId} onChainChange={setChain}>
      <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6">
        <section className="border-b border-[color:var(--hairline)] pb-6">
          <h1 className="text-3xl font-semibold sm:text-4xl">Browse live agents</h1>
          <p className="mt-2 max-w-[70ch] text-sm text-[color:var(--ink-2)]">
            Switch network first, then filter by outcome. Every row must show proof status, authority, and price before activation.
          </p>
        </section>

        <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-[0.15em] text-[color:var(--ink-3)]">Search</span>
            <input
              value={query}
              onChange={handleQueryChange}
              className="h-11 w-full rounded-sm border border-[color:var(--hairline-strong)] bg-[color:var(--canvas)] px-3 text-sm"
              placeholder="Name, provider, or outcome"
              aria-label="Search marketplace"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-[0.15em] text-[color:var(--ink-3)]">Category</span>
            <select
              value={selectedCategory}
              onChange={(event) => setCategory(event.target.value as BnbCategory | "all")}
              className="h-11 w-full rounded-sm border border-[color:var(--hairline-strong)] bg-[color:var(--canvas)] px-3 text-sm"
              aria-label="Filter by category"
            >
              <option value="all">All categories</option>
              {BNB_CATEGORIES.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name} ({categoryStats.find((item) => item.id === category.id)?.count || 0})
                </option>
              ))}
            </select>
          </label>

          <label className="block self-end">
            <span className="mb-1 block text-[10px] uppercase tracking-[0.15em] text-[color:var(--ink-3)]">State</span>
            <button
              type="button"
              onClick={toggleActivatableOnly}
              className="inline-flex h-11 w-full items-center justify-start rounded-sm border border-[color:var(--hairline-strong)] px-3 text-sm"
            >
              {activatableOnly ? "Showing only activatable" : "Showing all states"}
            </button>
          </label>

          <div className="flex items-end">
            {(query || selectedCategory !== "all" || activatableOnly) ? (
              <button
                type="button"
                onClick={clearFilters}
                className="h-11 rounded-sm border border-[color:var(--hairline-strong)] px-4 text-sm underline underline-offset-4"
              >
                Clear filters
              </button>
            ) : null}
          </div>
        </section>

        <section className="mt-6">
          <div className="mb-4 text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink-3)]">
            Showing {allServices.length} service{allServices.length === 1 ? "" : "s"}
          </div>

          {showNoData ? (
            <div className="rounded-sm border border-[color:var(--hairline)] bg-[color:var(--canvas-2)] p-5 text-sm">
              No matching agents. Try clearing filters, switching network, or checking another category.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {allServices.map((service) => (
                <ServiceCard
                  key={service.id}
                  service={service}
                  chainSlug={String(chainId)}
                  compareSelected={compareIds.includes(service.id)}
                  compareDisabled={compareIds.length >= 3}
                  onToggleCompare={toggleCompare}
                />
              ))}
            </div>
          )}
        </section>

        {compareIds.length > 0 ? (
          <aside className="sticky bottom-3 z-10 mt-6 flex flex-wrap items-center justify-between gap-3 border border-[color:var(--hairline-strong)] bg-[color:var(--canvas-2)] p-3 shadow-sm">
            <p className="text-sm">
              {compareIds.length} of 3 comparison slot{compareIds.length === 1 ? "" : "s"} selected.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setCompareIds([])}
                className="inline-flex min-h-11 items-center rounded-sm border border-[color:var(--hairline-strong)] px-3 text-xs uppercase tracking-[0.12em]"
              >
                Clear
              </button>
              <a
                href={`/market/compare?chain=${chainId}&ids=${encodeURIComponent(serializeCompareIds(compareIds))}`}
                className="inline-flex min-h-11 items-center rounded-sm bg-[color:var(--accent)] px-4 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--accent-ink)]"
              >
                Compare selected
              </a>
            </div>
          </aside>
        ) : null}
      </div>
    </MarketShell>
  );
}

export default function Market() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas p-6 text-sm text-ink-2">Loading market…</div>}>
      <MarketContent />
    </Suspense>
  );
}
