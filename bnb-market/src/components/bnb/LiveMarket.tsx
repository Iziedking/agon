"use client";
import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { BnbMarketContent, BnbAgentContent, BnbActivityContent, BnbCompareContent, BnbPublishContent, BnbPlaygroundContent, bnbHref } from "@/shared/MarketContent";
import type { WalletRequest } from "@/shared/LpHiringPanel";
import { bnbMe, bnbLogin, bnbLogout } from "@/shared/client";
import type { BnbChain, BnbSession } from "@/shared/types";
import { resolveBnbChain } from "@/lib/bnb/chains";
import { ThemeToggle } from "@/components/bnb/ThemeToggle";

type Wallet = { request(input: { method: string; params?: unknown[] }): Promise<unknown> };
const BUTTON = "inline-flex min-h-11 items-center justify-center border border-[color:var(--hairline-strong)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.12em] hover:bg-canvas-3 disabled:opacity-50";
function Content({ view }: { view: "market" | "detail" | "activity" | "compare" | "publish" | "playground" }) {
  const search = useSearchParams(); const router = useRouter(); const params = useParams<{ id?: string }>();
  const chainId: BnbChain = resolveBnbChain(search.get("network") ?? search.get("chain"));
  const [session, setSession] = useState<BnbSession | null>(null); const [loginOpen, setLoginOpen] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => { let current = true; setSession(null); setLoginOpen(false); setError(null); bnbMe(chainId).then((r) => { if (current) setSession(r.session); }).catch(() => {}); return () => { current = false; }; }, [chainId]);
  const activeSession = session?.chainId === chainId ? session : null;
  async function login() {
    setBusy(true); setError(null);
    try {
      const wallet = (window as Window & { ethereum?: Wallet }).ethereum;
      if (!wallet) throw new Error("Open AGON in your wallet browser or install a browser wallet to continue.");
      const accounts = await wallet.request({ method: "eth_requestAccounts" }) as string[];
      if (!accounts[0]) throw new Error("No wallet account selected.");
      const chain = await wallet.request({ method: "eth_chainId" });
      if (Number(chain) !== chainId) await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${chainId.toString(16)}` }] });
      if (Number(await wallet.request({ method: "eth_chainId" })) !== chainId) throw new Error("Switch to the selected BNB network before signing in.");
      const result = await bnbLogin(chainId, accounts[0] as `0x${string}`, async (message) => {
        const hex = "0x" + Array.from(new TextEncoder().encode(message), (b) => b.toString(16).padStart(2, "0")).join("");
        return await wallet.request({ method: "personal_sign", params: [hex, accounts[0]] }) as `0x${string}`;
      });
      setSession(result.session); setLoginOpen(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Sign-in failed. Please try again."); } finally { setBusy(false); }
  }
  return <div className="min-h-screen bg-canvas text-ink">
    <header className="border-b border-[color:var(--hairline)]"><div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
      <a href={bnbHref(chainId, "/market")} className="inline-flex items-center gap-2.5 font-stencil text-xl tracking-widest"><svg width="28" height="28" viewBox="0 0 32 32" aria-label="AGON"><polygon points="0,0 26,0 32,6 32,32 0,32" fill="var(--accent)"/><g fill="var(--canvas)"><polygon points="3,28 8,28 14,9 11,9"/><polygon points="21,9 18,9 24,28 29,28"/><rect x="8" y="19" width="16" height="3"/></g><rect x="14.5" y="19" width="3" height="3" fill="var(--accent)"/></svg>AGON</a>
      <nav aria-label="Main navigation" className="flex gap-6 font-mono text-[11px] uppercase tracking-widest"><a href={bnbHref(chainId, "/market")}>MARKET</a><a href={bnbHref(chainId, "/market/activity")}>ACTIVITY</a><a href={bnbHref(chainId, "/market/new")}>LIST AN AGENT</a><a href={bnbHref(chainId, "/agon/playground")}>TRY AN AGENT</a></nav>
      <div className="flex flex-wrap gap-2"><div className="inline-flex min-h-11 items-center border border-[color:var(--hairline-strong)] bg-canvas px-3"><img src="/brands/bnb.svg" alt="" aria-hidden="true" width="18" height="18" draggable={false} className="shrink-0 object-contain"/><label className="sr-only" htmlFor="bnb-network">BNB network</label><select id="bnb-network" className="bnb-network-select min-h-11 bg-transparent pl-2 pr-1 font-mono text-[11px] uppercase tracking-[0.12em] text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent" value={chainId} onChange={(e) => router.push(bnbHref(Number(e.target.value) as BnbChain, "/market"))}><option value="56">BNB MAINNET</option><option value="97">BNB TESTNET</option></select></div><ThemeToggle/><button className={`${BUTTON} bg-accent text-accent-ink`} onClick={() => setLoginOpen(true)}>{activeSession ? `${activeSession.address.slice(0, 6)}…${activeSession.address.slice(-4)}` : "SIGN IN →"}</button></div>
    </div></header>
      <main className="mx-auto max-w-[1600px] px-4 pb-20 pt-10 sm:px-6 sm:pt-12">{view === "detail" || view === "playground" ? <div className="mb-6"><a className="font-mono text-[11px] uppercase tracking-widest text-ink-2 underline underline-offset-4" href={bnbHref(chainId, "/market")}>← BACK TO MARKET</a></div> : <section className="flex flex-wrap items-end justify-between gap-6"><div><p className="font-mono text-[11px] uppercase tracking-widest"><span className="text-accent">■</span> AGON MARKET / BNB {chainId === 97 ? "TESTNET" : "MAINNET"}</p><h1 className="mt-4 font-stencil uppercase leading-none" style={{ fontSize: "clamp(40px,5vw,72px)" }}>{view === "market" ? "FIND AN AGENT" : view === "activity" ? "YOUR ACTIVITY" : view === "compare" ? "COMPARE SERVICES" : "LIST YOUR AGENT"}</h1><p className="mt-4 max-w-[56ch] font-mono text-sm leading-relaxed text-ink-2">{view === "market" ? "Browse services, compare prices, and choose one to try." : view === "activity" ? "Review requests and open reports from services you have used." : view === "compare" ? "Review live service records side by side before you decide." : "List a service so buyers can discover and use it."}</p></div><a className={BUTTON} href={bnbHref(chainId, view === "market" ? "/market/new" : "/market")}>{view === "market" ? "LIST YOUR AGENT →" : "BACK TO MARKET →"}</a></section>}
      <section className={view === "detail" || view === "playground" ? "mt-0" : "mt-12"}>{view === "playground" ? <BnbPlaygroundContent key={chainId} chainId={chainId}/> : view === "market" ? <BnbMarketContent key={chainId} chainId={chainId}/> : view === "activity" ? <BnbActivityContent key={chainId} chainId={chainId} signedIn={!!activeSession} signIn={<button className={`${BUTTON} bg-accent text-accent-ink`} onClick={() => setLoginOpen(true)}>SIGN IN TO VIEW ACTIVITY →</button>}/> : view === "compare" ? <BnbCompareContent key={chainId} chainId={chainId}/> : view === "detail" ? <BnbAgentContent key={`${chainId}:${params.id}`} chainId={chainId} id={params.id ?? ""} signedIn={!!activeSession} onNeedSignIn={() => setLoginOpen(true)} walletRequest={async (input: Parameters<WalletRequest>[0]) => {
        const wallet = (window as Window & { ethereum?: Wallet }).ethereum;
        if (!wallet) throw new Error("Open AGON in your wallet browser or install a browser wallet to continue.");
        return wallet.request(input);
      }}/> : <BnbPublishContent key={chainId} chainId={chainId} signedIn={!!activeSession} signIn={<button className={BUTTON} onClick={() => setLoginOpen(true)}>SIGN IN TO PUBLISH →</button>}/>}</section>
    </main><footer className="border-t border-[color:var(--hairline)]"><div className="mx-auto grid max-w-[1600px] gap-8 px-4 py-12 font-mono text-[11px] uppercase tracking-widest sm:grid-cols-3 sm:px-6"><div><p className="text-accent">AGON</p><p className="mt-3 text-ink-3">FIND / LIST / TEST AGENTS</p></div><div><p className="text-accent">TRUST</p><p className="mt-3 text-ink-3">OWNERSHIP / VERSION / RESULTS</p></div><div><p className="text-accent">OPEN</p><a className="mt-3 block" href={bnbHref(chainId, "/market")}>BNB {chainId === 97 ? "TESTNET" : "MAINNET"} MARKET →</a></div></div></footer>
    {loginOpen ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4" onClick={() => setLoginOpen(false)}><section role="dialog" aria-modal="true" aria-labelledby="login-heading" className="relative w-full max-w-[440px] border border-ink bg-canvas p-8" onClick={(e) => e.stopPropagation()}><button aria-label="Close sign-in" className="absolute right-3 top-3 min-h-11 min-w-11" onClick={() => setLoginOpen(false)}>×</button><h2 id="login-heading" className="font-stencil text-[26px] uppercase">{activeSession ? "YOUR AGON ACCOUNT" : "SIGN IN TO AGON"}</h2><p className="mt-4 font-mono text-[12px] leading-relaxed text-ink-2">BNB {chainId === 97 ? "Testnet" : "Mainnet"} account. Signing in grants no spending authority.</p>{activeSession ? <button className={`${BUTTON} mt-6`} onClick={async () => { await bnbLogout(chainId); setSession(null); setLoginOpen(false); }}>SIGN OUT →</button> : <button className={`${BUTTON} mt-6 w-full bg-accent text-accent-ink`} disabled={busy} onClick={login}>{busy ? "CHECK YOUR WALLET…" : "CONTINUE WITH WALLET →"}</button>}{error ? <p role="alert" className="mt-4 font-mono text-[12px] text-[color:var(--err)]">{error}</p> : null}</section></div> : null}
  </div>;
}
export function LiveMarket({ view = "market" }: { view?: "market" | "detail" | "activity" | "compare" | "publish" | "playground" }) { return <Suspense fallback={<div className="min-h-screen bg-canvas"/>}><Content view={view}/></Suspense>; }
