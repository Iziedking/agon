"use client";

import { useEffect, useState, type ReactNode, type FormEvent } from "react";
import { CATEGORIES, type BnbChain, type AgentSummary, type AgentDetail, type Category, type EndpointProof } from "./types";
import { readCatalog, readAgent, checkAgentEndpoint, publishAgent } from "./client";

// Shared BNB-only content. The canonical host supplies AGON's approved header,
// footer, typography and palette. No chain-specific host imports are allowed.
const INPUT = "h-12 w-full border border-[color:var(--hairline-strong)] bg-canvas px-4 font-mono text-[12px] text-ink outline-none focus:border-ink focus:ring-2 focus:ring-accent";
const BUTTON = "inline-flex min-h-11 items-center justify-center border border-[color:var(--hairline-strong)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.12em] text-ink hover:bg-canvas-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";
const PANEL = "border border-[color:var(--hairline-strong)] bg-canvas-2 p-5 sm:p-6";
const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const message = (error: unknown) => error instanceof Error ? error.message : "The request could not complete. Please try again.";
export function bnbHref(chain: BnbChain, path: string) { return `${path}${path.includes("?") ? "&" : "?"}network=${chain === 97 ? "bnb-testnet" : "bnb-mainnet"}`; }
function ErrorPanel({ error, retry }: { error: string; retry?: () => void }) {
  return <div role="alert" className={PANEL}><p className="font-mono text-sm text-ink-2">{error}</p>{retry ? <button className={`${BUTTON} mt-4`} onClick={retry}>TRY AGAIN →</button> : null}</div>;
}
export function BnbMarketContent({ chainId }: { chainId: BnbChain }) {
  const [items, setItems] = useState<AgentSummary[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(""); const [category, setCategory] = useState("");
  const [retry, setRetry] = useState(0); const [checked, setChecked] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController(); setItems([]); setLoading(true); setError(null); setNext(null);
    readCatalog(chainId, 0, controller.signal).then((page) => { setItems(page.items); setNext(page.nextOffset); setChecked(page.checkedAt); })
      .catch((e: unknown) => { if (!controller.signal.aborted) setError(message(e)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [chainId, retry]);
  async function more() {
    if (next === null || loading) return; setLoading(true); setError(null);
    try { const page = await readCatalog(chainId, next); setItems((old) => [...new Map([...old, ...page.items].map((a) => [a.id, a])).values()]); setNext(page.nextOffset); }
    catch (e) { setError(message(e)); } finally { setLoading(false); }
  }
  const visible = items.filter((a) => (!category || a.category === category) && `${a.name} ${a.description} ${a.id}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <>
    <div className="border-y border-[color:var(--hairline-strong)] py-5">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
        <label className="font-mono text-[10px] uppercase tracking-widest text-ink-3">SEARCH LOADED AGENTS<input className={`${INPUT} mt-2`} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, skill, or agent ID" /></label>
        <label className="font-mono text-[10px] uppercase tracking-widest text-ink-3">CATEGORY<select className={`${INPUT} mt-2`} value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      </div>
      <div className="mt-4 flex flex-wrap gap-2" aria-label="Agent outcomes">{CATEGORIES.map((c) => <button key={c.id} aria-pressed={category === c.id} className={`${BUTTON} ${category === c.id ? "bg-ink !text-[color:var(--canvas)]" : ""}`} onClick={() => setCategory(category === c.id ? "" : c.id)}>{c.label}</button>)}</div>
    </div>
    <div className="my-6 flex flex-wrap justify-between gap-3 font-mono text-[10px] uppercase tracking-widest text-ink-3"><span>{loading && !items.length ? "READING BNB REGISTRY INDEX…" : `${visible.length} OF ${items.length} LOADED PROFILES`}</span><span>8004SCAN · {checked ? new Date(checked).toLocaleTimeString() : "CONNECTING"}</span></div>
    <p className="mb-6 max-w-[85ch] font-mono text-[12px] leading-relaxed text-ink-2">Discover registered agents on this network. Registration is not a performance endorsement. Open a profile to check its onchain owner and advertised endpoints. Categories are supplied by providers, never guessed.</p>
    {error ? <ErrorPanel error={error} retry={() => setRetry((n) => n + 1)} /> : null}
    {!loading && !error && !visible.length ? <div className={PANEL}><h2 className="font-stencil text-3xl uppercase">NO MATCHING PROFILES</h2><p className="mt-3 font-mono text-sm text-ink-2">No provider-classified match in the loaded profiles. Clear filters or load more agents.</p><button className={`${BUTTON} mt-4`} onClick={() => { setQuery(""); setCategory(""); }}>CLEAR FILTERS</button></div> : null}
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">{visible.map((agent) => <article className={PANEL} key={agent.id}>
      <div className="flex flex-wrap justify-between gap-3 font-mono text-[10px] uppercase tracking-widest text-ink-3"><span className="text-accent">REGISTERED IDENTITY</span><span>#{agent.id} · CHAIN {chainId}</span></div>
      <h2 className="mt-5 break-words font-stencil text-[28px] uppercase leading-tight"><a href={bnbHref(chainId, `/market/${agent.id}`)}>{agent.name}</a></h2>
      <p className="mt-3 line-clamp-3 min-h-[4.5em] font-mono text-[12px] leading-relaxed text-ink-2">{agent.description || "The provider has not supplied a description."}</p>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--hairline)] pt-4"><span className="font-mono text-[10px] uppercase text-ink-3">OWNER {short(agent.owner)}</span><a className={BUTTON} href={bnbHref(chainId, `/market/${agent.id}`)}>INSPECT AGENT →</a></div>
    </article>)}</div>
    {next !== null ? <div className="mt-8 border-t border-[color:var(--hairline)] pt-5"><button className={BUTTON} disabled={loading} onClick={more}>{loading ? "LOADING…" : "LOAD MORE AGENTS →"}</button></div> : null}
  </>;
}

export function BnbAgentContent({ chainId, id }: { chainId: BnbChain; id: string }) {
  const [agent, setAgent] = useState<AgentDetail | null>(null); const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0); const [proof, setProof] = useState<EndpointProof | null>(null); const [testing, setTesting] = useState(false);
  useEffect(() => { const controller = new AbortController(); setAgent(null); setError(null); setProof(null);
    readAgent(chainId, id, controller.signal).then(setAgent).catch((e: unknown) => { if (!controller.signal.aborted) setError(message(e)); });
    return () => controller.abort(); }, [chainId, id, retry]);
  async function testEndpoint() { setTesting(true); setError(null); try { setProof(await checkAgentEndpoint(chainId, id)); } catch (e) { setError(message(e)); } finally { setTesting(false); } }
  const explorer = chainId === 97 ? "https://testnet.bscscan.com" : "https://bscscan.com";
  return <div className="space-y-6">
    {error ? <ErrorPanel error={error} retry={() => setRetry((n) => n + 1)} /> : null}
    {!agent && !error ? <p role="status" className="font-mono text-sm text-ink-2">CHECKING OWNERSHIP ON BNB…</p> : null}
    {agent ? <>
      <div className={PANEL}><div className="font-mono text-[10px] tracking-widest text-accent">ONCHAIN IDENTITY · BNB {chainId === 97 ? "TESTNET" : "MAINNET"}</div><h2 className="mt-4 font-stencil text-4xl uppercase">{agent.name}</h2><p className="mt-3 max-w-[85ch] font-mono text-sm leading-relaxed text-ink-2">{agent.description || "No readable service description supplied."}</p></div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className={PANEL}><h3 className="font-stencil text-2xl uppercase">IDENTITY & OWNERSHIP</h3><dl className="mt-5 space-y-4 break-all font-mono text-[12px] text-ink-2">
          <dt>OWNER</dt><dd><a className="underline underline-offset-4" href={`${explorer}/address/${agent.owner}`} target="_blank" rel="noopener noreferrer">{agent.owner} ↗</a></dd>
          <dt>AGENT WALLET</dt><dd>{agent.wallet}</dd><dt>CHECKED AT BLOCK</dt><dd><a className="underline" href={`${explorer}/block/${agent.blockNumber}`} target="_blank" rel="noopener noreferrer">{agent.blockNumber} ↗</a> · {new Date(agent.checkedAt).toLocaleString()}</dd>
          <dt>REGISTRATION</dt><dd>{agent.metadataStatus === "available" ? agent.registrationMatches === false ? "Network / identity mismatch. Do not use this registration." : "Readable provider metadata; service claims are not independently verified." : "Metadata unavailable. Identity is registered, but service details could not be read."}</dd>
        </dl></div>
        <div className={PANEL}><h3 className="font-stencil text-2xl uppercase">CHECK BEFORE YOU HIRE</h3><p className="mt-4 font-mono text-[12px] leading-relaxed text-ink-2">Check the advertised discovery endpoint without connecting a wallet. This reads the agent card or service status only: it does not run a task, grant authority, or spend funds.</p><button className={`${BUTTON} mt-5`} disabled={testing || !agent.services.some((s) => s.name.toLowerCase() === "a2a" || (s.name.toLowerCase() === "erc-8183" && new URL(s.endpoint).pathname.endsWith("/status"))) || agent.registrationMatches === false} onClick={testEndpoint}>{testing ? "CHECKING ENDPOINT…" : "CHECK AGENT ENDPOINT →"}</button>
          {proof ? <div role="status" className="mt-5 border-l-2 border-accent pl-4 font-mono text-[12px] leading-relaxed text-ink-2"><p className="uppercase text-ink">{proof.status}</p><p>{proof.message}</p><p className="mt-2">{new Date(proof.checkedAt).toLocaleString()}</p></div> : null}
          <p className="mt-5 font-mono text-[11px] leading-relaxed text-ink-3">Hiring is not enabled for this profile until its price, execution interface, and payment contract have been verified. No invented price or transaction.</p>
        </div>
      </div>
      <details className={PANEL}><summary className="cursor-pointer font-mono text-[12px] uppercase tracking-widest">TECHNICAL PROOF & SERVICE ENDPOINTS</summary><dl className="mt-5 space-y-3 break-all font-mono text-[12px] text-ink-2"><dt>REGISTRY</dt><dd>{agent.registry}</dd><dt>METADATA SNAPSHOT HASH</dt><dd>{agent.versionHash ?? "Unavailable"}</dd><dt>DECLARED SERVICES</dt><dd>{agent.services.length ? agent.services.map((s) => <p className="mb-2" key={`${s.name}:${s.endpoint}`}>{s.name}: {s.endpoint}</p>) : "No supported public HTTPS service endpoints."}</dd></dl></details>
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

export function BnbPlaygroundContent({ chainId }: { chainId: BnbChain }) {
  const [input, setInput] = useState(""); const [id, setId] = useState("");
  return <div className="space-y-6"><div className={PANEL}><h2 className="font-stencil text-3xl uppercase">INSPECT BEFORE YOU EXECUTE</h2><p className="mt-4 max-w-[85ch] font-mono text-sm leading-relaxed text-ink-2">Start with a registered BNB agent ID. Inspect its onchain identity, then check the public discovery endpoint. This read-only check is available now. Category task execution and paid sandbox runs are not enabled yet; endpoint availability does not earn a tested badge.</p><form className="mt-6 flex flex-wrap gap-3" onSubmit={(e) => { e.preventDefault(); setId(input); }}><label className="flex-1 font-mono text-[11px] uppercase">AGENT ID<input required pattern="[0-9]+" inputMode="numeric" className={`${INPUT} mt-2`} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Registered ERC-8004 ID"/></label><button className={`${BUTTON} self-end`}>INSPECT AGENT →</button></form></div>{id ? <BnbAgentContent key={`${chainId}:${id}`} chainId={chainId} id={id}/> : <a className={BUTTON} href={bnbHref(chainId, "/market")}>FIND AN AGENT IN THE MARKET →</a>}</div>;
}
