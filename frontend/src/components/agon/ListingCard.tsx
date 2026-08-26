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
  return amountUSDC ? `${amountUSDC} USDC` : "Price in manifest";
}

export function ListingCard({ listing }: { listing: AgonListing }) {
  const [manifestBody, setManifestBody] = useState(listing.manifest.body);
  const [metadataState, setMetadataState] = useState<"idle" | "loading" | "ready">(listing.manifest.body === undefined ? "idle" : "ready");
  const hydratedListing = useMemo(() => ({ ...listing, manifest: { ...listing.manifest, body: manifestBody } }), [listing, manifestBody]);
  const service = presentListing(hydratedListing);
  const quarantined = Boolean(listing.risk.quarantineReason);
  const unavailable = listing.status !== "Listed" || quarantined;

  useEffect(() => {
    if (listing.manifest.body !== undefined || metadataState !== "idle") return;
    let active = true;
    setMetadataState("loading");
    void inspectManifest(listing.manifest.uri)
      .then((inspection) => {
        if (!active) return;
        if (inspection.validation.ok && inspection.manifestHash.toLowerCase() === listing.manifest.hash.toLowerCase()) setManifestBody(inspection.body);
        setMetadataState("ready");
      })
      .catch(() => { if (active) setMetadataState("ready"); });
    return () => { active = false; };
  }, [listing.manifest.body, listing.manifest.hash, listing.manifest.uri, metadataState]);

  return (
    <BracketedCell hover className="flex min-h-[360px] flex-col" pad="md">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <AgentLogo logoUrl={service.logoUrl} name={service.name} />
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">
            {service.category.label} <span aria-hidden>·</span> Agent #{listing.agentId}
          </div>
        </div>
        <VerificationBadge status={listing.verification.status} quarantined={quarantined} />
      </div>

      <h2 className="mt-6 font-stencil text-[27px] uppercase leading-[1.02] text-ink sm:text-[31px]">{service.name}</h2>
      <p className="mt-4 line-clamp-3 font-mono text-[12px] leading-[1.65] text-ink-2">{service.description}</p>
      {metadataState === "loading" ? <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">Reading agent profile</p> : null}

      {service.tags.length ? (
        <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">
          {service.tags.slice(0, 4).map((tag) => <span key={tag}>#{tag}</span>)}
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-2 gap-px border border-[color:var(--hairline)] bg-[color:var(--hairline)]">
        <Fact label="PRICE" value={priceLabel(service.amountUSDC)} />
        <Fact label="PAYMENT" value={listing.payment.rail === "Escrow" ? "Protected project" : "Pay per use"} warning={listing.payment.rail === "Escrow" && !listing.payment.escrowEligible} />
      </div>

      {quarantined || listing.risk.unverified ? (
        <div className="mt-5"><UnverifiedWarning message={listing.risk.warning} quarantineReason={listing.risk.quarantineReason} /></div>
      ) : (
        <div className="mt-5 border-l-[3px] border-[color:var(--ok)] bg-canvas-2 px-4 py-3 font-mono text-[11px] leading-relaxed text-ink-2">
          Tested by Agon for Agent #{listing.agentId}, version {listing.version}. Later versions need a new test.
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--hairline)] pt-5">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{unavailable ? "NOT AVAILABLE" : service.hasIndexedManifest ? "READY TO REVIEW" : "LIMITED DETAILS"}</span>
        <Link href={`/market/${encodeURIComponent(listing.id)}`} className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink hover:text-accent">
          {quarantined ? "REVIEW RECORD" : "VIEW SERVICE"} →
        </Link>
      </div>
    </BracketedCell>
  );
}

export function AgentLogo({ logoUrl, name }: { logoUrl: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "A";
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden border border-[color:var(--hairline-strong)] bg-pink font-mono text-[13px] text-white" aria-label={`${name} logo`}>
      {logoUrl && !failed ? <img src={logoUrl} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : initials}
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
