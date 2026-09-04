"use client";
import { useParams } from "next/navigation";
import { BnbMarketContent, BnbAgentContent, BnbPublishContent, BnbPlaygroundContent } from "@agon/bnb/MarketContent";
import type { BnbChain } from "@agon/bnb/types";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import { CornerMarkers } from "@/components/redesign/CornerMarkers";
import { SectionHeader } from "@/components/redesign/SectionHeader";
import { TagButton } from "@/components/redesign/TagButton";
import { AgonAuthAction } from "@/components/agon/AgonAuthAction";
import { useAuth } from "@/hooks/useAuth";
import { useAgonNetwork } from "@/hooks/useAgonNetwork";
import { networkHref } from "@/lib/agon/network";

export function BnbMarket({ view = "market" }: { view?: "market" | "detail" | "publish" | "playground" }) {
  const { network, networkKey } = useAgonNetwork(); const { me } = useAuth();
  const params = useParams<{ id?: string }>(); const chainId = network.chainId as BnbChain;
  return <div className="min-h-screen bg-canvas text-ink"><AppHeader /><main>
    <section className="relative mx-auto max-w-[1600px] px-4 pt-14 sm:px-6 sm:pt-16"><CornerMarkers /><SectionHeader eyebrow={`AGON MARKET / ${network.brand} ${network.environment}`} heading={view === "market" ? "FIND AN AGENT" : view === "publish" ? "LIST YOUR AGENT" : "AGENT DETAILS"} subDeck={view === "market" ? `Discover agents on ${network.name}. Inspect the owner, service, and evidence before choosing.` : `Identity, service, and proof scoped to ${network.name}.`} right={view === "market" ? <AgonAuthAction href="/market/new">LIST YOUR AGENT</AgonAuthAction> : <TagButton variant="ghost" href={networkHref("/market", networkKey)}>BACK TO MARKET</TagButton>} /></section>
    <section className="mx-auto max-w-[1600px] px-4 pb-20 pt-10 sm:px-6 sm:pt-12">
      {view === "playground" ? <BnbPlaygroundContent key={chainId} chainId={chainId}/> : view === "market" ? <BnbMarketContent key={chainId} chainId={chainId} /> : view === "detail" ? <BnbAgentContent key={`${chainId}:${params.id}`} chainId={chainId} id={params.id ?? ""} /> : <BnbPublishContent key={chainId} chainId={chainId} signedIn={!!me} signIn={<AgonAuthAction href="/market/new">SIGN IN TO PUBLISH</AgonAuthAction>} />}
    </section></main><Footer variant="agon" /></div>;
}
