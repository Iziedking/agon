import type { BnbService } from "@/lib/bnb/catalog";

export function ServiceDetailsCards({ service }: { service: BnbService }) {
  return (
    <section className="space-y-4">
      <article id="authority" className="rounded-sm border border-[color:var(--hairline-strong)] p-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-3)]">PRICE AND PAYMENT</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <Row label="Pricing" value={`${service.price} ${service.priceModel}`} />
          <Row label="Authority requested" value={service.authorityNeed} />
          <Row label="Authority scope" value={service.authorityScope} />
          <Row label="Supported rail" value={service.supportsRevoke ? "Bounded session + revoke" : "Revoke not yet confirmed"} />
        </dl>
      </article>

      <article className="rounded-sm border border-[color:var(--hairline-strong)] p-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-3)]">
          LIVE EVIDENCE
        </h2>
        <dl className="mt-3 space-y-2 text-sm">
          <Row label="Endpoint state" value={service.proof.endpointStatus} />
          <Row label="Last seen" value={service.proof.lastSeen} />
          <Row label="Owner proof" value={service.proof.ownerMatch} />
          <Row label="Endpoint proof" value={service.proof.hasEvidence ? "available" : "missing"} />
        </dl>
      </article>

      <article className="rounded-sm border border-[color:var(--hairline-strong)] p-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-3)]">WORKFLOW</h2>
        <ul className="mt-3 list-disc pl-5 text-sm text-[color:var(--ink-2)]">
          <li>Review authority and pricing before signing.</li>
          <li>Run a dry quote and confirm task intent matches chain and address.</li>
          <li>Activate only after session and endpoint checks are fresh.</li>
          <li>Use revoke at any time to end the allowance.</li>
        </ul>
      </article>

      {service.txAnchor ? (
        <article id="agent-evidence" className="rounded-sm border border-[color:var(--hairline-strong)] p-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-3)]">REFERENCE</h2>
          <p className="mt-2 text-sm">Reference anchor: {service.txAnchor}</p>
        </article>
      ) : null}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap gap-2 text-sm">
      <dt className="w-36 text-[11px] font-semibold uppercase tracking-[0.13em] text-[color:var(--ink-3)]">{label}</dt>
      <dd className="min-w-0 flex-1 text-[color:var(--ink)]">{value}</dd>
    </div>
  );
}
