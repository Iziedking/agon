"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { BnbChain, LpHiringReadiness } from "./types";
import type { LpRun } from "./providers/lp-runs";
import { checkLpHiring, readLpAnalysis, startLpAnalysis } from "./client";

const BUTTON = "inline-flex min-h-11 items-center justify-center border border-[color:var(--hairline-strong)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.12em] text-ink hover:bg-canvas-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";
const INPUT = "mt-2 h-12 w-full border border-[color:var(--hairline-strong)] bg-canvas px-4 font-mono text-sm text-ink focus:outline focus:outline-2 focus:outline-accent";
const HIRING_BLOCKERS: Record<string, string> = {
  testnet_only: "Protected hiring is being proven on BNB Testnet before Mainnet is opened.",
  hiring_flag_disabled: "The operator has not opened paid hiring.",
  agent_identity_unconfigured: "The AGON-operated agent identity is not configured.",
  provider_wallet_unconfigured: "The provider wallet is not configured.",
  exact_price_unconfigured: "The exact service price is not configured.",
  public_provider_url_unconfigured: "The public provider endpoint is not configured.",
  altana_session_unconfigured: "The provider's bounded signing session is not configured.",
  registration_not_qualified: "The onchain agent registration is not active and readable.",
  provider_wallet_mismatch: "The registered agent wallet differs from the configured provider.",
  provider_endpoint_mismatch: "The registered payment endpoint differs from the configured provider.",
  registration_unavailable: "The provider registration could not be verified.",
  provider_execution_unavailable: "The delivery worker is not live, so AGON will not let a buyer lock funds yet.",
};

