"use client";

import { useEffect, useState, type ReactNode, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { CATEGORIES, type BnbChain, type AgentDetail, type Category, type EndpointProof } from "./types";
import { checkAgentEndpoint, readAgent, publishAgent, type PublishedListing } from "./client";
import { LpGuardianPanel } from "./LpGuardianPanel";
import { AgentService as BnbAgentContent } from "./MarketExperience";
import { bnbHref } from "./marketplace/journey";
export { bnbHref } from "./marketplace/journey";
export { MarketDiscovery as BnbMarketContent, AgentComparison as BnbCompareContent, AgentService as BnbAgentContent, ActivityRoom as BnbActivityContent } from "./MarketExperience";

const INPUT = "h-12 w-full border border-[color:var(--hairline-strong)] bg-canvas px-4 font-mono text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";
const BUTTON = "inline-flex min-h-11 items-center justify-center border border-[color:var(--hairline-strong)] px-4 py-3 font-mono text-xs uppercase tracking-wide text-ink hover:bg-canvas-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";
const PANEL = "min-w-0 border border-[color:var(--hairline-strong)] bg-canvas-2 p-5 sm:p-6";
const message = (error: unknown) => error instanceof Error ? error.message : "The request could not complete. Please try again.";
const plainAgentName = (name: string) => /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(name) ? name.replaceAll("-", " ") : name;
const plainServiceDescription = (description?: string) => description?.replace(/^\s*\[category:[^\]]+\]\s*/i, "") || "No service description published.";
function ErrorPanel({ error }: { error: string }) { return <div role="alert" className={PANEL}><p className="text-sm text-ink-2">{error}</p></div>; }

