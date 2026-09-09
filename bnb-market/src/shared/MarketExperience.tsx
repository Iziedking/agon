"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CATEGORIES, CATEGORY_GUIDANCE, type AgentDetail, type AgentSummary, type BnbChain, type Category, type CommerceIntent, type EndpointProof, type LpHiringReadiness } from "./types";
import { readAgent, readMarketplaceLiveStatus, checkAgentEndpoint, checkLpHiring, readLpHires } from "./client";
import { LpHiringPanel, type WalletRequest } from "./LpHiringPanel";
import { CommerceReadinessPanel } from "./CommerceReadinessPanel";
import { bnbHref, isReportService, requestStatus, recoveryCopy } from "./marketplace/journey";

const PANEL = "min-w-0 border border-[color:var(--hairline-strong)] bg-canvas-2 p-5 sm:p-6";
const BUTTON = "inline-flex min-h-11 items-center justify-center border border-[color:var(--hairline-strong)] px-4 py-3 font-mono text-xs uppercase tracking-wide text-ink hover:bg-canvas-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";
const PRIMARY = `${BUTTON} bg-accent !text-accent-ink`;
const LABEL = "font-mono text-[11px] uppercase tracking-wide text-ink-2";
const BODY = "font-sans text-sm leading-relaxed text-ink-2";
const failureText = (value: unknown) => value instanceof Error ? value.message : "Could not load this information. Please retry.";
const name = (value: string) => /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(value) ? value.replaceAll("-", " ") : value;
const description = (value: string) => value.replace(/^\s*\[category:[^\]]+\]\s*/i, "");
const network = (chainId: BnbChain) => `BNB ${chainId === 97 ? "Testnet" : "Mainnet"}`;
const explorer = (chainId: BnbChain) => chainId === 97 ? "https://testnet.bscscan.com" : "https://bscscan.com";
const DECLARED_CATEGORY: Record<string, Category> = {
  rebalancing: "rebalancing",
  grid: "grid-trading",
  "grid-trading": "grid-trading",
  yield: "yield-optimisation",
  "yield-optimisation": "yield-optimisation",
  health: "health-factor",
  "health-factor": "health-factor",
};

function declaredCategory(value: string): Category | null {
  const declaration = value.match(/^\s*\[category:([^\]]+)\]/i)?.[1]?.trim().toLowerCase();
  return declaration ? DECLARED_CATEGORY[declaration] ?? null : null;
}

async function readAgentForDiscovery(chainId: BnbChain, id: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try { return await readAgent(chainId, id, controller.signal); }
  finally { clearTimeout(timeout); }
}

function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div role={error ? "alert" : "status"} className={`${PANEL} ${BODY}`}>{children}</div>;
}
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><dt className={LABEL}>{label}</dt><dd className="mt-2 break-words text-sm leading-relaxed [overflow-wrap:anywhere]">{children}</dd></div>;
}
function useReportReadiness(chainId: BnbChain) {
  const [value, setValue] = useState<LpHiringReadiness | null>(null);
  useEffect(() => {
    const controller = new AbortController(); setValue(null);
    if (chainId === 97) checkLpHiring(chainId, controller.signal).then(result => { if (!controller.signal.aborted) setValue(result); }).catch(() => {});
    return () => controller.abort();
  }, [chainId]);
  return value;
}

function AgentRow({ agent, chainId, readiness, category }: { agent: AgentSummary; chainId: BnbChain; readiness: LpHiringReadiness | null; category: Category }) {
  const report = chainId === 97 && readiness?.chainId === chainId && readiness.agentId === agent.id;
  return <article className={PANEL}>
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_180px_180px]">
      <div className="min-w-0"><p className={LABEL}>{CATEGORY_GUIDANCE[category].label} · Connection responded</p>
        <h2 className="mt-2 break-words font-stencil text-2xl uppercase sm:text-3xl"><a className="text-ink focus-visible:outline focus-visible:outline-accent" href={bnbHref(chainId, `/market/${agent.id}`)}>{name(agent.name)}</a></h2>
        <p className={`${BODY} mt-3 line-clamp-2 [overflow-wrap:anywhere]`}>{description(agent.description)}</p>
        <p className={`${LABEL} mt-4`}>Agent {agent.id}</p>
      </div>
      <dl className="space-y-4"><Fact label="Price">{report && readiness?.priceDisplay ? `${readiness.priceDisplay} ${readiness.token?.symbol ?? ""} / report` : "Not published"}</Fact><Fact label="Network">{network(chainId)}</Fact></dl>
      <div className="flex flex-col items-stretch justify-center gap-3"><a className={PRIMARY} href={bnbHref(chainId, `/market/${agent.id}`)}>View agent →</a></div>
    </div>
  </article>;
}

