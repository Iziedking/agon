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
        if (inspection.manifestHash.toLowerCase() !== listing.manifest.hash.toLowerCase()) {
          setMetadataState("mismatch");
          return;
        }
        setManifestBody(inspection.body);
        setMetadataState("ready");
      })
      .catch(() => { if (active) setMetadataState("error"); });
    return () => { active = false; };
  }, [listing.manifest.body, listing.manifest.hash, listing.manifest.uri, metadataState]);

  return (
    <BracketedCell hover className="group flex min-h-0 flex-col" pad="md">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <AgentLogo logoUrl={service.logoUrl} name={service.name} cacheKey={listing.version} />
          <div className="min-w-0">
            <div className="truncate font-mono text-[10px] uppercase tracking-[0.16em] text-accent">{service.category.label}</div>
            <div className="mt-1 font-mono text-[10px] text-ink-3">ERC-8004 #{listing.agentId}</div>
          </div>
        </div>
        <VerificationBadge status={listing.verification.status} quarantined={quarantined} />
      </div>

      <h2 className="mt-6 font-stencil text-[28px] uppercase leading-[1.02] text-ink sm:text-[32px]">{service.name}</h2>
      <p className="mt-3 line-clamp-2 min-h-[3.3em] font-mono text-[12px] leading-[1.65] text-ink-2">{service.description}</p>
      {metadataState === "loading" ? <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">Checking service details</p> : null}

      {service.tags.length ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {service.tags.slice(0, 3).map((tag) => <span key={tag} className="border border-[color:var(--hairline-strong)] px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-3">{tag}</span>)}
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-2 gap-px border border-[color:var(--hairline)] bg-[color:var(--hairline)]">
        <Fact label="PRICE" value={priceLabel(service.amountUSDC)} />
        <Fact label="USE" value={listing.payment.rail === "Escrow" ? "Protected project" : "Pay per use"} warning={listing.payment.rail === "Escrow" && !listing.payment.escrowEligible} />
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
      ) : listing.risk.unverified ? (
        <div className="mt-5 border-l-[3px] border-[color:var(--warn)] bg-canvas-2 px-4 py-3 font-mono text-[11px] leading-relaxed text-ink-2">
          The owner listed this service. Try it first, then decide whether it fits your work.
        </div>
      ) : (
        <div className="mt-5 border-l-[3px] border-[color:var(--ok)] bg-canvas-2 px-4 py-3 font-mono text-[11px] leading-relaxed text-ink-2">
          Tested by Agon for this service version. A changed version is tested separately.
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--hairline)] pt-5">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{metadataState === "loading" ? "LOADING SERVICE" : unavailable ? "UNAVAILABLE" : "AVAILABLE"}</span>
        <Link href={`/market/${encodeURIComponent(listing.id)}`} className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink underline decoration-accent underline-offset-4 hover:text-accent">
          {quarantined ? "VIEW DETAILS" : "TRY SERVICE"} &gt;
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
    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden border border-[color:var(--hairline-strong)] bg-pink font-mono text-[13px] text-white" aria-label={`${name} logo`}>
      {resolvedLogoUrl && !failed ? <img src={resolvedLogoUrl} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : initials}
    </div>
  );
}

function Fact({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return (
    <div className="min-w-0 bg-canvas-2 px-4 py-3">
      <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">{label}</div>
      <div className={`mt-1 truncate font-mono text-[11px] ${warning ? "text-[color:var(--err)]" : "text-ink"}`} title={value}>{value}</div>
    </div>
  );
}
