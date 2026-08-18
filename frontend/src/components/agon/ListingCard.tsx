import Link from "next/link";

import { BracketedCell } from "@/components/redesign/BracketedCell";
import { presentListing } from "@/lib/agon/catalog";
import type { AgonListing } from "@/lib/agon/types";
import { UnverifiedWarning } from "./UnverifiedWarning";
import { VerificationBadge } from "./VerificationBadge";

function priceLabel(amountUSDC: string | null) {
  return amountUSDC ? `${amountUSDC} USDC` : "Price in manifest";
}

export function ListingCard({ listing }: { listing: AgonListing }) {
  const service = presentListing(listing);
  const quarantined = Boolean(listing.risk.quarantineReason);
  const unavailable = listing.status !== "Listed" || quarantined;

  return (
    <BracketedCell hover className="flex min-h-[360px] flex-col" pad="md">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">
          {service.category.label} <span aria-hidden>·</span> Agent #{listing.agentId}
        </div>
        <VerificationBadge status={listing.verification.status} quarantined={quarantined} />
      </div>

      <h2 className="mt-6 font-stencil text-[27px] uppercase leading-[1.02] text-ink sm:text-[31px]">
        {service.name}
      </h2>
      <p className="mt-4 line-clamp-3 font-mono text-[12px] leading-[1.65] text-ink-2">
        {service.description}
      </p>

      {service.tags.length ? (
        <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">
          {service.tags.slice(0, 4).map((tag) => <span key={tag}>#{tag}</span>)}
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-2 gap-px border border-[color:var(--hairline)] bg-[color:var(--hairline)]">
        <Fact label="STARTING PRICE" value={priceLabel(service.amountUSDC)} />
        <Fact
          label="PAYMENT"
          value={listing.payment.rail === "Escrow" ? "Escrow requested" : "Direct x402"}
          warning={listing.payment.rail === "Escrow" && !listing.payment.escrowEligible}
        />
      </div>

      {quarantined || listing.risk.unverified ? (
        <div className="mt-5">
          <UnverifiedWarning message={listing.risk.warning} quarantineReason={listing.risk.quarantineReason} />
        </div>
      ) : (
        <div className="mt-5 border-l-[3px] border-[color:var(--ok)] bg-canvas-2 px-4 py-3 font-mono text-[11px] leading-relaxed text-ink-2">
          Verified for Agent #{listing.agentId}, version {listing.version}. Later versions need a new verification.
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--hairline)] pt-5">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
          {unavailable ? "NOT AVAILABLE" : service.hasIndexedManifest ? "DETAILS INDEXED" : "ANCHOR ONLY"}
        </span>
        <Link
          href={`/market/${encodeURIComponent(listing.id)}`}
          className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink hover:text-accent"
        >
          {quarantined ? "REVIEW RECORD" : "VIEW SERVICE"} →
        </Link>
      </div>
    </BracketedCell>
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