export function BnbPublishContent({ chainId, signedIn, signIn }: { chainId: BnbChain; signedIn: boolean; signIn: ReactNode }) {
  const [id, setId] = useState(""); const [category, setCategory] = useState<Category>(CATEGORIES[0].id);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [done, setDone] = useState(false);
  const [preflight, setPreflight] = useState<EndpointProof | null>(null); const [preflightBusy, setPreflightBusy] = useState(false);
  const [previewAgent, setPreviewAgent] = useState<AgentDetail | null>(null);
  const [published, setPublished] = useState<PublishedListing | null>(null);
  function changeId(value: string) { setId(value); setPreflight(null); setPreviewAgent(null); setPublished(null); setError(null); setDone(false); }
  async function checkService() {
    if (!/^[0-9]+$/.test(id)) { setError("Enter your registered agent ID first."); return; }
    setPreflightBusy(true); setError(null); setPreflight(null); setDone(false);
    try {
      const [detail, proof] = await Promise.all([readAgent(chainId, id), checkAgentEndpoint(chainId, id)]);
      setPreviewAgent(detail); setPreflight(proof);
    }
    catch (failure) { setError(message(failure)); }
    finally { setPreflightBusy(false); }
  }
  async function publish(e: FormEvent) {
    e.preventDefault();
    if (preflight?.status !== "reachable") { setError("Check the service first. Your public endpoint must respond before it can be listed."); return; }
    setBusy(true); setError(null); setDone(false);
    try { setPublished(await publishAgent(chainId, id, category)); setDone(true); }
    catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  }
  return <div className="max-w-[760px] space-y-6"><div className={PANEL}><h2 className="font-stencil text-3xl uppercase">LIST YOUR REGISTERED AGENT</h2><p className="mt-4 font-mono text-sm leading-relaxed text-ink-2">Bring a service you own on BNB {chainId === 97 ? "Testnet" : "Mainnet"}. First check that it responds, review what buyers will see, then publish it.</p>
    {!signedIn ? <div className="mt-6">{signIn}</div> : <form onSubmit={publish} className="mt-6 space-y-5"><label className="block font-mono text-[11px] uppercase text-ink-2">REGISTERED AGENT ID<input className={`${INPUT} mt-2`} inputMode="numeric" pattern="[0-9]+" required value={id} onChange={(e) => changeId(e.target.value)} placeholder="Enter the ID for the service you own" /></label><div className="border border-[color:var(--hairline)] p-4"><p className="font-mono text-[10px] uppercase tracking-widest text-accent">STEP 1 · CHECK YOUR SERVICE</p><p className="mt-2 font-mono text-[12px] leading-relaxed text-ink-2">This is a free read-only check. It does not publish, charge, or start a job.</p><button type="button" className={`${BUTTON} mt-4`} onClick={checkService} disabled={preflightBusy}>{preflightBusy ? "CHECKING SERVICE…" : "CHECK SERVICE →"}</button>{preflight ? <div role="status" className="mt-4 border-t border-[color:var(--hairline)] pt-4"><p className={`font-mono text-[11px] uppercase tracking-widest ${preflight.status === "reachable" ? "text-accent" : "text-ink-2"}`}>{preflight.status === "reachable" ? "SERVICE RESPONDED" : "SERVICE NOT AVAILABLE"}</p><p className="mt-2 font-mono text-[12px] leading-relaxed text-ink-2">{preflight.message}</p><p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-ink-3">NO PAYMENT SENT</p></div> : null}</div>{previewAgent && preflight?.status === "reachable" ? <div className="border border-[color:var(--hairline)] bg-canvas-3 p-4"><p className="font-mono text-[10px] uppercase tracking-widest text-accent">READY TO LIST</p><h3 className="mt-2 font-stencil text-2xl uppercase">{previewAgent.name}</h3><p className="mt-2 font-mono text-[12px] leading-relaxed text-ink-2">{plainServiceDescription(previewAgent.description)}</p><p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-ink-3">{previewAgent.services.length} PUBLIC SERVICE{previewAgent.services.length === 1 ? "" : "S"} · {CATEGORIES.find((entry) => entry.id === category)?.label}</p></div> : null}<label className="block font-mono text-[11px] uppercase text-ink-2">WHAT DOES IT HELP WITH?<select className={`${INPUT} mt-2`} value={category} onChange={(e) => setCategory(e.target.value as Category)}>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label><button className={`${BUTTON} bg-accent !text-accent-ink`} disabled={busy || preflight?.status !== "reachable"}>{busy ? "PUBLISHING SERVICE…" : "PUBLISH SERVICE →"}</button></form>}
    </div>{error ? <ErrorPanel error={error} /> : null}{done && published ? <div role="status" className={PANEL}><p className="font-mono text-[10px] uppercase tracking-widest text-accent">SERVICE LISTED</p><h3 className="mt-2 font-stencil text-2xl uppercase">{previewAgent?.name ?? `Agent ${published.agentId}`}</h3><p className="mt-3 font-mono text-sm text-ink-2">Buyers can now discover this service on BNB {chainId === 97 ? "Testnet" : "Mainnet"}.</p><div className="mt-5 flex flex-wrap gap-2"><a className={`${BUTTON} bg-accent !text-accent-ink`} href={bnbHref(chainId, `/market/${encodeURIComponent(published.agentId)}`)}>VIEW SERVICE →</a><a className={BUTTON} href={bnbHref(chainId, "/market")}>OPEN MARKET →</a></div></div> : null}</div>;
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
    <h2 id="live-service-heading" className="mt-4 font-stencil text-3xl uppercase">{plainAgentName(agent.name)}</h2>
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
    {focusAgent ? (chainId === 97 && focusAgent.id === "2177" ? <LpGuardianPanel key={`${chainId}:${focusAgent.id}`} chainId={chainId}/> : <GenericLiveCheck key={`${chainId}:${focusAgent.id}`} chainId={chainId} agent={focusAgent}/>) : null}
    <div className={PANEL}><h2 className="font-stencil text-3xl uppercase">INSPECT ANOTHER SERVICE</h2><p className="mt-4 max-w-[85ch] font-mono text-sm leading-relaxed text-ink-2">Enter a registered service ID to inspect what it does and try its public check.</p><form className="mt-6 flex flex-wrap gap-3" onSubmit={(e) => { e.preventDefault(); setId(input); }}><label className="flex-1 font-mono text-[11px] uppercase">SERVICE ID<input required pattern="[0-9]+" inputMode="numeric" className={`${INPUT} mt-2`} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Registered service ID"/></label><button className={`${BUTTON} self-end`}>INSPECT SERVICE →</button></form></div>{id ? <BnbAgentContent key={`${chainId}:${id}`} chainId={chainId} id={id} /> : <a className={BUTTON} href={bnbHref(chainId, "/market")}>FIND A SERVICE IN THE MARKET →</a>}</div>;
}