export function MarketDiscovery({ chainId }: { chainId: BnbChain }) {
  const params = useSearchParams(); const router = useRouter();
  const category = CATEGORIES.find(c => c.id === params.get("category"))?.id ?? "";
  const [items, setItems] = useState<AgentSummary[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [checkedAt, setCheckedAt] = useState(""); const [retry, setRetry] = useState(0);
  const liveCheckSequence = useRef(0);
  const readiness = useReportReadiness(chainId);

  function selectCategory(selectedCategory: Category) {
    router.replace(bnbHref(chainId, `/market?category=${selectedCategory}`), { scroll: false });
  }
  function matchesCategory(agent: AgentSummary, selectedCategory: Category) {
    const declared = declaredCategory(agent.description);
    if (declared) return declared === selectedCategory;
    return agent.category === selectedCategory || agent.outcomeMatches.some((match) => match.category === selectedCategory);
  }
  useEffect(() => {
    const sequence = liveCheckSequence.current + 1;
    liveCheckSequence.current = sequence;
    setItems([]); setError(""); setCheckedAt("");
    if (!category) { setBusy(false); return; }
    const selectedCategory = category;
    setBusy(true);
    async function loadCategory() {
      try {
        const live = await readMarketplaceLiveStatus(chainId);
        if (sequence !== liveCheckSequence.current) return;
        const coverage = live.liveCoverage.find((entry) => entry.id === selectedCategory);
        const ids = new Set(coverage?.reachableAgentIds ?? []);
        const reportReady = selectedCategory === "rebalancing" && readiness?.chainId === chainId && readiness.enabled && readiness.status === "available";
        if (reportReady && readiness.agentId) ids.add(readiness.agentId);
        const results = await Promise.allSettled([...ids].map((id) => readAgentForDiscovery(chainId, id)));
        if (sequence !== liveCheckSequence.current) return;
        const found = results
          .flatMap((result) => result.status === "fulfilled" ? [result.value] : [])
          .filter((agent) => matchesCategory(agent, selectedCategory) || (reportReady && agent.id === readiness?.agentId))
          .sort((left, right) => Number(right.id === readiness?.agentId) - Number(left.id === readiness?.agentId) || left.name.localeCompare(right.name));
        setItems([...new Map(found.map((agent) => [agent.id, agent])).values()]);
        setCheckedAt(new Date(live.checkedAt).toLocaleString());
      } catch (loadError) {
        if (sequence === liveCheckSequence.current) setError(failureText(loadError));
      } finally {
        if (sequence === liveCheckSequence.current) setBusy(false);
      }
    }
    void loadCategory();
  }, [category, chainId, readiness, retry]);

  return <div className="space-y-6">
    <section aria-labelledby="choose-category-heading">
      <p className={LABEL}>Step 1</p>
      <h2 id="choose-category-heading" className="mt-2 font-stencil text-2xl uppercase sm:text-3xl">Choose what you need</h2>
      <nav aria-label="Choose an agent category" className="mt-4 grid grid-cols-2 gap-2 xl:grid-cols-4">{CATEGORIES.map(c => <button type="button" key={c.id} onClick={() => selectCategory(c.id)} aria-pressed={category === c.id} className={`${PANEL} block min-h-24 !p-4 text-left !text-ink hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${category === c.id ? "border-accent" : ""}`}><span className="font-stencil text-base uppercase sm:text-xl">{c.label}</span><span className={`${BODY} mt-2 block !text-xs sm:!text-sm`}>{CATEGORY_GUIDANCE[c.id].question}</span></button>)}</nav>
    </section>
    {!category ? <p className={BODY}>Choose one category to see agents that responded to a live connection check.</p> : <section aria-labelledby="choose-agent-heading" className="space-y-4">
      <div><p className={LABEL}>Step 2</p><h2 id="choose-agent-heading" className="mt-2 font-stencil text-2xl uppercase sm:text-3xl">Choose an agent</h2><p className={`${BODY} mt-2`}>{CATEGORY_GUIDANCE[category].description}</p></div>
      {busy ? <Notice>Checking responding {CATEGORY_GUIDANCE[category].label.toLowerCase()} agents on {network(chainId)}...</Notice> : null}
      {error ? <Notice error><p>{error}</p><button className={`${BUTTON} mt-3`} onClick={() => setRetry((value) => value + 1)}>Retry</button></Notice> : null}
      {!busy && !error && !items.length ? <Notice><h3 className="font-stencil text-2xl uppercase">No responding agent found</h3><p className="mt-3">No {CATEGORY_GUIDANCE[category].label.toLowerCase()} agent answered the latest connection check on {network(chainId)}. No payment or task was started.</p><button className={`${BUTTON} mt-4`} onClick={() => setRetry((value) => value + 1)}>Check again</button></Notice> : null}
      {!busy && !error && items.length ? <><p role="status" className={LABEL}>{items.length} responding {items.length === 1 ? "agent" : "agents"}{checkedAt ? ` · checked ${checkedAt}` : ""}</p><div className="space-y-3">{items.map(agent => <AgentRow key={agent.id} agent={agent} chainId={chainId} readiness={readiness} category={category} />)}</div></> : null}
    </section>}
  </div>;
}

function ServiceFacts({ agent, readiness }: { agent: AgentDetail; readiness: LpHiringReadiness | null }) {
  const report = isReportService(agent, readiness);
  return <dl className="grid gap-5 sm:grid-cols-2">
    <Fact label="Price and payment">{report && readiness?.priceDisplay ? `${readiness.priceDisplay} ${readiness.token?.symbol ?? ""} per report · one-time payment` : "Not published for activation"}</Fact>
    <Fact label="Permissions">{report ? "Report payment only. No trades or position changes." : "Not published. Activation disabled."}</Fact>
    <Fact label="Network">{network(agent.chainId)}</Fact><Fact label="Task evidence">No verified task result supplied</Fact>
    <Fact label="Performance window">Not published</Fact><Fact label="Version">{agent.versionHash ?? "Unavailable"}</Fact>
    <Fact label="Owner"><a className="underline" href={`${explorer(agent.chainId)}/address/${agent.owner}`} target="_blank" rel="noopener noreferrer">{agent.owner} ↗</a></Fact>
    <Fact label="Identity checked">{new Date(agent.checkedAt).toLocaleString()} · block {agent.blockNumber}</Fact>
  </dl>;
}

export function AgentComparison({ chainId }: { chainId: BnbChain }) {
  const params = useSearchParams(); const ids = [...new Set((params.get("ids") ?? "").split(",").filter(id => /^[0-9]+$/.test(id)))].slice(0,3); const idsKey = ids.join(",");
  const [agents, setAgents] = useState<AgentDetail[]>([]); const [errors, setErrors] = useState<string[]>([]); const [busy, setBusy] = useState(true);
  const readiness = useReportReadiness(chainId);
  useEffect(() => { const controller = new AbortController(); setBusy(true); setAgents([]); setErrors([]);
    const selection = idsKey ? idsKey.split(",") : [];
    Promise.allSettled(selection.map(id => readAgent(chainId, id, controller.signal))).then(results => { if (controller.signal.aborted) return; setAgents(results.flatMap(r => r.status === "fulfilled" ? [r.value] : [])); setErrors(results.flatMap((r,i) => r.status === "rejected" ? [`Agent ${selection[i]} could not be loaded.`] : [])); setBusy(false); }); return () => controller.abort();
  // The normalized selection, not the URLSearchParams object's identity, owns this request.
  }, [chainId, idsKey]);
  return <div className="space-y-5"><p className={BODY}>Compare up to three agents. Missing information is shown explicitly; no score or return is inferred.</p>{busy ? <Notice>Loading comparison…</Notice> : null}{errors.map(error => <Notice error key={error}>{error}</Notice>)}{!busy && !agents.length ? <Notice>Select agents from the market to compare their services.</Notice> : null}<div className="grid items-start gap-4 lg:grid-cols-3">{agents.map(agent => <article className={PANEL} key={agent.id}><h2 className="break-words font-stencil text-2xl uppercase">{name(agent.name)}</h2><p className={`${BODY} my-5`}>{description(agent.description)}</p><ServiceFacts agent={agent} readiness={readiness} /><a className={`${PRIMARY} mt-6 w-full`} href={bnbHref(chainId, `/market/${agent.id}`)}>View service →</a></article>)}</div><a className={BUTTON} href={bnbHref(chainId, "/market")}>Choose other agents</a></div>;
}

export function AgentService({ chainId, id, signedIn = false, onNeedSignIn = () => undefined, walletRequest = null }: { chainId: BnbChain; id: string; signedIn?: boolean; onNeedSignIn?: () => void; walletRequest?: WalletRequest | null }) {
  const [agent, setAgent] = useState<AgentDetail | null>(null); const [error, setError] = useState(""); const [retry, setRetry] = useState(0);
  const [proof, setProof] = useState<EndpointProof | null>(null); const [checking, setChecking] = useState(false);
  const readiness = useReportReadiness(chainId);
  useEffect(() => { const controller = new AbortController(); setAgent(null); setError(""); setProof(null);
    readAgent(chainId,id,controller.signal).then(agent => { if (!controller.signal.aborted) setAgent(agent); }).catch(error => { if (!controller.signal.aborted) setError(failureText(error)); }); return () => controller.abort();
  }, [chainId,id,retry]);
  async function check() { setChecking(true); setError(""); try { setProof(await checkAgentEndpoint(chainId,id)); } catch(error) { setError(failureText(error)); } finally { setChecking(false); } }
  const report = agent ? isReportService(agent, readiness) : false;
  return <div className="space-y-6">{error ? <Notice error><p>{error}</p><button className={`${BUTTON} mt-3`} onClick={() => setRetry(x=>x+1)}>Retry</button></Notice> : null}{!agent && !error ? <Notice>Loading agent and service version…</Notice> : null}{agent ? <>
    <header className="border-b border-[color:var(--hairline)] pb-6"><p className={LABEL}>{network(chainId)} · {agent.category ? CATEGORIES.find(c=>c.id===agent.category)?.label : "Provider service"}</p><h1 className="mt-4 break-words font-stencil text-4xl uppercase leading-tight sm:text-5xl">{name(agent.name)}</h1><p className={`${BODY} mt-4 max-w-[80ch]`}>{description(agent.description)}</p></header>
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]"><div className="min-w-0 space-y-6"><section className={PANEL}><h2 className="font-stencil text-3xl uppercase">{report ? "Liquidity position report" : "Service overview"}</h2><p className={`${BODY} mt-4`}>{report ? "Get a report for one PancakeSwap position, including its current range and a proposed range when enough market data is available. Nothing in the position is changed." : "Review the provider’s stated service and connection details. This listing does not yet expose a supported activation or payment flow in AGON."}</p><dl className="mt-5 grid gap-5 sm:grid-cols-2"><Fact label="You provide">{report ? "PancakeSwap position ID" : "Input requirements not published"}</Fact><Fact label="You receive">{report ? "A downloadable position report" : "Output requirements not published"}</Fact></dl><div className="mt-6 flex flex-wrap gap-2">{report ? <a className={PRIMARY} href="#hire-agent">Configure report →</a> : <button className={BUTTON} disabled>Activation unavailable</button>}<a className={BUTTON} href={bnbHref(chainId, `/agon/playground?agent=${id}`)}>Open Playground →</a></div></section>
    {report ? <LpHiringPanel key={`${chainId}:${id}:${signedIn}`} chainId={chainId} version={agent.versionHash ?? "unavailable"} signedIn={signedIn} onNeedSignIn={onNeedSignIn} walletRequest={walletRequest} /> : <section className={PANEL}><h2 className="font-stencil text-2xl uppercase">Before activation</h2><p className={`${BODY} mt-3`}>This provider must publish a supported service version, input requirements, price and permissions before AGON can prepare a wallet action. A successful connection check alone does not enable hiring.</p><dl className="mt-5 grid gap-4 sm:grid-cols-2"><Fact label="Call allowlist">Not provided</Fact><Fact label="Spend cap and expiry">Not provided</Fact><Fact label="Session registration">Not provided</Fact><Fact label="Stop or revoke">No session controls available here</Fact></dl><a className={`${BUTTON} mt-5`} href={bnbHref(chainId, "/market")}>Find another agent →</a></section>}
    <section className={PANEL}><h2 className="font-stencil text-2xl uppercase">Evidence and version</h2><div className="mt-5"><ServiceFacts agent={agent} readiness={readiness}/></div><p className={`${BODY} mt-5`}>Provider descriptions are claims. Identity verification, a responding connection, a task result, and an onchain payment are separate records.</p></section>
    <details className={PANEL}><summary className="min-h-11 cursor-pointer py-3 font-mono text-xs uppercase">Technical details</summary><dl className="mt-4 space-y-5"><Fact label="Registration">{agent.registrationMatches === false ? "Network or identity mismatch. Do not activate." : agent.metadataStatus === "available" ? "Metadata readable" : "Metadata unavailable"}</Fact><Fact label="Registry">{agent.registry}</Fact><Fact label="Provider connections">{agent.services.length ? agent.services.map((s,i)=><p key={i} className="mb-2 break-all">{s.name}: {s.endpoint}</p>) : "No public connections"}</Fact></dl>{!report ? <CommerceReadinessPanel chainId={chainId} agentId={id} /> : null}</details></div>
    <aside className={`${PANEL} space-y-5 xl:sticky xl:top-24`} aria-label="Service availability"><h2 className="font-stencil text-2xl uppercase">Before you use it</h2><dl className="space-y-5"><Fact label="Network">{network(chainId)}</Fact><Fact label="Price">{report && readiness?.priceDisplay ? `${readiness.priceDisplay} ${readiness.token?.symbol ?? ""} / report` : "Not published for activation"}</Fact><Fact label="Availability">{proof ? proof.status === "reachable" ? "Connection responded" : "Connection unavailable" : "Not checked in this visit"}</Fact><Fact label="Task results">Not verified for this version</Fact></dl><button className={`${BUTTON} w-full`} onClick={check} disabled={checking}>{checking ? "Checking…" : "Check live connection"}</button>{proof ? <p role="status" className={BODY}>{proof.message} Checked {new Date(proof.checkedAt).toLocaleString()}. No task or payment was started.</p> : null}<a className={`${BUTTON} w-full`} href={bnbHref(chainId, `/market/compare?ids=${id}`)}>Compare this agent</a><a className="inline-flex min-h-11 items-center text-sm underline" href={bnbHref(chainId, "/market/activity")}>View your activity →</a></aside></div>
  </> : null}</div>;
}

