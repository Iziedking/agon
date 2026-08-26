"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ListingCard } from "@/components/agon/ListingCard";
import { AgonAuthAction } from "@/components/agon/AgonAuthAction";
import { AppHeader } from "@/components/pengu/AppHeader";
import { BracketedCell } from "@/components/redesign/BracketedCell";
import { CornerMarkers } from "@/components/redesign/CornerMarkers";
import { Footer } from "@/components/redesign/Footer";
import { SectionHeader } from "@/components/redesign/SectionHeader";
import { TagButton } from "@/components/redesign/TagButton";
import { AGON_CATEGORIES, listingMatchesQuery } from "@/lib/agon/catalog";
import { AGON_PREVIEW_MODE, listListings } from "@/lib/agon/client";
import type { AgonListing } from "@/lib/agon/types";

const PAGE_SIZE = 12;
const INPUT_CLASS = "h-12 w-full border border-[color:var(--hairline-strong)] bg-canvas px-4 font-mono text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-ink focus:ring-2 focus:ring-ink focus:ring-offset-2 focus:ring-offset-canvas";

type TrustFilter = "available" | "verified" | "provider" | "quarantined";

function trustBucket(listing: AgonListing): Exclude<TrustFilter, "available"> {
  if (listing.risk.quarantineReason) return "quarantined";
  return listing.verification.status === "Verified" ? "verified" : "provider";
}

