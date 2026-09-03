"use client";

import Link from "next/link";
import { Suspense, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { MarketShell } from "@/components/bnb/MarketShell";
import type { BnbChainId } from "@/lib/bnb/chains";
import { removeCompareId, resolveCompareState, serializeCompareIds } from "@/lib/bnb/compare";
import type { BnbService } from "@/lib/bnb/catalog";
import { buildMarketSearch, readMarketQuery } from "@/lib/bnb/market-query";

type CompareRow = {
  label: string;
  value: (service: BnbService) => string;
};

const compareRows: CompareRow[] = [
  { label: "Outcome", value: (service) => service.shortGoal },
  { label: "Price", value: (service) => `${service.price} ${service.priceModel}` },
  { label: "Authority", value: (service) => service.authorityNeed },
  { label: "Scope", value: (service) => service.authorityScope },
  { label: "Endpoint", value: (service) => service.proof.endpointStatus },
  { label: "Owner proof", value: (service) => service.proof.ownerMatch },
  { label: "Last seen", value: (service) => service.proof.lastSeen },
  { label: "Evidence", value: (service) => service.proof.hasEvidence ? "Available" : "Missing" },
  { label: "Test job", value: (service) => service.supportsTestJob ? "Supported" : "Not confirmed" },
];

function CompareContent() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const state = useMemo(() => readMarketQuery(searchParams), [searchParams]);
  const compare = useMemo(
    () => resolveCompareState(state.chainId, searchParams.get("ids")),
    [searchParams, state.chainId],
  );
  const services = compare.candidates
    .filter((candidate) => candidate.availableOnChain && candidate.service)
    .map((candidate) => candidate.service as BnbService);

  function setChain(nextChainId: BnbChainId) {
    // A comparison is network-scoped. Switching BNB networks invalidates it.
    const next = buildMarketSearch({
      chainId: nextChainId,
      category: "all",
      query: "",
      activatableOnly: false,
    });
    router.push(`${pathname}?${next.toString()}`);
  }

  function remove(serviceId: string) {
    const ids = removeCompareId(services.map((service) => service.id), serviceId);
    const next = new URLSearchParams({
      chain: String(state.chainId),
      ids: serializeCompareIds(ids),
    });
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <MarketShell chainId={state.chainId} onChainChange={setChain}>
      <section className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[color:var(--hairline)] pb-6">
          <div>
            <p className="text-[11px] uppercase tracking-[0.15em] text-[color:var(--ink-3)]">Compare before you connect</p>
            <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">Compare agent services</h1>
            <p className="mt-2 max-w-[68ch] text-sm text-[color:var(--ink-2)]">
              This table keeps the selected BNB network fixed while you compare outcome, price, authority, and proof freshness.
            </p>
          </div>
          <Link href={`/market?chain=${state.chainId}`} className="inline-flex min-h-11 items-center rounded-sm border border-[color:var(--hairline-strong)] px-4 text-sm underline underline-offset-4">
            Back to browse
          </Link>
        </div>

        {compare.candidates.some((candidate) => !candidate.availableOnChain) ? (
          <div className="mt-6 border border-[color:var(--warn)] bg-[color:var(--canvas-2)] p-4 text-sm">
            One or more selected records are not available on BNB chain {state.chainId}; they were removed from the comparison so evidence cannot cross networks.
          </div>
        ) : null}

        {services.length < 2 ? (
          <div className="mt-6 border border-[color:var(--hairline)] bg-[color:var(--canvas-2)] p-5 text-sm">
            Select at least two services from the browse view to compare them side by side.
            <Link href={`/market?chain=${state.chainId}`} className="ml-2 underline underline-offset-4">Choose services</Link>
          </div>
        ) : (
          <div className="mt-6 overflow-x-auto border border-[color:var(--hairline)]">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="bg-[color:var(--canvas-2)]">
                  <th className="w-40 border-b border-r border-[color:var(--hairline)] p-3 text-[11px] uppercase tracking-[0.13em] text-[color:var(--ink-3)]">Review field</th>
                  {services.map((service) => (
                    <th key={service.id} className="border-b border-[color:var(--hairline)] p-3 align-top">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold">{service.name}</p>
                          <p className="mt-1 text-xs text-[color:var(--ink-3)]">{service.provider}</p>
                        </div>
                        <button type="button" onClick={() => remove(service.id)} className="text-xs underline underline-offset-4">Remove</button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {compareRows.map((row) => (
                  <tr key={row.label}>
                    <th scope="row" className="border-b border-r border-[color:var(--hairline)] bg-[color:var(--canvas-2)] p-3 align-top text-[11px] uppercase tracking-[0.12em] text-[color:var(--ink-3)]">{row.label}</th>
                    {services.map((service) => (
                      <td key={`${service.id}-${row.label}`} className="border-b border-[color:var(--hairline)] p-3 align-top leading-relaxed text-[color:var(--ink-2)]">{row.value(service)}</td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <th scope="row" className="border-r border-[color:var(--hairline)] bg-[color:var(--canvas-2)] p-3 align-top text-[11px] uppercase tracking-[0.12em] text-[color:var(--ink-3)]">Next</th>
                  {services.map((service) => (
                    <td key={`${service.id}-next`} className="p-3 align-top">
                      <Link href={`/market/${service.id}?chain=${state.chainId}`} className="inline-flex min-h-11 items-center rounded-sm border border-[color:var(--hairline-strong)] px-3 text-xs font-semibold uppercase tracking-[0.11em]">Open detail</Link>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-6 text-xs text-[color:var(--ink-3)]">
          Comparison is informational. Activation still requires the detail page’s explicit evidence and authority checks.
        </p>
      </section>
    </MarketShell>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas p-6 text-sm text-ink-2">Loading comparison…</div>}>
      <CompareContent />
    </Suspense>
  );
}