export function ActivityRoom({ chainId, signedIn, signIn }: { chainId: BnbChain; signedIn: boolean; signIn: ReactNode }) {
  const params = useSearchParams(); const selectedId = params.get("intent");
  const [items, setItems] = useState<CommerceIntent[]>([]); const [error, setError] = useState(""); const [busy, setBusy] = useState(true); const [retry, setRetry] = useState(0);
  useEffect(()=>{ const controller=new AbortController(); setItems([]); setError(""); setBusy(true);
    if (!signedIn || chainId !== 97) { setBusy(false); return; }
    readLpHires(chainId,controller.signal).then(result=>{if(!controller.signal.aborted)setItems(result.items);}).catch(error=>{if(!controller.signal.aborted)setError(failureText(error));}).finally(()=>{if(!controller.signal.aborted)setBusy(false);}); return()=>controller.abort();
  },[chainId,signedIn,retry]);
  const item=items.find(i=>i.id===selectedId);
  if(chainId!==97) return <Notice><h2 className="font-stencil text-2xl uppercase">Mainnet activity is not available yet</h2><p className="mt-3">This does not mean your wallet has no activity. AGON currently retrieves report requests on BNB Testnet only.</p><a className={`${BUTTON} mt-4`} href={bnbHref(97,"/market/activity")}>View Testnet requests →</a></Notice>;
  if(!signedIn) return <Notice><p className="mb-4">Sign in to view your own requests and receipts. Signing in grants no spending authority.</p>{signIn}</Notice>;
  return <div className="space-y-5"><div className="flex flex-wrap justify-between gap-3"><a className={BUTTON} href={bnbHref(chainId,"/market")}>Find an agent →</a><button className={BUTTON} disabled={busy} onClick={()=>setRetry(x=>x+1)}>Refresh activity</button></div>{error?<Notice error>{error}</Notice>:null}{busy?<Notice>Loading your requests…</Notice>:null}{!busy&&!error&&!items.length?<Notice>No report requests for this account yet. Start from a service in the market.</Notice>:null}{selectedId&&!item&&!busy?<Notice>The selected request is not in this account’s loaded history. Choose a request below or refresh.</Notice>:null}
    {item ? <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]"><article className={PANEL}><p className={LABEL}>Request {item.id}</p><h2 className="mt-3 font-stencil text-3xl uppercase">LP Guardian report</h2><p className={`${BODY} mt-3`}>{requestStatus(item)}</p><h3 className="mt-7 font-stencil text-2xl uppercase">Transaction timeline</h3><ol className="mt-4 space-y-4">{item.transactions.map(tx=><li className="border-l-2 border-[color:var(--hairline-strong)] pl-4" key={tx.step}><p className={LABEL}>{tx.step} · {tx.status}</p><a className="mt-2 inline-flex min-h-11 items-center break-all text-sm underline" href={`${explorer(chainId)}/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer">{tx.hash} ↗</a></li>)}</ol>{!item.transactions.length?<p className={`${BODY} mt-3`}>No submitted transactions recorded.</p>:null}<h3 className="mt-7 font-stencil text-2xl uppercase">Delivery</h3><p className={`${BODY} mt-3`}>{item.delivery?.error ?? (item.delivery?.status === "submitted" ? "The provider submitted a report. Open it and inspect the result; submission alone is not an independent quality check." : "No report has been submitted yet.")}</p>{item.delivery?.status==="submitted"&&item.delivery.url?<a className={`${PRIMARY} mt-4`} href={item.delivery.url} target="_blank" rel="noopener noreferrer">Open report →</a>:null}{item.delivery?.txHash?<a className={`${BUTTON} mt-4`} href={`${explorer(chainId)}/tx/${item.delivery.txHash}`} target="_blank" rel="noopener noreferrer">Delivery receipt ↗</a>:null}</article><aside className={`${PANEL} space-y-5`}><h3 className="font-stencil text-2xl uppercase">Your next step</h3><dl className="space-y-5"><Fact label="Status">{requestStatus(item)}</Fact><Fact label="Price">{item.amountDisplay} {item.token.symbol}</Fact><Fact label="Payment">{item.transactions.some(t=>t.step==="fund"&&t.status==="confirmed")?"Funding confirmed":"Funding not confirmed"}</Fact><Fact label="Network">{network(chainId)}</Fact><Fact label="Requester">{item.buyerAddress}</Fact><Fact label="Provider">{item.providerAddress}</Fact><Fact label="Authority">One report. No permission to change your position.</Fact></dl><a className={`${PRIMARY} w-full`} href={bnbHref(chainId,`/market/${item.agentId}?intent=${encodeURIComponent(item.id)}#hire-agent`)}>Open request →</a><p className={BODY}>{recoveryCopy(item)}</p><details><summary className="min-h-11 cursor-pointer py-3 text-sm">Stop, revoke or dispute</summary><p className={BODY}>These controls are not supported by this report interface. Closing the page does not cancel a funded job or revoke a token approval. Inspect the receipts and your wallet’s approvals before taking further action.</p></details></aside></div>:null}
    <div className="space-y-3">{items.map(item=><article key={item.id} className={`${PANEL} flex flex-wrap items-center justify-between gap-4`}><div><p className={LABEL}>{requestStatus(item)}</p><h2 className="mt-2 font-stencil text-2xl uppercase">LP Guardian report</h2><p className={`${BODY} mt-2`}>{item.amountDisplay} {item.token.symbol} · {new Date(item.updatedAt).toLocaleString()}</p></div><a className={BUTTON} href={bnbHref(chainId,`/market/activity?intent=${encodeURIComponent(item.id)}`)}>View activity →</a></article>)}</div>
  </div>;
}
