"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { BracketedCell } from "@/components/redesign/BracketedCell";
import { inspectManifest } from "@/lib/agon/client";
import { presentListing } from "@/lib/agon/catalog";
import type { AgonListing } from "@/lib/agon/types";
import { UnverifiedWarning } from "./UnverifiedWarning";
import { VerificationBadge } from "./VerificationBadge";

function priceLabel(amountUSDC: string | null) {
  return amountUSDC ? `${amountUSDC} USDC / use` : "Price in service file";
}

export function ListingCard({ listing }: { listing: AgonListing }) {
  const [manifestBody, setManifestBody] = useState(listing.manifest.body);
  const [metadataState, setMetadataState] = useState<"idle" | "loading" | "ready" | "mismatch" | "error">(listing.manifest.body === undefined ? "idle" : "ready");
  const hydratedListing = useMemo(() => ({ ...listing, manifest: { ...listing.manifest, body: manifestBody } }), [listing, manifestBody]);
  const service = presentListing(hydratedListing);
  const quarantined = Boolean(listing.risk.quarantineReason);
  const metadataBlocked = metadataState === "mismatch" || metadataState === "error";
  const unavailable = listing.status !== "Listed" || quarantined || metadataBlocked;
  const tested = listing.verification.status === "Verified";
  const playgroundHref = `/agon/playground?listing=${encodeURIComponent(listing.id)}`;

  useEffect(() => {
    if (listing.manifest.body !== undefined || metadataState !== "idle") return;
    let active = true;
    setMetadataState("loading");
    void inspectManifest(listing.manifest.uri)
      .then((inspection) => {
        if (!active) return;
        if (!inspection.validation.ok) {
          setMetadataState("error");
          return;
        }
        // Keep the provider's human-facing name and logo visible even when the
        // immutable listing anchor is stale. The mismatch must still block
        // hiring, but a generic AGENT #... card hides the service a buyer is
        // trying to understand and makes recovery harder.
        setManifestBody(inspection.body);
        if (inspection.manifestHash.toLowerCase() !== listing.manifest.hash.toLowerCase()) {
          setMetadataState("mismatch");
          return;
        }
        setMetadataState("ready");
      })
      .catch(() => { if (active) setMetadataState("error"); });
    return () => { active = false; };
  }, [listing.manifest.body, listing.manifest.hash, listing.manifest.uri, metadataState]);

  return (
    <BracketedCell hover className="group flex h-full min-h-0 flex-col" pad="md">
      <div className="flex flex-col gap-5 sm:flex-row">
        <AgentLogo logoUrl={service.logoUrl} name={service.name} cacheKey={listing.version} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="truncate font-mono text-[10px] uppercase tracking-[0.16em] text-accent">{service.category.label}</div>
            <VerificationBadge status={listing.verification.status} quarantined={quarantined} />
          </div>
          <h2 className="mt-4 font-sans text-[24px] font-semibold uppercase leading-[1.02] tracking-[-0.035em] text-ink sm:text-[28px]">{service.name}</h2>
          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">
            {listing.payment.rail === "Escrow" ? "PROTECTED PROJECT" : "PAY PER USE"}
            <span aria-hidden className="mx-2">·</span>
            {listing.endpointQa.status === "passed" ? "READY TO USE" : "AVAILABILITY CHECKING"}
          </p>
        </div>
      </div>

      <p className="mt-6 line-clamp-3 min-h-[4.8em] font-sans text-[14px] leading-[1.55] text-ink-2">{service.description}</p>
      {service.tags.length > 0 ? <div className="mt-5 flex flex-wrap gap-2">{service.tags.slice(0, 3).map((tag) => <span key={tag} className="border border-[color:var(--hairline)] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-3">{tag}</span>)}</div> : null}
      {metadataState === "loading" ? <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">Checking service details</p> : null}

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4 border-y border-[color:var(--hairline)] py-4">
        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">PRICE</div>
          <div className="mt-1 font-sans text-[18px] font-medium text-ink">{priceLabel(service.amountUSDC)}</div>
        </div>
        <div className="text-right font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
          <div>{listing.payment.rail === "Escrow" ? "PROTECTED PROJECT" : "PAY PER USE"}</div>
          <div className="mt-1 text-[9px] text-ink-3">{listing.endpointQa.status === "passed" ? "RESPONDING" : "AVAILABILITY UNCHECKED"}</div>
        </div>
      </div>

      {metadataState === "mismatch" ? (
        <div className="mt-5 border-l-[3px] border-[color:var(--err)] bg-canvas-2 px-4 py-3 font-mono text-[11px] leading-relaxed text-ink-2">
          This service file changed after this version was published. The owner must publish a new version before the logo and details can be trusted.
        </div>
      ) : metadataState === "error" ? (
        <div className="mt-5 border-l-[3px] border-[color:var(--err)] bg-canvas-2 px-4 py-3 font-mono text-[11px] leading-relaxed text-ink-2">
          Service details could not be checked. Try again later before using this service.
        </div>
      ) : quarantined ? (
        <div className="mt-5"><UnverifiedWarning message={listing.risk.warning} quarantineReason={listing.risk.quarantineReason} /></div>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-6">
        <Link href={`/market/${encodeURIComponent(listing.id)}`} className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3 underline decoration-[color:var(--hairline-strong)] underline-offset-4 hover:text-ink">
          VIEW DETAILS
        </Link>
        <Link href={unavailable || tested ? `/market/${encodeURIComponent(listing.id)}` : playgroundHref} className="inline-flex min-h-11 items-center border border-ink px-4 font-mono text-[10px] uppercase tracking-[0.12em] text-ink transition-colors hover:bg-ink hover:text-[color:var(--canvas)]">
          {unavailable ? "UNAVAILABLE" : tested ? "USE SERVICE" : "TEST IN PLAYGROUND"} <span aria-hidden className="ml-2">→</span>
        </Link>
      </div>
    </BracketedCell>
  );
}

export function AgentLogo({ logoUrl, name, cacheKey }: { logoUrl: string | null; name: string; cacheKey?: string | number }) {
  const [failed, setFailed] = useState(false);
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "A";
  const resolvedLogoUrl = logoUrl && cacheKey !== undefined
    ? `${logoUrl}${logoUrl.includes("?") ? "&" : "?"}v=${encodeURIComponent(String(cacheKey))}`
    : logoUrl;
  return (
    <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden border border-[color:var(--hairline-strong)] bg-accent font-sans text-[20px] font-semibold text-accent-ink" aria-label={`${name} logo`}>
      {resolvedLogoUrl && !failed ? <img src={resolvedLogoUrl} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : initials}
    </div>
  );
}