function HiringReadiness({ chainId }: { chainId: BnbChain }) {
  const [readiness, setReadiness] = useState<LpHiringReadiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setReadiness(null); setError(null);
    checkLpHiring(chainId, controller.signal).then(setReadiness).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Hiring readiness could not be checked.");
    });
    return () => controller.abort();
  }, [chainId, retry]);
  return <aside className="mt-6 border-t border-[color:var(--hairline-strong)] pt-5" aria-label="Protected hiring readiness">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="font-mono text-[10px] uppercase tracking-widest text-accent">PROTECTED HIRING</p>
        <p className="mt-2 max-w-[85ch] font-mono text-[11px] leading-relaxed text-ink-2">A signed quote and exact-value ERC-8183 wallet flow are prepared only after every provider, contract and delivery check passes.</p></div>
      <span className="border border-[color:var(--hairline-strong)] px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-ink-2">{readiness?.enabled ? "READY" : readiness ? "CLOSED" : error ? "CHECK FAILED" : "CHECKING…"}</span>
    </div>
    {error ? <div role="alert" className="mt-4 border-l-2 border-accent pl-4 font-mono text-[11px] leading-relaxed text-ink-2"><p>{error}</p><button type="button" className={`${BUTTON} mt-3`} onClick={() => setRetry((value) => value + 1)}>RETRY READINESS →</button></div> : null}
    {readiness && !readiness.enabled ? <details className="mt-4 font-mono text-[11px] leading-relaxed text-ink-2"><summary className="min-h-11 cursor-pointer py-3 uppercase tracking-widest">WHY HIRING IS CLOSED</summary><ul className="list-disc space-y-2 pl-5">{readiness.blockers.map((blocker) => <li key={blocker}>{HIRING_BLOCKERS[blocker] ?? "A required commerce check did not pass."}</li>)}</ul></details> : null}
    {readiness?.enabled ? <p role="status" className="mt-4 border-l-2 border-accent pl-4 font-mono text-[11px] leading-relaxed text-ink-2">Protected hiring is ready for this exact provider version at {readiness.priceDisplay} {readiness.token?.symbol}. Sign in before requesting a quote.</p> : null}
  </aside>;
}
function rememberRun(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("lpRun", id); else url.searchParams.delete("lpRun");
  window.history.replaceState(null, "", url);
}
export function LpGuardianPanel({ chainId }: { chainId: BnbChain }) {
  const [positionId, setPositionId] = useState(""); const [width, setWidth] = useState("10"); const [deviation, setDeviation] = useState("100");
  const [busy, setBusy] = useState(false); const [run, setRun] = useState<LpRun | null>(null); const [error, setError] = useState<string | null>(null);
  const key = useRef<string | null>(null); const request = useRef<AbortController | null>(null);
  useEffect(() => {
    if (chainId !== 97) return;
    const id = new URL(window.location.href).searchParams.get("lpRun");
    const controller = new AbortController(); request.current = controller;
    if (id) { setBusy(true); readLpAnalysis(chainId, id, controller.signal).then((saved) => {
      setRun(saved);
      if (saved.report) { key.current = saved.id; setPositionId(saved.report.input.positionId); setWidth(String(saved.report.input.halfWidthSteps)); setDeviation(String(saved.report.input.maxDeviationTicks)); }
    })
      .catch((e: unknown) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "The saved report could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); }); }
    return () => { controller.abort(); request.current?.abort(); };
  }, [chainId]);
  useEffect(() => {
    if (run?.status !== "running") return;
    const controller = new AbortController();
    const timer = setTimeout(() => { readLpAnalysis(chainId, run.id, controller.signal).then(setRun)
      .catch((e: unknown) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "The report could not be refreshed."); }); }, 3000);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [chainId, run]);
  function clearResult() { key.current = null; setRun(null); setError(null); rememberRun(null); }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy || run?.status === "running") return;
    setBusy(true); setError(null); key.current ??= crypto.randomUUID();
    const controller = new AbortController(); request.current?.abort(); request.current = controller;
    try {
      const result = await startLpAnalysis(chainId, key.current, { positionId, halfWidthSteps: Number(width), maxDeviationTicks: Number(deviation) }, controller.signal);
      setRun(result); rememberRun(result.id);
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Analysis failed. Retry uses the same run ID."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  function download() {
    if (!run?.reportJson) return;
    const url = URL.createObjectURL(new Blob([run.reportJson], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `agon-lp-${run.id}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const waiting = busy || run?.status === "running";
  const report = run?.report;
  return <section className="border border-[color:var(--hairline-strong)] bg-canvas-2 p-5 sm:p-6" aria-labelledby="lp-guardian-title">
    <p className="font-mono text-[10px] uppercase tracking-widest text-accent">AGON OPERATED / PANCAKESWAP V3</p>
    <h2 id="lp-guardian-title" className="mt-4 font-stencil text-3xl uppercase">LP GUARDIAN</h2>
    <p className="mt-4 max-w-[85ch] font-mono text-sm leading-relaxed text-ink-2">Check whether a liquidity position is in range. The agent reads its BNB Testnet pool, checks a 10-minute price average, and proposes a range for review when the evidence allows it.</p>
    <p className="mt-3 font-mono text-[11px] leading-relaxed text-ink-3">Read-only analysis. No wallet needed, no funds moved. Protected hiring stays closed until the registered provider, exact price, contracts and delivery worker all pass verification.</p>
    {chainId !== 97 ? <p role="status" className="mt-6 border-l-2 border-accent pl-4 font-mono text-sm text-ink-2">Select BNB Testnet to run LP Guardian. It does not read Testnet positions under a Mainnet label.</p> : <>
      <form onSubmit={submit} className="mt-6 space-y-5">
        <fieldset disabled={waiting} className="grid gap-4 md:grid-cols-3">
          <legend className="sr-only">PancakeSwap Testnet position settings</legend>
          <label className="font-mono text-[11px] uppercase text-ink-2">POSITION NFT ID<input className={INPUT} required inputMode="numeric" pattern="[0-9]+" value={positionId} onChange={(e) => { clearResult(); setPositionId(e.target.value); }} placeholder="PancakeSwap position ID" /></label>
          <label className="font-mono text-[11px] uppercase text-ink-2">RANGE HALF-WIDTH (STEPS)<input className={INPUT} required type="number" min="1" max="1000" step="1" value={width} onChange={(e) => { clearResult(); setWidth(e.target.value); }} /></label>
          <label className="font-mono text-[11px] uppercase text-ink-2">MAX SPOT DEVIATION (TICKS)<input className={INPUT} required type="number" min="0" max="10000" step="1" value={deviation} onChange={(e) => { clearResult(); setDeviation(e.target.value); }} /></label>
        </fieldset>
        <p className="max-w-[85ch] font-mono text-[11px] leading-relaxed text-ink-3">One step uses the pool's own tick spacing. Width sets the proposed range on each side of the average. Deviation is the maximum allowed gap between the current tick and that average; it is not a risk score or a profit target.</p>
        <button className={`${BUTTON} bg-accent !text-accent-ink`} disabled={waiting}>{waiting ? "CHECKING POSITION…" : key.current && error ? "RETRY SAME ANALYSIS →" : "ANALYSE POSITION →"}</button>
        {run && run.status !== "running" ? <button type="button" disabled={busy} className={`${BUTTON} ml-3`} onClick={clearResult}>NEW ANALYSIS</button> : null}
      </form>
      {waiting ? <p role="status" className="mt-5 font-mono text-sm text-ink-2">Reading the position, pool and oracle at one source block. This can take up to 45 seconds.</p> : null}
      {error || run?.error ? <p role="alert" className="mt-5 border-l-2 border-accent pl-4 font-mono text-sm text-ink-2">{error ?? run?.error}</p> : null}
      {report ? <div className="mt-6 border-t border-[color:var(--hairline-strong)] pt-6">
        <p role="status" className="font-mono text-[11px] uppercase tracking-widest text-accent">{report.decision.action === "hold" ? "IN RANGE / HOLD" : report.decision.action === "review_rebalance" ? "OUT OF RANGE / REVIEW PROPOSAL" : "PROPOSAL WITHHELD"}</p>
        <p className="mt-3 max-w-[85ch] font-mono text-sm leading-relaxed text-ink">{report.decision.reason}</p>
        <dl className="mt-5 grid gap-5 font-mono text-[12px] sm:grid-cols-3">
          <div><dt className="text-ink-3">CURRENT TICK</dt><dd className="mt-2">{report.state.tick}</dd></div>
          <div><dt className="text-ink-3">POSITION RANGE</dt><dd className="mt-2">{report.state.tickLower} to {report.state.tickUpper}</dd></div>
          <div><dt className="text-ink-3">10-MINUTE AVERAGE</dt><dd className="mt-2">{report.state.twapTick ?? "Unavailable"}</dd></div>
        </dl>
        {report.decision.proposedRange ? <p className="mt-5 font-mono text-sm">PROPOSED RANGE: {report.decision.proposedRange.tickLower} to {report.decision.proposedRange.tickUpper}. Review only.</p> : null}
        <p className="mt-5 font-mono text-[11px] text-ink-2">Snapshot: {new Date(report.evidence.blockTimestamp).toLocaleString()} · <a className="underline" href={report.evidence.blockUrl} target="_blank" rel="noreferrer">BLOCK {report.evidence.blockNumber} ↗</a></p>
        <details className="mt-5 font-mono text-[11px] leading-relaxed text-ink-2"><summary className="min-h-11 cursor-pointer py-3 uppercase">EVIDENCE AND LIMITATIONS</summary><p className="break-all">RUN {run?.id}<br/>{run?.reportHash}</p>{report.limitations.map((line) => <p key={line} className="mt-3">{line}</p>)}<p className="mt-3 break-all">POOL {report.evidence.pool}</p><a className="mt-3 inline-block underline" href={report.evidence.positionUrl} target="_blank" rel="noreferrer">INSPECT SOURCE POSITION ↗</a></details>
        <button className={`${BUTTON} mt-4`} onClick={download}>DOWNLOAD REPORT →</button>
      </div> : null}
    </>}
    <HiringReadiness chainId={chainId} />
  </section>;
}
