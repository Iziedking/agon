"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { AgonAuthAction } from "@/components/agon/AgonAuthAction";
import { ListingCard } from "@/components/agon/ListingCard";
import { AppHeader } from "@/components/pengu/AppHeader";
import { BracketedCell } from "@/components/redesign/BracketedCell";
import { CornerMarkers } from "@/components/redesign/CornerMarkers";
import { Footer } from "@/components/redesign/Footer";
import { SectionHeader } from "@/components/redesign/SectionHeader";
import { TagButton } from "@/components/redesign/TagButton";
import { AGON_CATEGORIES, listingMatchesQuery } from "@/lib/agon/catalog";
import { AGON_PREVIEW_MODE, listListings } from "@/lib/agon/client";
import type { AgonListing } from "@/lib/agon/types";
import { useAgonNetwork } from "@/hooks/useAgonNetwork";
import { BnbMarket } from "@/components/agon/BnbMarket";

const PAGE_SIZE = 12;
const INPUT_CLASS = "h-12 w-full border border-[color:var(--hairline-strong)] bg-canvas px-4 font-mono text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-ink focus:ring-2 focus:ring-ink focus:ring-offset-2 focus:ring-offset-canvas";

type MarketView = "all" | "tested";

export default function MarketPage() {
  const { networkKey } = useAgonNetwork();
  return networkKey === "arc-testnet" ? <ArcMarketPage /> : <BnbMarket />;
}
function ArcMarketPage() {
  const { network, networkKey } = useAgonNetwork();
  const [items, setItems] = useState<AgonListing[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingNext, setLoadingNext] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<MarketView>("all");
  const [reloadKey, setReloadKey] = useState(0);

  const loadFirstPage = useCallback(async () => {
    setItems(null);
    setError(null);
    try {
      const page = await listListings({ limit: PAGE_SIZE, category: selectedCategory || null, network: networkKey });
      setItems(page.items);
      setNextCursor(page.nextCursor);
    } catch (failure) {
      setItems([]);
      setError(failure instanceof Error ? failure.message : "Could not read the service catalog.");
    }
  }, [networkKey, selectedCategory]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage, reloadKey]);

  const filteredItems = useMemo(() => (items ?? []).filter((item) => {
    if (!listingMatchesQuery(item, query)) return false;
    if (item.status !== "Listed" || item.risk.quarantineReason) return false;
    return view === "all" || item.verification.status === "Verified";
  }), [items, query, view]);

  async function loadNextPage() {
    if (!nextCursor || loadingNext) return;
    setLoadingNext(true);
    setError(null);
    try {
      const page = await listListings({ limit: PAGE_SIZE, cursor: nextCursor, category: selectedCategory || null, network: networkKey });
      setItems((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not load more services.");
    } finally {
      setLoadingNext(false);
    }
  }

  const hasFilters = Boolean(query || selectedCategory || view !== "all");
  const resetFilters = () => {
    setQuery("");
    setSelectedCategory("");
    setView("all");
  };

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />
      <main>
        <section className="relative mx-auto max-w-[1600px] px-4 pt-14 sm:px-6 sm:pt-16">
          <CornerMarkers />
          <SectionHeader
            eyebrow={`AGON MARKET / ${network.brand} ${network.environment}`}
            heading="FIND AN AGENT"
            subDeck={`Choose a service on ${network.name}, test it safely in the Playground, then use it when you are ready.`}
            right={<AgonAuthAction href="/market/new">LIST YOUR AGENT</AgonAuthAction>}
          />
        </section>

        <section aria-label="Marketplace services" className="mx-auto max-w-[1600px] px-4 pb-20 pt-10 sm:px-6 sm:pt-12">
          {AGON_PREVIEW_MODE ? (
            <div role="status" className="mb-6 border-l-[3px] border-[color:var(--warn)] bg-canvas-2 px-5 py-4 font-mono text-[11px] leading-relaxed text-ink-2">
              <span className="font-semibold uppercase tracking-[0.13em] text-ink">Sample catalog:</span>{" "}
              these are examples, not live listings.
            </div>
          ) : null}

          <div className="border-y border-[color:var(--hairline-strong)] py-5">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px_auto] lg:items-end">
              <Field label="SEARCH" hint="Name, skill, or result">
                <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="What do you need an agent to do?" className={INPUT_CLASS} />
              </Field>
              <Field label="CATEGORY" hint="All services">
                <select value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)} className={INPUT_CLASS}>
                  <option value="">All categories</option>
                  {AGON_CATEGORIES.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-2" aria-label="Service view">
                <ViewButton active={view === "all"} label="ALL" onClick={() => setView("all")} />
                <ViewButton active={view === "tested"} label="TESTED" onClick={() => setView("tested")} />
              </div>
            </div>
          </div>

          <div className="mb-5 mt-7 flex flex-wrap items-center justify-between gap-3" aria-live="polite">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
              {items ? <><span className="text-ink">{filteredItems.length}</span> service{filteredItems.length === 1 ? "" : "s"}</> : "Reading services"}
            </p>
            {hasFilters ? (
              <button type="button" onClick={resetFilters} className="inline-flex min-h-11 items-center font-mono text-[10px] uppercase tracking-[0.12em] text-ink underline decoration-accent underline-offset-4 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas">CLEAR FILTERS</button>
            ) : null}
          </div>

          {error ? (
            <BracketedCell tone="cream" className="mb-6">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--err)]">CATALOG UNAVAILABLE</div>
              <p className="mt-2 font-mono text-sm text-ink-2">{error}</p>
              <TagButton variant="ghost" size="sm" className="mt-4" onClick={() => setReloadKey((value) => value + 1)}>TRY AGAIN</TagButton>
            </BracketedCell>
          ) : null}

          {items === null ? (
            <MarketLoading />
          ) : filteredItems.length === 0 && !error ? (
            <BracketedCell className="py-14">
              <div className="font-stencil text-[30px] uppercase text-ink">NO SERVICES FOUND</div>
              <p className="mt-3 max-w-[58ch] font-mono text-[12px] leading-relaxed text-ink-2">Try another search or category. You can also list the first service for this need.</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <TagButton variant="ghost" onClick={resetFilters}>CLEAR FILTERS</TagButton>
                <AgonAuthAction href="/market/new">LIST YOUR AGENT</AgonAuthAction>
              </div>
            </BracketedCell>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {filteredItems.map((listing) => <ListingCard key={listing.id} listing={listing} />)}
            </div>
          )}

          {items && items.length > 0 ? (
            <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--hairline)] pt-5">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">{items.length} loaded</span>
              {nextCursor ? (
                <button onClick={loadNextPage} disabled={loadingNext} className="border border-ink px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink hover:bg-ink hover:text-[color:var(--canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:opacity-50">
                  {loadingNext ? "LOADING..." : "LOAD MORE"}
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      </main>
      <Footer variant="agon" />
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 flex flex-wrap items-center justify-between gap-2 font-mono uppercase">
        <span className="text-[9px] tracking-[0.16em] text-ink-3">{label}</span>
        <span className="text-[9px] normal-case tracking-normal text-ink-3">{hint}</span>
      </span>
      {children}
    </label>
  );
}

function ViewButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={`h-12 border px-4 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${active ? "border-ink bg-ink text-[color:var(--canvas)]" : "border-[color:var(--hairline-strong)] text-ink hover:bg-canvas-2"}`}>
      {label}
    </button>
  );
}

function MarketLoading() {
  return (
    <div aria-label="Loading services" className="border-y border-[color:var(--hairline)] py-10">
      <div className="font-mono text-[11px] uppercase tracking-[0.15em] text-ink-2">LOADING SERVICES...</div>
      <div className="mt-4 h-0.5 w-full overflow-hidden bg-canvas-3"><div className="h-full w-1/3 animate-pulse bg-accent" /></div>
    </div>
  );
}
