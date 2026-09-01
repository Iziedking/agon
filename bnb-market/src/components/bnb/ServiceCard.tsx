import Link from "next/link";

import type { BnbService } from "@/lib/bnb/catalog";

export function ServiceCard({ service, chainSlug }: { service: BnbService; chainSlug?: string }) {
  const status = service.active ? "READY" : "REVIEWING";
  const proofColor = service.proof.endpointStatus === "live" ? "var(--ok)" : "var(--warn)";

  return (
    <article className="relative rounded-sm border border-[color:var(--hairline)] bg-[color:var(--canvas-2)] p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-3)]">
          {service.category.replace("-", " ")}
        </span>
        <span
          className="rounded-full border border-[color:var(--hairline-strong)] px-2 py-1 text-[10px] font-bold uppercase"
          style={{ borderColor: service.active ? "var(--ok)" : "var(--warn)", color: service.active ? "var(--ok)" : "var(--warn)" }}
        >
          {status}
        </span>
      </div>

      <h2 className="text-xl font-semibold">{service.name}</h2>
      <p className="mt-1 text-sm text-[color:var(--ink-3)]">{service.provider}</p>
      <p className="mt-3 text-sm leading-relaxed">{service.shortGoal}</p>

      <dl className="mt-4 grid gap-2 text-sm">
        <Metric label="Price" value={`${service.price} ${service.priceModel}`} />
        <Metric label="Authority" value={service.authorityNeed} />
        <Metric label="Endpoint status" value={`${service.proof.endpointStatus} (${service.proof.lastSeen})`} />
        <Metric
          label="Evidence"
          value={
            <span style={{ color: proofColor }}>
              {service.proof.hasEvidence ? "verified context available" : "partial evidence"}
            </span>
          }
        />
      </dl>

      <div className="mt-5 flex flex-wrap gap-2">
        <Link
          href={`/market/${service.id}?chain=${chainSlug ?? String(service.chainId)}`}
          className="inline-flex h-10 items-center rounded-sm border border-[color:var(--hairline-strong)] px-4 font-semibold"
        >
          View evidence & activation
        </Link>
        <a
          href={service.docsUrl || "#"}
          target={service.docsUrl ? "_blank" : undefined}
          rel={service.docsUrl ? "noreferrer" : undefined}
          className="inline-flex h-10 items-center rounded-sm px-4 font-semibold text-[color:var(--ink-3)]"
        >
          Docs
        </a>
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string | React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-2 text-sm">
      <dt className="w-28 font-semibold text-[11px] uppercase tracking-[0.13em] text-[color:var(--ink-3)]">{label}</dt>
      <dd className="min-w-0 flex-1 text-[color:var(--ink-2)]">{value}</dd>
    </div>
  );
}
