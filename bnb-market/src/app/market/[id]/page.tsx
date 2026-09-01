"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { MarketShell } from "@/components/bnb/MarketShell";
import { ServiceDetailsCards } from "@/components/bnb/ServiceDetailsCards";
import { ActivationPanel } from "@/components/bnb/ActivationPanel";
import { BNB_CATEGORIES, type BnbCategory } from "@/lib/bnb/catalog";
import { type BnbChainId } from "@/lib/bnb/chains";
import { readMarketQuery, buildMarketSearch, serviceById } from "@/lib/bnb/market-query";

const categorySet = new Set(BNB_CATEGORIES.map((item) => item.id));

function isBnbCategory(value: string): value is BnbCategory {
  return categorySet.has(value as BnbCategory);
}

function getCategory(raw: string | null): BnbCategory | "all" {
  if (!raw) return "all";
  const normalized = raw.toLowerCase();
  return isBnbCategory(normalized) ? normalized : "all";
}

export default function ServiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [serviceId, setServiceId] = useState("");
  const { chainId, category } = useMemo(() => ({
    chainId: readMarketQuery(searchParams).chainId,
    category: getCategory(searchParams.get("category")),
  }), [searchParams]);
  const service = useMemo(() => (serviceId ? serviceById(decodeURIComponent(serviceId), chainId) : null), [serviceId, chainId]);
  const backFilter =
    category === "all" ? `/market?chain=${chainId}` : `/market?chain=${chainId}&category=${category}`;

  useEffect(() => {
    let active = true;
    Promise.resolve(params).then((resolved) => {
      if (!active) return;
      setServiceId(resolved.id || "");
    });
    return () => {
      active = false;
    };
  }, [params]);

  if (!serviceId) {
    return (
      <MarketShell chainId={chainId} onChainChange={setChain}>
        <section className="mx-auto w-full max-w-[1200px] px-4 py-10 sm:px-6">
          <h1 className="text-3xl font-semibold">Loading service</h1>
          <p className="mt-2 text-sm text-[color:var(--ink-2)]">Preparing marketplace service details…</p>
          <Link href={backFilter} className="mt-5 inline-flex h-11 items-center underline underline-offset-4">
            Back to market
          </Link>
        </section>
      </MarketShell>
    );
  }

  function setChain(nextChainId: BnbChainId) {
    const next = buildMarketSearch({
      chainId: nextChainId,
      category,
      query: "",
      activatableOnly: false,
    });
    router.push(`${pathname}?${next.toString()}`);
  }

  if (!service) {
    return (
      <MarketShell chainId={chainId} onChainChange={setChain}>
        <section className="mx-auto w-full max-w-[1200px] px-4 py-10 sm:px-6">
          <h1 className="text-3xl font-semibold">Service not found</h1>
          <p className="mt-2 text-sm text-[color:var(--ink-2)]">
            No record is available for this ID on the selected chain.
          </p>
          <Link href={backFilter} className="mt-5 inline-flex h-11 items-center underline underline-offset-4">
            Back to market
          </Link>
        </section>
      </MarketShell>
    );
  }

  return (
    <MarketShell chainId={chainId} onChainChange={setChain}>
      <section className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.15em] text-[color:var(--ink-3)]">
              {service.category.replace("-", " ")}
            </p>
            <h1 className="mt-1 text-3xl font-semibold">{service.name}</h1>
            <p className="mt-1 text-sm text-[color:var(--ink-2)]">{service.provider}</p>
          </div>
          <Link href={backFilter} className="inline-flex h-11 items-center rounded-sm border border-[color:var(--hairline)] px-4 text-sm">
            Back
          </Link>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <article className="rounded-sm border border-[color:var(--hairline)] p-4">
            <h2 className="text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink-3)]">Agent outcome</h2>
            <p className="mt-2 text-sm">{service.shortGoal}</p>
            <p className="mt-4 leading-relaxed text-sm">{service.description}</p>

            <div className="mt-6 border-t border-[color:var(--hairline)] pt-4">
              <h3 className="text-sm font-semibold uppercase tracking-[0.12em]">How to hire safely</h3>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-[color:var(--ink-2)]">
                <li>Review authority scope and price.</li>
                <li>Verify owner/endpoint proof is current for chain {chainId}.</li>
                <li>Prepare a bounded session and confirm chain/expiry.</li>
                <li>Run first task and wait for onchain confirmation state.</li>
                <li>Revoke session when objective is reached.</li>
              </ol>
            </div>
          </article>
          <ActivationPanel service={service} chainId={chainId} />
          <div id="agent-evidence" className="sr-only" />

          <ServiceDetailsCards service={service} />
        </div>
      </section>
    </MarketShell>
  );
}
