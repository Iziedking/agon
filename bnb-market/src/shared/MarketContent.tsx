"use client";

import { useEffect, useState, type ReactNode, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { CATEGORIES, type BnbChain, type AgentSummary, type AgentDetail, type Category, type EndpointProof, type MarketplaceStatus } from "./types";
import { checkAgentEndpoint, readCatalog, readAgent, readMarketplaceStatus, publishAgent } from "./client";
import { CommerceReadinessPanel } from "./CommerceReadinessPanel";
import { LpGuardianPanel } from "./LpGuardianPanel";
import { LpHiringPanel, type WalletRequest } from "./LpHiringPanel";
import { deriveMarketCapabilities } from "./marketplace/capabilities";
import { categoryCoverage } from "./marketplace/category-coverage";

// Shared BNB-only content. The canonical host supplies AGON's approved header,
// footer, typography and palette. No chain-specific host imports are allowed.
const INPUT = "h-12 w-full border border-[color:var(--hairline-strong)] bg-canvas px-4 font-mono text-[12px] text-ink outline-none focus:border-ink focus:ring-2 focus:ring-accent";
const BUTTON = "inline-flex min-h-11 items-center justify-center border border-[color:var(--hairline-strong)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.12em] text-ink hover:bg-canvas-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";
const PANEL = "border border-[color:var(--hairline-strong)] bg-canvas-2 p-5 sm:p-6";
const message = (error: unknown) => error instanceof Error ? error.message : "The request could not complete. Please try again.";
const plainServiceDescription = (description?: string) => {
  const cleaned = (description ?? "")
    .replace(/\bERC[- ]?8004\b|\bERC[- ]?8183\b|\bX402\b|\bMPP\b|\bA2A\b|\bMCP\b/gi, "")
    .replace(/\bthrough\s+and\s+scoped execution\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .trim();
  return cleaned || "Service details are loading.";
};
export function bnbHref(chain: BnbChain, path: string) { return `${path}${path.includes("?") ? "&" : "?"}network=${chain === 97 ? "bnb-testnet" : "bnb-mainnet"}`; }
function ErrorPanel({ error, retry }: { error: string; retry?: () => void }) {
  return <div role="alert" className={PANEL}><p className="font-mono text-sm text-ink-2">{error}</p>{retry ? <button className={`${BUTTON} mt-4`} onClick={retry}>TRY AGAIN →</button> : null}</div>;
}

function MarketplaceAgentRow({ chainId, agent }: { chainId: BnbChain; agent: AgentSummary }) {
  const [proof, setProof] = useState<EndpointProof | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isLiveService = agent.id === "2177";

  async function checkLive() {
    setBusy(true); setError(null); setProof(null);
    try { setProof(await checkAgentEndpoint(chainId, agent.id)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The service could not be reached. Try again later."); }
    finally { setBusy(false); }
  }

  return <article className="border border-[color:var(--hairline-strong)] bg-canvas-2 p-5 md:p-6" key={agent.id}>
    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_180px_180px_auto] md:items-center">
      <div><div className="flex flex-wrap gap-2">{agent.outcomeMatches.length ? agent.outcomeMatches.map((outcome, index) => <span key={`${outcome.category}:${index}`} className="border border-[color:var(--hairline-strong)] px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-accent">{outcome.source === "provider" ? "CATEGORY" : "OUTCOME MATCH"} · {CATEGORIES.find((c) => c.id === outcome.category)?.label}</span>) : <span className="border border-[color:var(--hairline)] px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-ink-3">UNCLASSIFIED SERVICE</span>}</div><h2 className="mt-3 break-words font-stencil text-[28px] uppercase leading-tight"><a href={bnbHref(chainId, `/market/${agent.id}`)}>{agent.name}</a></h2><p className="mt-2 line-clamp-2 font-mono text-[12px] leading-relaxed text-ink-2">{plainServiceDescription(agent.description)}</p></div>
      <div className="border-t border-[color:var(--hairline)] pt-4 md:border-l md:border-t-0 md:pl-5 md:pt-0"><p className="font-mono text-[10px] uppercase tracking-widest text-ink-3">PRICE</p><p className="mt-2 font-stencil text-xl uppercase">{isLiveService ? "0.1 U" : "SEE DETAILS"}</p><p className="mt-1 font-mono text-[10px] uppercase text-ink-3">{isLiveService ? "PER REPORT" : "BEFORE YOU USE"}</p></div>
      <div className="border-t border-[color:var(--hairline)] pt-4 md:border-l md:border-t-0 md:pl-5 md:pt-0"><p className="font-mono text-[10px] uppercase tracking-widest text-ink-3">LIVE CHECK</p><p className={`mt-2 font-mono text-[11px] uppercase tracking-widest ${proof?.status === "reachable" || isLiveService ? "text-accent" : "text-ink-2"}`}>{proof?.status === "reachable" ? "RESPONDED" : proof?.status === "unavailable" ? "UNAVAILABLE" : isLiveService ? "READY TO USE" : "NOT CHECKED"}</p><p className="mt-1 font-mono text-[10px] text-ink-3">{isLiveService ? "Try before paying" : "No payment sent"}</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" className={BUTTON} onClick={checkLive} disabled={busy}>{busy ? "CHECKING…" : "CHECK LIVE →"}</button><a className={`${BUTTON} ${isLiveService ? "bg-accent !text-accent-ink" : ""}`} href={bnbHref(chainId, `/market/${agent.id}`)}>{isLiveService ? "USE NOW →" : "VIEW AGENT →"}</a></div>
    </div>
    {error ? <p role="alert" className="mt-5 border-l-2 border-[color:var(--err)] pl-4 font-mono text-[12px] leading-relaxed text-ink-2">{error}</p> : null}
    {proof ? <div role="status" className="mt-5 border-t border-[color:var(--hairline)] pt-4"><p className="font-mono text-[10px] uppercase tracking-widest text-accent">{proof.status === "reachable" ? "SERVICE RESPONDED" : "SERVICE NOT AVAILABLE"}</p><p className="mt-2 font-mono text-[12px] leading-relaxed text-ink-2">{proof.message}</p><p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-ink-3">NO PAYMENT SENT</p></div> : null}
  </article>;
}

export function BnbMarketContent({ chainId }: { chainId: BnbChain }) {
  const [items, setItems] = useState<AgentSummary[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(""); const [category, setCategory] = useState("");
  const [directMatch, setDirectMatch] = useState<AgentSummary | null>(null);
  const [marketStatus, setMarketStatus] = useState<MarketplaceStatus | null>(null);
  const [retry, setRetry] = useState(0); const [checked, setChecked] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController(); setItems([]); setLoading(true); setError(null); setNext(null); setMarketStatus(null);
    readCatalog(chainId, 0, controller.signal).then((page) => { setItems(page.items); setNext(page.nextOffset); setChecked(page.checkedAt); })
      .catch((e: unknown) => { if (!controller.signal.aborted) setError(message(e)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    readMarketplaceStatus(chainId, controller.signal).then(setMarketStatus).catch(() => { if (!controller.signal.aborted) setMarketStatus(null); });
    return () => controller.abort();
  }, [chainId, retry]);
  useEffect(() => {
    const exactId = query.trim();
    if (!/^(0|[1-9][0-9]{0,77})$/.test(exactId)) { setDirectMatch(null); return; }
    const controller = new AbortController();
    setDirectMatch(null);
    readAgent(chainId, exactId, controller.signal).then((agent) => setDirectMatch(agent)).catch(() => { if (!controller.signal.aborted) setDirectMatch(null); });
    return () => controller.abort();
  }, [chainId, query]);
  async function more() {
    if (next === null || loading) return; setLoading(true); setError(null);
    try { const page = await readCatalog(chainId, next); setItems((old) => [...new Map([...old, ...page.items].map((a) => [a.id, a])).values()]); setNext(page.nextOffset); }
    catch (e) { setError(message(e)); } finally { setLoading(false); }
  }
  const searchable = [...new Map([...items, ...(directMatch ? [directMatch] : [])].map((agent) => [agent.id, agent])).values()];
  const visible = searchable.filter((a) => (!category || a.category === category || a.outcomeMatches.some((match) => match.category === category)) && `${a.name} ${a.description} ${a.id}`.toLowerCase().includes(query.trim().toLowerCase()));
  const outcomeCounts = marketStatus?.coverage ?? categoryCoverage(searchable);
  const hasDescriptionOnlyMatches = outcomeCounts.some((entry) => entry.matches > 0 && entry.providerCategories === 0);
  const catalogSummary = marketStatus
    ? marketStatus.gaps.length ? `${marketStatus.indexedProfiles} services indexed · ${marketStatus.gaps.length} goals need more services` : `${marketStatus.indexedProfiles} services indexed · all goals have matches`
    : loading ? "Checking available services" : `${searchable.length} services loaded`;
  return <>
    <div className="border-y border-[color:var(--hairline-strong)] py-5">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
        <label className="font-mono text-[10px] uppercase tracking-widest text-ink-3">SEARCH SERVICES<input className={`${INPUT} mt-2`} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="What do you need, or enter an agent ID" /></label>
        <label className="font-mono text-[10px] uppercase tracking-widest text-ink-3">CATEGORY<select className={`${INPUT} mt-2`} value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      </div>
      <div className="mt-5" aria-labelledby="outcomes-heading"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="font-mono text-[10px] uppercase tracking-widest text-accent">START WITH YOUR GOAL</p><h2 id="outcomes-heading" className="mt-2 font-stencil text-2xl uppercase">What do you need help with?</h2></div><button type="button" className={`${BUTTON} ${!category ? "bg-ink !text-[color:var(--canvas)]" : ""}`} aria-pressed={!category} onClick={() => setCategory("")}>ALL SERVICES</button></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{outcomeCounts.map((c) => <button key={c.id} aria-pressed={category === c.id} className={`${PANEL} text-left transition-colors hover:bg-canvas-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${category === c.id ? "border-accent" : ""}`} onClick={() => setCategory(category === c.id ? "" : c.id)}><span className="font-mono text-[10px] uppercase tracking-widest text-accent">{c.label}</span><span className="mt-3 block font-stencil text-xl uppercase leading-tight">{c.question}</span><span className="mt-2 block font-mono text-[11px] leading-relaxed text-ink-2">{c.description}</span><span className="mt-4 block font-mono text-[10px] uppercase tracking-widest text-ink-3">{c.matches ? `${c.matches} match${c.matches === 1 ? "" : "es"} found` : "No matches found"}</span></button>)}</div></div>
    </div>
    <div className="my-6 flex flex-wrap justify-between gap-3 font-mono text-[10px] uppercase tracking-widest text-ink-3"><span>{loading && !items.length ? "LOADING SERVICES…" : `${visible.length} ${visible.length === 1 ? "SERVICE" : "SERVICES"} FOUND`}</span><span>{checked ? `UPDATED ${new Date(checked).toLocaleTimeString()}` : "UPDATING"}</span></div>
    <p className="mb-2 max-w-[85ch] font-mono text-[12px] leading-relaxed text-ink-2">Choose a goal, open a service, try it live, then use it when you are ready. Prices and availability are shown before any wallet action.</p>
    <p role="status" className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink-3">{catalogSummary}</p>
    {hasDescriptionOnlyMatches ? <p className="mb-6 font-mono text-[11px] leading-relaxed text-ink-3">Some matches are based on the service description. Open the service and try its live check before relying on it.</p> : <div className="mb-6" />}
    {error ? <ErrorPanel error={error} retry={() => setRetry((n) => n + 1)} /> : null}
    {!loading && !error && !visible.length ? <div className={PANEL}><h2 className="font-stencil text-3xl uppercase">NO MATCHING SERVICES</h2><p className="mt-3 font-mono text-sm text-ink-2">No service matches this search yet. Clear the filters or try another agent ID.</p><button className={`${BUTTON} mt-4`} onClick={() => { setQuery(""); setCategory(""); }}>CLEAR FILTERS</button></div> : null}
    <div className="space-y-3">{visible.map((agent) => <MarketplaceAgentRow key={agent.id} chainId={chainId} agent={agent} />)}</div>
    {next !== null ? <div className="mt-8 border-t border-[color:var(--hairline)] pt-5"><button className={BUTTON} disabled={loading} onClick={more}>{loading ? "LOADING…" : "LOAD MORE AGENTS →"}</button></div> : null}
  </>;
}

export function BnbAgentContent({ chainId, id, signedIn = false, onNeedSignIn = () => undefined, walletRequest = null }: { chainId: BnbChain; id: string; signedIn?: boolean; onNeedSignIn?: () => void; walletRequest?: WalletRequest | null }) {
  const [agent, setAgent] = useState<AgentDetail | null>(null); const [error, setError] = useState<string | null>(null);
  const [liveProof, setLiveProof] = useState<EndpointProof | null>(null); const [liveBusy, setLiveBusy] = useState(false); const [liveError, setLiveError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => { const controller = new AbortController(); setAgent(null); setError(null);
    readAgent(chainId, id, controller.signal).then(setAgent).catch((e: unknown) => { if (!controller.signal.aborted) setError(message(e)); });
    return () => controller.abort(); }, [chainId, id, retry]);
  useEffect(() => { setLiveProof(null); setLiveError(null); setLiveBusy(false); }, [chainId, id]);
  async function checkLiveService() {
    setLiveBusy(true); setLiveError(null); setLiveProof(null);
    try { setLiveProof(await checkAgentEndpoint(chainId, id)); }
    catch (failure) { setLiveError(failure instanceof Error ? failure.message : "The service could not be reached. Try again later."); }
    finally { setLiveBusy(false); }
  }
  const explorer = chainId === 97 ? "https://testnet.bscscan.com" : "https://bscscan.com";
  const isLpGuardian = agent?.id === "2177" && agent.services.some((service) => service.name.toLowerCase().replace(/[-_]/g, "") === "erc8183");
  return <div className="space-y-6">
    {error ? <ErrorPanel error={error} retry={() => setRetry((n) => n + 1)} /> : null}
    {!agent && !error ? <p role="status" className="font-mono text-sm text-ink-2">LOADING SERVICE…</p> : null}
    {agent ? <>
      <div className={PANEL}><div className="font-mono text-[10px] tracking-widest text-accent">BNB {chainId === 97 ? "TESTNET" : "MAINNET"}</div><h1 className="mt-4 font-stencil text-4xl uppercase sm:text-5xl">{agent.name}</h1><p className="mt-4 max-w-[72ch] font-mono text-sm leading-relaxed text-ink-2">{plainServiceDescription(agent.description)}</p><div className="mt-5 flex flex-wrap gap-2" aria-label="What this service does">{agent.outcomeMatches.length ? agent.outcomeMatches.map((match) => <span key={match.category} className="border border-[color:var(--hairline-strong)] px-3 py-2 font-mono text-[10px] uppercase tracking-widest">{match.source === "provider" ? "CATEGORY" : "OUTCOME MATCH"} · {CATEGORIES.find((entry) => entry.id === match.category)?.label}</span>) : <span className="border border-[color:var(--hairline-strong)] px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-ink-3">UNCLASSIFIED SERVICE</span>}</div><div className="mt-6 flex flex-wrap gap-x-8 gap-y-3 border-t border-[color:var(--hairline)] pt-4 font-mono text-[11px] uppercase tracking-widest"><span><span className="text-ink-3">SERVICES </span>{agent.services.length}</span><span><span className="text-ink-3">NETWORK </span>BNB {chainId === 97 ? "TESTNET" : "MAINNET"}</span></div></div>
      <section aria-labelledby="services-heading"><div className="mb-4 flex items-end justify-between gap-4"><h2 id="services-heading" className="font-stencil text-3xl uppercase">SERVICES</h2><span className="font-mono text-[10px] uppercase tracking-widest text-ink-3">{agent.services.length} AVAILABLE</span></div><div className="grid gap-4 md:grid-cols-2">{agent.services.map((service) => {
        const isPaidReport = isLpGuardian && service.name.toLowerCase().replace(/[-_]/g, "") === "erc8183";
        const title = isPaidReport ? "Liquidity position report" : service.name.toLowerCase() === "a2a" ? "Agent service" : service.name;
        const description = isPaidReport ? "Get a read-only PancakeSwap position report with a suggested range for review." : "Open this service to see what it does and whether it is ready to use.";
        return <article className={PANEL} key={`${service.name}:${service.endpoint}`}><div className="flex flex-wrap items-start justify-between gap-3"><h3 className="font-stencil text-2xl uppercase">{title}</h3><span className="font-mono text-[11px] uppercase tracking-widest text-accent">{isPaidReport ? "0.1 U / REPORT" : "TRY BEFORE USE"}</span></div><p className="mt-4 font-mono text-[12px] leading-relaxed text-ink-2">{description}</p><div className="mt-6 flex flex-wrap gap-2">{isPaidReport ? <a className={`${BUTTON} bg-accent !text-accent-ink`} href="#hire-agent">USE NOW →</a> : <button type="button" className={BUTTON} onClick={checkLiveService} disabled={liveBusy}>{liveBusy ? "CHECKING…" : "CHECK SERVICE →"}</button>}<a className={BUTTON} href={bnbHref(chainId, `/agon/playground?agent=${encodeURIComponent(agent.id)}`)}>TRY LIVE →</a></div></article>;
      })}</div></section>
      {liveError ? <p role="alert" className="border-l-2 border-[color:var(--err)] pl-4 font-mono text-[12px] leading-relaxed text-ink-2">{liveError}</p> : null}
      {liveProof ? <section className={PANEL} role="status" aria-label="Live service result"><p className="font-mono text-[10px] uppercase tracking-widest text-accent">{liveProof.status === "reachable" ? "SERVICE RESPONDED" : "SERVICE NOT AVAILABLE"}</p><p className="mt-3 font-mono text-[12px] leading-relaxed text-ink-2">{liveProof.message}</p><p className="mt-4 font-mono text-[10px] uppercase tracking-widest text-ink-3">NO PAYMENT SENT</p></section> : null}
      <div id="provider-status">{isLpGuardian ? <LpHiringPanel key={`${chainId}:${id}`} chainId={chainId} signedIn={signedIn} onNeedSignIn={onNeedSignIn} walletRequest={walletRequest} /> : <CommerceReadinessPanel key={`${chainId}:${id}`} chainId={chainId} agentId={id} />}</div>
      <details className={PANEL}><summary className="cursor-pointer font-mono text-[12px] uppercase tracking-widest">MORE ABOUT THIS AGENT</summary><div className="mt-5 space-y-6 break-all font-mono text-[12px] text-ink-2"><div><p className="text-ink-3">OWNER</p><p className="mt-2"><a className="underline underline-offset-4" href={`${explorer}/address/${agent.owner}`} target="_blank" rel="noopener noreferrer">{agent.owner} ↗</a></p></div><div><p className="text-ink-3">AGENT WALLET</p><p className="mt-2">{agent.wallet}</p></div><div><p className="text-ink-3">CHECKED AT</p><p className="mt-2"><a className="underline" href={`${explorer}/block/${agent.blockNumber}`} target="_blank" rel="noopener noreferrer">BLOCK {agent.blockNumber} ↗</a> · {new Date(agent.checkedAt).toLocaleString()}</p></div><div><p className="text-ink-3">REGISTRATION</p><p className="mt-2">{agent.metadataStatus === "available" ? agent.registrationMatches === false ? "Network or identity mismatch. Do not use this registration." : "Readable provider metadata; service claims are not independently verified." : "Metadata unavailable. Identity is registered, but service details could not be read."}</p></div><div><p className="text-ink-3">REGISTRY</p><p className="mt-2">{agent.registry}</p></div><div><p className="text-ink-3">METADATA SNAPSHOT HASH</p><p className="mt-2">{agent.versionHash ?? "Unavailable"}</p></div><div><p className="text-ink-3">SERVICE CONNECTIONS</p>{agent.services.length ? agent.services.map((s) => <p className="mt-2" key={`${s.name}:${s.endpoint}`}>{s.name}: {s.endpoint}</p>) : <p className="mt-2">No supported public HTTPS service endpoints.</p>}</div><div><p className="text-ink-3">SERVICE CHECKS</p>{(agent.capabilities.length ? agent.capabilities : deriveMarketCapabilities(agent.services)).map((capability) => <p className="mt-2" key={capability.protocol}>{capability.protocol} · {capability.state} · {capability.reason} · {capability.endpoint}</p>)}</div></div></details>
    </> : null}
  </div>;
}

export function BnbPublishContent({ chainId, signedIn, signIn }: { chainId: BnbChain; signedIn: boolean; signIn: ReactNode }) {
  const [id, setId] = useState(""); const [category, setCategory] = useState<Category>(CATEGORIES[0].id);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [done, setDone] = useState(false);
  async function publish(e: FormEvent) { e.preventDefault(); setBusy(true); setError(null); setDone(false); try { await publishAgent(chainId, id, category); setDone(true); } catch (failure) { setError(message(failure)); } finally { setBusy(false); } }
  return <div className="max-w-[760px] space-y-6"><div className={PANEL}><h2 className="font-stencil text-3xl uppercase">LIST YOUR REGISTERED AGENT</h2><p className="mt-4 font-mono text-sm leading-relaxed text-ink-2">Use the ERC-8004 agent ID you own on BNB {chainId === 97 ? "Testnet" : "Mainnet"}. AGON checks the current onchain owner and readable service metadata before accepting a provider listing. Publishing does not award a tested badge.</p>
    {!signedIn ? <div className="mt-6">{signIn}</div> : <form onSubmit={publish} className="mt-6 space-y-5"><label className="block font-mono text-[11px] uppercase text-ink-2">AGENT ID<input className={`${INPUT} mt-2`} inputMode="numeric" pattern="[0-9]+" required value={id} onChange={(e) => setId(e.target.value)} placeholder="Your registered ERC-8004 ID" /></label><label className="block font-mono text-[11px] uppercase text-ink-2">SERVICE CATEGORY<select className={`${INPUT} mt-2`} value={category} onChange={(e) => setCategory(e.target.value as Category)}>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label><button className={`${BUTTON} bg-accent !text-accent-ink`} disabled={busy}>{busy ? "VERIFYING OWNER & PUBLISHING…" : "VERIFY AND PUBLISH →"}</button></form>}
    </div>{error ? <ErrorPanel error={error} /> : null}{done ? <div role="status" className={PANEL}><p className="font-mono text-sm">Your provider listing was saved on this network.</p><a className={`${BUTTON} mt-4`} href={bnbHref(chainId, `/market/${encodeURIComponent(id)}`)}>VIEW AGENT →</a></div> : null}</div>;
}

function GenericLiveCheck({ chainId, agent }: { chainId: BnbChain; agent: AgentDetail }) {
  const [proof, setProof] = useState<{ status: "reachable" | "unavailable"; protocol: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function check() {
    setBusy(true); setError(null); setProof(null);
    try {
      const result = await checkAgentEndpoint(chainId, agent.id);
      setProof(result);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The service could not be reached. Try again later.");
    } finally { setBusy(false); }
  }
  return <section className={PANEL} aria-labelledby="live-service-heading">
    <p className="font-mono text-[10px] uppercase tracking-widest text-accent">LIVE SERVICE CHECK</p>
    <h2 id="live-service-heading" className="mt-4 font-stencil text-3xl uppercase">{agent.name}</h2>
    <p className="mt-4 max-w-[85ch] font-mono text-sm leading-relaxed text-ink-2">Check that this service responds before you decide whether to use it. This does not start paid work or move funds.</p>
    <button type="button" className={`${BUTTON} mt-6 bg-accent !text-accent-ink`} disabled={busy} onClick={check}>{busy ? "CHECKING SERVICE…" : "CHECK SERVICE →"}</button>
    {error ? <p role="alert" className="mt-5 border-l-2 border-[color:var(--err)] pl-4 font-mono text-[12px] leading-relaxed text-ink-2">{error}</p> : null}
    {proof ? <div role="status" className="mt-6 border-t border-[color:var(--hairline)] pt-5"><p className="font-mono text-[11px] uppercase tracking-widest text-accent">{proof.status === "reachable" ? "SERVICE RESPONDED" : "SERVICE NOT AVAILABLE"}</p><p className="mt-3 font-mono text-[12px] leading-relaxed text-ink-2">{proof.message}</p><p className="mt-4 font-mono text-[10px] uppercase tracking-widest text-ink-3">{proof.protocol} · NO PAYMENT SENT</p></div> : null}
  </section>;
}

export function BnbPlaygroundContent({ chainId }: { chainId: BnbChain }) {
  const searchParams = useSearchParams();
  const requestedId = searchParams.get("agent")?.trim() ?? "";
  const [focusAgent, setFocusAgent] = useState<AgentDetail | null>(null);
  const [focusError, setFocusError] = useState<string | null>(null);
  const [input, setInput] = useState(""); const [id, setId] = useState("");
  useEffect(() => {
    if (!requestedId) { setFocusAgent(null); setFocusError(null); return; }
    const controller = new AbortController();
    setFocusAgent(null); setFocusError(null);
    readAgent(chainId, requestedId, controller.signal)
      .then(setFocusAgent)
      .catch((e: unknown) => { if (!controller.signal.aborted) setFocusError(message(e)); });
    return () => controller.abort();
  }, [chainId, requestedId]);
  return <div className="space-y-6">
    <div className={PANEL}><p className="font-mono text-[10px] uppercase tracking-widest text-accent">BNB {chainId === 97 ? "TESTNET" : "MAINNET"} · LIVE TEST</p><h1 className="mt-4 font-stencil text-4xl uppercase sm:text-5xl">{focusAgent?.name ?? (requestedId ? "LOADING SERVICE…" : "LIVE SERVICE CHECK")}</h1><p className="mt-4 max-w-[72ch] font-mono text-sm leading-relaxed text-ink-2">{focusAgent ? plainServiceDescription(focusAgent.description) : requestedId ? "Loading this service…" : "Choose a service from the market to test it live."}</p><a className="mt-5 inline-flex font-mono text-[11px] uppercase tracking-widest text-ink-2 underline underline-offset-4" href={requestedId ? bnbHref(chainId, `/market/${encodeURIComponent(requestedId)}`) : bnbHref(chainId, "/market")}>{requestedId ? "← BACK TO SERVICE" : "← BACK TO MARKET"}</a>{focusError ? <p role="alert" className="mt-4 font-mono text-[12px] text-[color:var(--err)]">{focusError}</p> : null}</div>
    {focusAgent ? (focusAgent.id === "2177" ? <LpGuardianPanel key={`${chainId}:${focusAgent.id}`} chainId={chainId}/> : <GenericLiveCheck key={`${chainId}:${focusAgent.id}`} chainId={chainId} agent={focusAgent}/>) : null}
    <div className={PANEL}><h2 className="font-stencil text-3xl uppercase">INSPECT ANOTHER SERVICE</h2><p className="mt-4 max-w-[85ch] font-mono text-sm leading-relaxed text-ink-2">Enter a registered service ID to inspect what it does and try its public check.</p><form className="mt-6 flex flex-wrap gap-3" onSubmit={(e) => { e.preventDefault(); setId(input); }}><label className="flex-1 font-mono text-[11px] uppercase">SERVICE ID<input required pattern="[0-9]+" inputMode="numeric" className={`${INPUT} mt-2`} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Registered service ID"/></label><button className={`${BUTTON} self-end`}>INSPECT SERVICE →</button></form></div>{id ? <BnbAgentContent key={`${chainId}:${id}`} chainId={chainId} id={id} /> : <a className={BUTTON} href={bnbHref(chainId, "/market")}>FIND A SERVICE IN THE MARKET →</a>}</div>;
}
