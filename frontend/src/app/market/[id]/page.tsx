"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

import { ServiceProof } from "@/components/agon/ServiceProof";
import { UnverifiedWarning } from "@/components/agon/UnverifiedWarning";
import { VerificationBadge } from "@/components/agon/VerificationBadge";
import { AppHeader } from "@/components/pengu/AppHeader";
import { BracketedCell } from "@/components/redesign/BracketedCell";
import { CornerMarkers } from "@/components/redesign/CornerMarkers";
import { Footer } from "@/components/redesign/Footer";
import { SectionHeader } from "@/components/redesign/SectionHeader";
import { TagButton } from "@/components/redesign/TagButton";
import { presentListing } from "@/lib/agon/catalog";
import { getListing } from "@/lib/agon/client";
import type { AgonListing } from "@/lib/agon/types";
import { assessListingAssurance, canUseEscrow, verifyManifestAnchor } from "@/lib/agon/verify";

export default function ListingDetailPage() {
  const params = useParams<{ id: string }>();
  const reference = useMemo(() => {
    try { return decodeURIComponent(params.id); } catch { return params.id; }
  }, [params.id]);
  const [listing, setListing] = useState<AgonListing | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let live = true;
    setListing(undefined);
    setError(null);
    getListing(reference)
      .then((value) => { if (live) setListing(value); })
      .catch((failure) => {
        if (!live) return;
        setListing(null);
        setError(failure instanceof Error ? failure.message : "Could not read this service.");
      });
    return () => { live = false; };
  }, [reference, reloadKey]);

  const service = listing ? presentListing(listing) : null;
  const proof = listing ? verifyManifestAnchor(listing.manifest.hash, listing.manifest.body ?? undefined) : null;
  const assurance = listing && proof ? assessListingAssurance(listing, proof) : null;
  const escrowEligible = listing && proof ? canUseEscrow(listing, proof) : false;
  const quarantined = Boolean(listing?.risk.quarantineReason);

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />
      <main>
        <section className="relative mx-auto max-w-[1400px] px-4 pt-14 sm:px-6 sm:pt-16">
          <CornerMarkers />
          <SectionHeader
            eyebrow={service && listing ? `${service.category.label} / AGENT #${listing.agentId}` : "AGON MARKET / SERVICE"}
            heading={service?.name ?? "SERVICE DETAILS"}
            subDeck={service?.description ?? "Reading the service description and trust record from the Agon catalog."}
            right={<><TagButton variant="ghost" href="/market">BACK TO MARKET</TagButton><TagButton href="/market/new">LIST A SERVICE</TagButton></>}
          />
        </section>

        <section className="mx-auto max-w-[1400px] px-4 py-10 pb-20 sm:px-6">
          {listing === undefined ? <DetailLoading /> : null}
          {error ? (
            <BracketedCell tone="cream">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--err)]">SERVICE UNAVAILABLE</div>
              <p className="mt-3 font-mono text-sm text-ink-2">{error}</p>
              <button onClick={() => setReloadKey((value) => value + 1)} className="mt-5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink underline decoration-accent underline-offset-4">RETRY</button>
            </BracketedCell>
          ) : null}

          {listing && service && proof && assurance ? (
            <div className="space-y-6">
              {listing.risk.unverified || quarantined ? (
                <UnverifiedWarning message={listing.risk.warning} quarantineReason={listing.risk.quarantineReason} />
              ) : (
                <div className="border-l-[3px] border-[color:var(--ok)] bg-canvas-2 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-3"><VerificationBadge status={listing.verification.status} /><span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Exact version scope</span></div>
                  <p className="mt-3 max-w-[90ch] font-mono text-[11px] leading-relaxed text-ink-2">Agon verified Agent #{listing.agentId}, listing {listing.listingId}, category {service.category.label}, version {listing.version}. A later version needs its own verification.</p>
                </div>
              )}

              <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
                <div className="space-y-5">
                  <BracketedCell pad="lg">
                    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[color:var(--hairline)] pb-5">
                      <div>
                        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">WHAT YOU GET</div>
                        <h2 className="mt-2 font-stencil text-[30px] uppercase leading-none text-ink sm:text-[36px]">SERVICE OVERVIEW</h2>
                      </div>
                      <VerificationBadge status={listing.verification.status} quarantined={quarantined} />
                    </div>

                    <p className="mt-6 max-w-[72ch] font-mono text-[13px] leading-[1.7] text-ink-2">{service.description}</p>

                    <dl className="mt-7 grid gap-px bg-[color:var(--hairline)] sm:grid-cols-2">
                      <OverviewFact label="CATEGORY" value={service.category.label} note={service.category.description} />
                      <OverviewFact label="PROVIDER" value={`ERC-8004 Agent #${listing.agentId}`} note="Ownership snapshot is available in technical proof." />
                      <OverviewFact label="DELIVERY" value={service.endpoint ? "External HTTPS service" : "Endpoint not indexed"} note={service.endpoint ?? "Open the manifest URL to inspect delivery details."} />
                      <OverviewFact label="VERSION" value={`Version ${listing.version}`} note={listing.status === "Listed" ? "Current listed version" : `Chain status: ${listing.status}`} />
                    </dl>

                    {service.tags.length ? (
                      <div className="mt-6">
                        <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">SKILLS AND SEARCH TERMS</div>
                        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 font-mono text-[11px] uppercase text-ink-2">
                          {service.tags.map((tag) => <span key={tag}>#{tag}</span>)}
                        </div>
                      </div>
                    ) : null}

                    {!service.hasIndexedManifest ? (
                      <div className="mt-6 border-l-[3px] border-[color:var(--warn)] bg-canvas-2 px-4 py-3 font-mono text-[11px] leading-relaxed text-ink-2">
                        The indexer currently has the immutable anchor but not the manifest body. Service name, description, endpoint, and price remain limited until manifest ingestion is enabled.
                      </div>
                    ) : null}
                  </BracketedCell>

                  <details className="border border-[color:var(--hairline-strong)] bg-canvas">
                    <summary className="cursor-pointer px-5 py-5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink sm:px-6">VIEW TECHNICAL PROOF AND PROVENANCE</summary>
                    <ServiceProof listing={listing} proof={proof} assurance={assurance} identityRegistry={null} currentOwner={null} />
                  </details>
                </div>

                <aside className="lg:sticky lg:top-24">
                  <BracketedCell tone="ink" pad="lg">
                    <div className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-60">PRICE AND ACCESS</div>
                    <div className="mt-4 font-stencil text-[36px] uppercase leading-none sm:text-[42px]">{service.amountUSDC ? `${service.amountUSDC} USDC` : "PRICE NOT INDEXED"}</div>
                    <div className="mt-7 space-y-4 border-t border-current pt-5">
                      <Readiness label="LISTING ACTIVE" ready={listing.status === "Listed"} value={listing.status === "Listed" ? "YES" : listing.status.toUpperCase()} />
                      <Readiness label="DIRECT X402" ready={listing.payment.directX402 && !quarantined} value={listing.payment.directX402 ? "DECLARED" : "NO"} />
                      <Readiness label="ESCROW PROTECTION" ready={Boolean(escrowEligible)} value={escrowEligible ? "ELIGIBLE" : "NOT AVAILABLE"} />
                    </div>

                    <button type="button" disabled className="mt-7 w-full bg-accent px-4 py-3 font-mono text-[11px] uppercase tracking-[0.14em] text-accent-ink opacity-45">
                      {quarantined ? "SERVICE BLOCKED" : "EXECUTION NOT ENABLED"}
                    </button>
                    <p className="mt-4 font-mono text-[10px] leading-relaxed opacity-65">
                      This release proves discovery and trust state. It does not pretend a payment or service call is available before the execution adapter is enabled.
                    </p>

                    <div className="mt-7 border-t border-current pt-5 font-mono text-[9px] uppercase leading-relaxed tracking-[0.1em] opacity-55">
                      Protocol category {listing.category} <span aria-hidden>·</span> Listing {listing.listingId} <span aria-hidden>·</span> Chain {listing.chainId}
                    </div>
                  </BracketedCell>
                </aside>
              </div>
            </div>
          ) : null}
        </section>
      </main>
      <Footer variant="agon" />
    </div>
  );
}

function OverviewFact({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="bg-canvas-2 p-4">
      <dt className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">{label}</dt>
      <dd className="mt-2 font-mono text-[12px] text-ink">{value}</dd>
      <dd className="mt-1 break-all font-mono text-[9px] leading-relaxed text-ink-3">{note}</dd>
    </div>
  );
}

function Readiness({ label, ready, value }: { label: string; ready: boolean; value: string }) {
  return <div className="flex items-center justify-between gap-4 font-mono text-[10px]"><span className="opacity-65">{label}</span><span className="inline-flex items-center gap-2 uppercase"><span className="h-2 w-2" style={{ background: ready ? "var(--ok)" : "var(--err)" }} />{value}</span></div>;
}

function DetailLoading() {
  return (
    <div aria-label="Loading service" className="border-y border-[color:var(--hairline)] py-10">
      <div className="font-mono text-[11px] uppercase tracking-[0.15em] text-ink-2">READING SERVICE FROM ARC...</div>
      <div className="mt-4 h-0.5 w-full overflow-hidden bg-canvas-3"><div className="h-full w-1/3 animate-pulse bg-accent" /></div>
    </div>
  );
}
