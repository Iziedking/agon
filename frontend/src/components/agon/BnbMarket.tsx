"use client";
import { ProviderWorkspace } from "@agon/bnb/ProviderWorkspace";
import { useParams, useRouter } from "next/navigation";
import { BnbMarketContent, BnbAgentContent, BnbPublishContent, BnbPlaygroundContent, BnbActivityContent, BnbCompareContent } from "@agon/bnb/MarketContent";
import type { WalletRequest } from "@agon/bnb/LpHiringPanel";
import type { BnbChain } from "@agon/bnb/types";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import { AgonAuthAction } from "@/components/agon/AgonAuthAction";
import { useAuth } from "@/hooks/useAuth";
import { useAgonNetwork } from "@/hooks/useAgonNetwork";
import { loginHref, networkHref } from "@/lib/agon/network";

export function BnbMarket({ view = "market" }: { view?: "market" | "detail" | "publish" | "playground" | "activity" | "provider" | "compare" }) {
  const { network, networkKey } = useAgonNetwork(); const { me } = useAuth(); const router = useRouter();
  const params = useParams<{ id?: string }>(); const chainId = network.chainId as BnbChain;
  const walletRequest: WalletRequest = async (input) => {
    const wallet = (window as Window & { ethereum?: { request: WalletRequest } }).ethereum;
    if (!wallet) throw new Error("Open AGON in your wallet browser or install a browser wallet to continue.");
    return wallet.request(input);
  };
  const needSignIn = () => router.push(loginHref(networkKey, window.location.pathname + window.location.search + window.location.hash));
  return <div className="min-h-screen bg-canvas text-ink"><AppHeader hideSignOut /><main>
    <section className="mx-auto max-w-[1400px] px-4 pt-8 sm:px-6 sm:pt-10">{view === "detail" || view === "playground" ? <a className="inline-flex min-h-11 items-center text-sm underline" href={networkHref("/market", networkKey)}>← Back to market</a> : <><p className="font-mono text-xs uppercase tracking-wide text-ink-2">AGON / {network.name}</p><h1 className="mt-3 font-stencil text-4xl uppercase sm:text-5xl">{view === "market" ? "Find your agent" : view === "provider" ? "Provider dashboard" : view === "activity" ? "Your activity" : view === "compare" ? "Compare agents" : "List your agent"}</h1><p className="mt-3 text-sm leading-relaxed text-ink-2">{view === "market" ? "Choose a financial goal. Review the service, permissions and price before you use it." : view === "activity" ? "Your requests, next steps and delivery records." : view === "compare" ? "Review the evidence before you decide." : "Publish a service you own on this network."}</p></>}</section>
    <section className="mx-auto max-w-[1400px] px-4 pb-20 pt-6 sm:px-6 sm:pt-8">
      {view === "provider" ? <ProviderWorkspace key={chainId} chainId={chainId} address={me?.address} signIn={<button className="min-h-11 border px-4" onClick={needSignIn}>Sign in →</button>} /> : view === "activity" ? <BnbActivityContent key={chainId} chainId={chainId} signedIn={!!me} signIn={<button className="min-h-11 border border-accent bg-accent px-4 py-3 text-accent-ink" onClick={needSignIn}>Sign in to view activity →</button>} /> : view === "compare" ? <BnbCompareContent key={chainId} chainId={chainId} /> : view === "playground" ? <BnbPlaygroundContent key={chainId} chainId={chainId}/> : view === "market" ? <BnbMarketContent key={chainId} chainId={chainId} /> : view === "detail" ? <BnbAgentContent key={`${chainId}:${params.id}`} chainId={chainId} id={params.id ?? ""} signedIn={!!me} onNeedSignIn={needSignIn} walletRequest={walletRequest} /> : <BnbPublishContent key={chainId} chainId={chainId} signedIn={!!me} signIn={<AgonAuthAction href="/market/new">SIGN IN TO PUBLISH</AgonAuthAction>} />}
    </section></main><Footer variant="agon" /></div>;
}