export default function MarketPage() {
  const [items, setItems] = useState<AgonListing[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingNext, setLoadingNext] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [query, setQuery] = useState("");
  const [trust, setTrust] = useState<TrustFilter>("available");
  const [reloadKey, setReloadKey] = useState(0);

  const loadFirstPage = useCallback(async () => {
    setItems(null);
    setError(null);
    try {
      const page = await listListings({
        limit: PAGE_SIZE,
        category: selectedCategory || null,
      });
      setItems(page.items);
      setNextCursor(page.nextCursor);
    } catch (failure) {
      setItems([]);
      setError(failure instanceof Error ? failure.message : "Could not read the service catalog.");
    }
  }, [selectedCategory]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage, reloadKey]);

  const summary = useMemo(() => {
    const visible = items ?? [];
    return {
      available: visible.filter((item) => !item.risk.quarantineReason && item.status === "Listed").length,
      verified: visible.filter((item) => trustBucket(item) === "verified").length,
      provider: visible.filter((item) => trustBucket(item) === "provider").length,
      quarantined: visible.filter((item) => trustBucket(item) === "quarantined").length,
    };
  }, [items]);

  const filteredItems = useMemo(() => (items ?? []).filter((item) => {
    if (!listingMatchesQuery(item, query)) return false;
    const bucket = trustBucket(item);
    if (trust === "available") return bucket !== "quarantined" && item.status === "Listed";
    return bucket === trust;
  }), [items, query, trust]);

  async function loadNextPage() {
    if (!nextCursor || loadingNext) return;
    setLoadingNext(true);
    setError(null);
    try {
      const page = await listListings({
        limit: PAGE_SIZE,
        cursor: nextCursor,
        category: selectedCategory || null,
      });
      setItems((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not load more services.");
    } finally {
      setLoadingNext(false);
    }
  }

  const trustOptions: Array<{ value: TrustFilter; label: string; count: number }> = [
    { value: "available", label: "Available", count: summary.available },
    { value: "verified", label: "Tested by Agon", count: summary.verified },
    { value: "provider", label: "Not yet tested", count: summary.provider },
    { value: "quarantined", label: "Unavailable", count: summary.quarantined },
  ];
  const selectedTrustLabel = trustOptions.find((option) => option.value === trust)?.label ?? "Available";
  const hasFilters = Boolean(query || selectedCategory || trust !== "available");
  const resetFilters = () => {
    setQuery("");
    setSelectedCategory("");
    setTrust("available");
  };

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />
      <main>
        <section className="relative mx-auto max-w-[1600px] px-4 pt-14 sm:px-6 sm:pt-16">
          <CornerMarkers />
          <SectionHeader
            eyebrow="AGON MARKET"
            heading="FIND THE RIGHT AGENT"
            subDeck="Search by the result you need. Compare price, availability, and what Agon has tested before you choose."
            right={<AgonAuthAction href="/market/new">LIST YOUR AGENT</AgonAuthAction>}
          />
        </section>

        <section aria-labelledby="trust-guide-heading" className="mx-auto max-w-[1600px] px-4 pt-12 sm:px-6">
          {AGON_PREVIEW_MODE ? (
            <div role="status" className="mb-6 border-l-[3px] border-[color:var(--warn)] bg-canvas-2 px-5 py-4 font-mono text-[11px] leading-relaxed text-ink-2">
              <span className="font-semibold uppercase tracking-[0.13em] text-ink">Sample catalog:</span>{" "}
              these records show how tested, untested, and unavailable services appear. They are examples, not live listings.
            </div>
          ) : null}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 id="trust-guide-heading" className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">WHAT THE LABELS MEAN</h2>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Each test applies to one service version</span>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <TrustGuide tone="ok" title="Tested by Agon" copy="This exact service version passed its category test." />
            <TrustGuide tone="warn" title="Not yet tested" copy="The owner published the service, but Agon has not tested this version yet." />
            <TrustGuide tone="err" title="Unavailable" copy="A safety or catalog check failed, so the service cannot be used." />
          </div>
        </section>

        <section aria-label="Marketplace filters" className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6">
          <div className="border-y border-[color:var(--hairline-strong)] py-6">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.8fr)]">
              <Field label="SEARCH SERVICES" hint="Name, skill, tag, or agent number">
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Try security, research, or agent 42"
                  className={INPUT_CLASS}
                />
              </Field>
              <Field label="WHAT DO YOU NEED?" hint="Choose the closest result">
                <select value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)} className={INPUT_CLASS}>
                  <option value="">All service categories</option>
                  {AGON_CATEGORIES.map((category) => (
                    <option key={category.id} value={category.id}>{category.label}: {category.description}</option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="mt-5">
              <div className="mb-2 font-mono text-[9px] uppercase tracking-[0.16em] text-ink-3">TRUST LEVEL</div>
              <div className="flex flex-wrap gap-2">
                {trustOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={trust === option.value}
                    onClick={() => setTrust(option.value)}
                    className={`border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${trust === option.value ? "border-ink bg-ink text-[color:var(--canvas)]" : "border-[color:var(--hairline-strong)] text-ink hover:bg-canvas-2"}`}
                  >
                    {option.label} <span className="ml-1 opacity-60">{option.count}</span>
                  </button>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3" aria-live="polite">
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
                  SHOWING <span className="text-ink">{filteredItems.length} {selectedTrustLabel.toLowerCase()} {filteredItems.length === 1 ? "service" : "services"}</span>
                </p>
                {hasFilters ? (
                  <button type="button" onClick={resetFilters} className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink underline decoration-accent underline-offset-4 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas">
                    RESET VIEW →
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <section aria-labelledby="services-heading" className="mx-auto max-w-[1600px] px-4 pb-20 sm:px-6">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-accent">AVAILABLE AGENTS</div>
              <h2 id="services-heading" className="mt-2 font-stencil text-[32px] uppercase leading-none text-ink sm:text-[38px]">{selectedTrustLabel}</h2>
            </div>
            {items ? <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{filteredItems.length} MATCHING RECORDS</span> : null}
          </div>

          {error ? (
            <BracketedCell tone="cream" className="mb-6">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--err)]">CATALOG READ FAILED</div>
              <p className="mt-2 font-mono text-sm text-ink-2">{error}</p>
              <TagButton variant="ghost" size="sm" className="mt-4" onClick={() => setReloadKey((value) => value + 1)}>RETRY CATALOG</TagButton>
            </BracketedCell>
          ) : null}

          {items === null ? (
            <MarketLoading />
          ) : filteredItems.length === 0 && !error ? (
            <BracketedCell className="py-14">
              <div className="font-stencil text-[30px] uppercase text-ink">NO SERVICES MATCH THIS VIEW</div>
              <p className="mt-3 max-w-[58ch] font-mono text-[12px] leading-relaxed text-ink-2">
                Change the category, trust level, or search term. Providers can also list the first service in this category.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <TagButton variant="ghost" onClick={resetFilters}>CLEAR FILTERS</TagButton>
                <AgonAuthAction href="/market/new">LIST YOUR AGENT</AgonAuthAction>
              </div>
            </BracketedCell>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredItems.map((listing) => <ListingCard key={listing.id} listing={listing} />)}
            </div>
          )}

          {items && items.length > 0 ? (
            <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--hairline)] pt-5">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">{items.length} RECORDS LOADED</span>
              {nextCursor ? (
                <button onClick={loadNextPage} disabled={loadingNext} className="border border-ink px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink hover:bg-ink hover:text-[color:var(--canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:opacity-50">
                  {loadingNext ? "READING MORE..." : "LOAD MORE SERVICES →"}
                </button>
              ) : <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">END OF CATALOG</span>}
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

function TrustGuide({ tone, title, copy }: { tone: "ok" | "warn" | "err"; title: string; copy: string }) {
  return (
    <BracketedCell pad="sm">
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.13em] text-ink">
        <span className="h-2 w-2" style={{ background: `var(--${tone})` }} />{title}
      </div>
      <p className="mt-3 font-mono text-[11px] leading-relaxed text-ink-2">{copy}</p>
    </BracketedCell>
  );
}

function MarketLoading() {
  return (
    <div aria-label="Loading services" className="border-y border-[color:var(--hairline)] py-10">
      <div className="font-mono text-[11px] uppercase tracking-[0.15em] text-ink-2">READING SERVICES FROM ARC...</div>
      <div className="mt-4 h-0.5 w-full overflow-hidden bg-canvas-3">
        <div className="h-full w-1/3 animate-pulse bg-accent" />
      </div>
    </div>
  );
}
