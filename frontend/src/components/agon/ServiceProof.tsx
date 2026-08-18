import type { AgonListing } from "@/lib/agon/types";
import { categoryById } from "@/lib/agon/catalog";
import type { ListingAssurance, ManifestProof } from "@/lib/agon/verify";
import { VerificationBadge } from "./VerificationBadge";

type Props = {
  listing: AgonListing;
  proof: ManifestProof;
  assurance: ListingAssurance;
  identityRegistry?: string | null;
  currentOwner?: string | null;
};

export function ServiceProof({ listing, proof, assurance, identityRegistry, currentOwner }: Props) {
  const category = categoryById(listing.verification.scope.category);
  const proofTone = assurance.state === "verified"
    ? "var(--ok)"
    : assurance.state === "unverified"
      ? "var(--warn)"
      : "var(--err)";

  return (
    <section aria-labelledby="service-proof-heading" className="border-t border-[color:var(--hairline-strong)] bg-canvas">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[color:var(--hairline)] bg-canvas-2 px-5 py-5 sm:px-6">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.17em] text-ink-3">IMMUTABLE ANCHOR / ADVANCED DETAILS</div>
          <h2 id="service-proof-heading" className="mt-2 font-stencil text-[28px] leading-none text-ink sm:text-[34px]">
            TECHNICAL PROOF
          </h2>
        </div>
        <VerificationBadge status={listing.verification.status} quarantined={Boolean(listing.risk.quarantineReason)} />
      </header>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_280px]">
        <dl className="divide-y divide-[color:var(--hairline)] lg:border-r lg:border-[color:var(--hairline)]">
          <ProofRow label="MANIFEST HASH / ONCHAIN" value={listing.manifest.hash} />
          <ProofRow
            label="MANIFEST HASH / RECOMPUTED"
            value={proof.recomputedHash ?? "Unavailable: manifest body not supplied by the indexer"}
            tone={proof.state === "match" ? "ok" : proof.state === "unavailable" ? "muted" : "error"}
          />
          <ProofRow label="MANIFEST URI" value={listing.manifest.uri} href={listing.manifest.uri} />
          <ProofRow label="IDENTITY REGISTRY" value={identityRegistry ?? "Not indexed by the current API"} tone={identityRegistry ? "default" : "muted"} />
          <ProofRow label="SERVICE REGISTRY" value={listing.serviceRegistry} />
          <ProofRow label="ERC-8004 AGENT ID" value={listing.agentId} />
          <ProofRow label="PROVIDER / PUBLISHED" value={listing.providerSnapshot} />
          <ProofRow label="PROVIDER / CURRENT" value={currentOwner ?? "Not read by the current API"} tone={currentOwner ? "default" : "muted"} />
          <ProofRow label="LISTING VERSION" value={listing.version} />
        </dl>

        <div className="flex flex-col p-5 sm:p-6">
          <div className="border-l-[3px] pl-4" style={{ borderColor: proofTone }}>
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">ASSURANCE STATE</div>
            <div className="mt-2 font-stencil text-[24px] leading-none text-ink">{assurance.label}</div>
            <p className="mt-3 font-mono text-[11px] leading-relaxed text-ink-2">{assurance.message}</p>
          </div>

          <div className="mt-7 border-t border-[color:var(--hairline)] pt-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">VERIFICATION SCOPE</div>
            <div className="mt-3 space-y-2 font-mono text-[11px] text-ink-2">
              <Scope label="AGENT" value={listing.verification.scope.agentId} />
              <Scope label="LISTING" value={listing.verification.scope.listingId} />
              <Scope label="VERSION" value={listing.verification.scope.version} />
              <Scope label="CATEGORY" value={`${category.label} / protocol ${category.id}`} />
            </div>
          </div>

          <div className="mt-7 border-t border-[color:var(--hairline)] pt-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">PROVENANCE</div>
            <div className="mt-3 space-y-2 font-mono text-[11px] text-ink-2">
              <Scope label="BLOCK" value={listing.provenance.sourceBlockNumber} />
              <Scope label="LOG" value={String(listing.provenance.sourceLogIndex)} />
              <div className="pt-1 break-all text-[10px] leading-relaxed text-ink-3">{listing.provenance.sourceTxHash}</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ProofRow({ label, value, href, tone = "default" }: { label: string; value: string; href?: string; tone?: "default" | "ok" | "error" | "muted" }) {
  const color = tone === "ok" ? "text-[color:var(--ok)]" : tone === "error" ? "text-[color:var(--err)]" : tone === "muted" ? "text-ink-3" : "text-ink";
  const content = href ? (
    <a href={href} target="_blank" rel="noreferrer" className={`${color} hover:text-accent`}>{value}</a>
  ) : <span className={color}>{value}</span>;
  return (
    <div className="grid gap-2 px-5 py-4 sm:grid-cols-[220px_minmax(0,1fr)] sm:px-6">
      <dt className="font-mono text-[9px] uppercase tracking-[0.15em] text-ink-3">{label}</dt>
      <dd className="break-all font-mono text-[11px] leading-relaxed">{content}</dd>
    </div>
  );
}

function Scope({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-4"><span className="text-ink-3">{label}</span><span className="break-all text-right text-ink">{value}</span></div>;
}
