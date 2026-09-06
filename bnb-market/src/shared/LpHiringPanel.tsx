"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { BnbChain, CommerceIntent, CommerceStep, LpHiringReadiness } from "./types";
import type { LpInput } from "./providers/lp-core";
import { checkLpHiring, prepareLpHire, readLpHire, reconcileLpHire } from "./client";

export type WalletRequest = (input: { method: string; params?: unknown[] }) => Promise<unknown>;

const BUTTON = "inline-flex min-h-11 items-center justify-center border border-[color:var(--hairline-strong)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.12em] text-ink hover:bg-canvas-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";
const INPUT = "mt-2 h-12 w-full border border-[color:var(--hairline-strong)] bg-canvas px-4 font-mono text-sm text-ink focus:outline focus:outline-2 focus:outline-accent";
const PANEL = "border border-[color:var(--hairline-strong)] bg-canvas-2 p-5 sm:p-6";

const BLOCKERS: Record<string, string> = {
  testnet_only: "Paid hiring is open on BNB Testnet only while this flow is being proven.",
  hiring_flag_disabled: "The operator has not opened paid hiring.",
  agent_identity_unconfigured: "The provider identity is not configured.",
  provider_wallet_unconfigured: "The provider wallet is not configured.",
  exact_price_unconfigured: "The provider has not published one exact service price.",
  public_provider_url_unconfigured: "The provider endpoint is not configured.",
  altana_session_unconfigured: "The provider signing session is not configured.",
  registration_not_qualified: "The registered identity could not be matched to an active provider version.",
  provider_wallet_mismatch: "The registered wallet does not match the provider wallet.",
  provider_endpoint_mismatch: "The registered payment endpoint does not match the live provider endpoint.",
  registration_unavailable: "The provider registration could not be checked right now.",
  provider_execution_unavailable: "The delivery worker is not ready, so funds cannot be locked yet.",
};

const STEPS: Array<{ key: CommerceStep; label: string }> = [
  { key: "create", label: "Start request" },
  { key: "register", label: "Confirm request" },
  { key: "approve", label: "Approve amount" },
  { key: "fund", label: "Pay for report" },
];

const STEP_COPY: Record<CommerceStep, { title: string; warning: string; button: string }> = {
  create: { title: "Confirm your request", warning: "This starts the request. It does not move payment.", button: "CONFIRM REQUEST →" },
  register: { title: "Confirm the service", warning: "This confirms which service rules apply. It does not move payment.", button: "CONFIRM SERVICE →" },
  approve: { title: "Approve the exact amount", warning: "Your wallet will approve only the amount shown above.", button: "APPROVE AMOUNT →" },
  fund: { title: "Pay for the report", warning: "This pays the exact amount shown above for this request.", button: "PAY NOW →" },
};

function errorMessage(value: unknown, fallback: string) {
  return value instanceof Error ? value.message : fallback;
}

function isPending(intent: CommerceIntent) {
  return intent.state.endsWith("_confirming");
}

function stepIndex(intent: CommerceIntent | null) {
  if (!intent) return 0;
  if (intent.state === "funded") return STEPS.length;
  const stateStep = STEPS.findIndex((step) => intent.state.startsWith(`${step.key}_`));
  if (!intent.transaction) return stateStep >= 0 ? stateStep : 0;
  return Math.max(0, STEPS.findIndex((step) => step.key === intent.transaction?.step));
}

function shortHash(value: string | null) {
  return value ? `${value.slice(0, 10)}…${value.slice(-8)}` : null;
}

function ReadinessBlock({ readiness, onRetry }: { readiness: LpHiringReadiness; onRetry: () => void }) {
  return <div className="mt-6 border-l-2 border-[color:var(--err)] pl-4" role="alert">
    <p className="font-mono text-[11px] uppercase tracking-widest text-[color:var(--err)]">HIRING NOT AVAILABLE</p>
    <p className="mt-3 font-mono text-[12px] leading-relaxed text-ink-2">The service is visible, but AGON will not request a quote or ask for funds until every provider and delivery check passes.</p>
    <ul className="mt-4 list-disc space-y-2 pl-5 font-mono text-[12px] leading-relaxed text-ink-2">
      {readiness.blockers.map((blocker) => <li key={blocker}>{BLOCKERS[blocker] ?? "A required provider check did not pass."}</li>)}
    </ul>
    <button type="button" className={`${BUTTON} mt-5`} onClick={onRetry}>CHECK AGAIN →</button>
  </div>;
}

function StepProgress({ intent }: { intent: CommerceIntent | null }) {
  const current = stepIndex(intent);
  return <ol className="mt-6 grid gap-2 sm:grid-cols-4" aria-label="Hire progress">
    {STEPS.map((step, index) => {
      const done = Boolean(intent && (index < current || intent.state === "funded"));
      const active = Boolean(intent?.transaction?.step === step.key);
      return <li key={step.key} className={`border p-3 font-mono text-[10px] uppercase tracking-widest ${done ? "border-accent text-accent" : active ? "border-ink text-ink" : "border-[color:var(--hairline)] text-ink-3"}`}>
        <span className="block">{done ? "✓" : `${index + 1}`}</span>
        <span className="mt-2 block leading-relaxed">{step.label}</span>
      </li>;
    })}
  </ol>;
}

export function LpHiringPanel({ chainId, signedIn, onNeedSignIn, walletRequest }: {
  chainId: BnbChain;
  signedIn: boolean;
  onNeedSignIn: () => void;
  walletRequest: WalletRequest | null;
}) {
  const [readiness, setReadiness] = useState<LpHiringReadiness | null>(null);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [readinessRetry, setReadinessRetry] = useState(0);
  const [positionId, setPositionId] = useState("");
  const [width, setWidth] = useState("10");
  const [deviation, setDeviation] = useState("100");
  const [intent, setIntent] = useState<CommerceIntent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setReadiness(null); setReadinessError(null);
    checkLpHiring(chainId, controller.signal).then(setReadiness).catch((failure: unknown) => {
      if (!controller.signal.aborted) setReadinessError(errorMessage(failure, "The provider readiness check could not complete."));
    });
    return () => controller.abort();
  }, [chainId, readinessRetry]);

  useEffect(() => {
    if (!intent || !isPending(intent)) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      readLpHire(chainId, intent.id, controller.signal).then(setIntent).catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(failure, "The confirmation status could not be refreshed."));
      });
    }, 3000);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [chainId, intent]);

  function clearHire() {
    pending.current?.abort();
    setIntent(null); setError(null); setBusy(false);
  }

  async function prepare(event: FormEvent) {
    event.preventDefault();
    if (!signedIn) { onNeedSignIn(); return; }
    if (chainId !== 97 || !readiness?.enabled) return;
    setBusy(true); setError(null);
    const controller = new AbortController(); pending.current?.abort(); pending.current = controller;
    const input: LpInput = { positionId, halfWidthSteps: Number(width), maxDeviationTicks: Number(deviation) };
    try {
      setIntent(await prepareLpHire(chainId, crypto.randomUUID(), input));
    } catch (failure) {
      if (!controller.signal.aborted) setError(errorMessage(failure, "The provider could not prepare a signed quote. No wallet action was requested."));
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }

  async function sendNextTransaction() {
    if (!intent?.transaction) return;
    if (!walletRequest) { onNeedSignIn(); return; }
    setBusy(true); setError(null);
    try {
      const chain = await walletRequest({ method: "eth_chainId" });
      if (Number(chain) !== 97) throw new Error("Switch your wallet to BNB Testnet before approving this action.");
      const transaction = intent.transaction;
      const rawHash = await walletRequest({ method: "eth_sendTransaction", params: [{
        from: intent.buyerAddress,
        to: transaction.to,
        data: transaction.data,
        value: "0x0",
      }] });
      if (typeof rawHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(rawHash)) throw new Error("The wallet did not return a valid transaction hash.");
      setIntent(await reconcileLpHire(chainId, intent.id, transaction.step, rawHash as `0x${string}`));
    } catch (failure) {
      setError(errorMessage(failure, "The wallet action was not completed. Nothing else will be requested."));
    } finally { setBusy(false); }
  }

  const currentTransaction = intent?.transaction;
  const quoteExpires = intent ? new Date(intent.quoteExpiresAt).toLocaleString() : null;
  return <section id="hire-agent" className={`${PANEL} scroll-mt-24`} aria-labelledby="hire-agent-heading">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-accent">READY TO USE</p>
        <h3 id="hire-agent-heading" className="mt-3 font-stencil text-3xl uppercase">USE THIS AGENT</h3>
      </div>
      <span className="border border-[color:var(--hairline-strong)] px-3 py-2 font-mono text-[10px] uppercase tracking-widest">BNB {chainId === 97 ? "TESTNET" : "MAINNET"}</span>
    </div>
    <p className="mt-4 max-w-[85ch] font-mono text-sm leading-relaxed text-ink-2">Get a read-only liquidity report for one PancakeSwap position. Nothing in your position is changed.</p>

    {chainId !== 97 ? <div className="mt-6 border-l-2 border-accent pl-4" role="status"><p className="font-mono text-[11px] uppercase tracking-widest text-accent">TESTNET ONLY</p><p className="mt-3 font-mono text-[12px] leading-relaxed text-ink-2">Switch to BNB Testnet to use this service. Mainnet is browse-only for now.</p></div> : null}
    {chainId === 97 && !readiness && !readinessError ? <p role="status" className="mt-6 font-mono text-[12px] text-ink-2">CHECKING IF THIS SERVICE IS READY…</p> : null}
    {chainId === 97 && readinessError ? <div className="mt-6 border-l-2 border-[color:var(--err)] pl-4" role="alert"><p className="font-mono text-sm text-ink-2">{readinessError}</p><button type="button" className={`${BUTTON} mt-4`} onClick={() => setReadinessRetry((value) => value + 1)}>RETRY READINESS →</button></div> : null}
    {chainId === 97 && readiness && !readiness.enabled ? <ReadinessBlock readiness={readiness} onRetry={() => setReadinessRetry((value) => value + 1)} /> : null}

    {chainId === 97 && readiness?.enabled && !intent ? <>
      <div className="mt-6 grid gap-3 border-y border-[color:var(--hairline)] py-5 font-mono text-[12px] sm:grid-cols-3">
        <div><p className="text-ink-3">PRICE</p><p className="mt-2 text-ink">{readiness.priceDisplay} {readiness.token?.symbol} / report</p></div>
        <div><p className="text-ink-3">NETWORK</p><p className="mt-2 text-ink">BNB Testnet · chain 97</p></div>
        <div><p className="text-ink-3">BEFORE YOU START</p><p className="mt-2 text-ink">Review each wallet step</p></div>
      </div>
      <p className="mt-5 font-mono text-[11px] leading-relaxed text-ink-3">No payment is requested until you choose to continue. Your wallet shows every step before it is approved.</p>
      {!signedIn ? <button type="button" className={`${BUTTON} mt-5 bg-accent !text-accent-ink`} onClick={onNeedSignIn}>USE NOW →</button> : <form onSubmit={prepare} className="mt-6 space-y-5">
        <fieldset disabled={busy} className="grid gap-4 md:grid-cols-3"><legend className="sr-only">LP Guardian hire settings</legend>
          <label className="font-mono text-[11px] uppercase text-ink-2">POSITION ID<input className={INPUT} required inputMode="numeric" pattern="[0-9]+" value={positionId} onChange={(event) => setPositionId(event.target.value)} placeholder="PancakeSwap position ID" /></label>
          <label className="font-mono text-[11px] uppercase text-ink-2">RANGE SIZE<input className={INPUT} required type="number" min="1" max="1000" step="1" value={width} onChange={(event) => setWidth(event.target.value)} /></label>
          <label className="font-mono text-[11px] uppercase text-ink-2">PRICE DEVIATION<input className={INPUT} required type="number" min="0" max="10000" step="1" value={deviation} onChange={(event) => setDeviation(event.target.value)} /></label>
        </fieldset>
        <p className="font-mono text-[11px] leading-relaxed text-ink-3">The report uses one live market snapshot and explains when it cannot make a safe recommendation.</p>
        <button type="submit" className={`${BUTTON} bg-accent !text-accent-ink`} disabled={busy}>{busy ? "PREPARING YOUR REQUEST…" : "CONTINUE →"}</button>
      </form>}
    </> : null}

    {intent ? <div className="mt-6 border-t border-[color:var(--hairline)] pt-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-[10px] uppercase tracking-widest text-accent">REQUEST IN PROGRESS</p><p role="status" className="mt-2 font-stencil text-2xl uppercase">{intent.state === "funded" ? "REQUEST PAID" : isPending(intent) ? "CONFIRMING PAYMENT" : currentTransaction ? "NEXT STEP" : intent.state.replaceAll("_", " ")}</p></div><button type="button" className={BUTTON} onClick={clearHire} disabled={busy}>START OVER</button></div>
      <StepProgress intent={intent} />
      <div className="mt-6 border-l-2 border-accent pl-4 font-mono text-[12px] leading-relaxed" role="status">
        <p className="text-ink">{intent.state === "funded" ? "Your request is paid and the report is being prepared." : isPending(intent) ? "Your wallet action was sent. We are waiting for confirmation." : "Review the next step below."}</p>
        {intent.state === "funded" ? <p className="mt-3 text-ink-2">The agent will deliver a report for this request. No liquidity transaction is submitted.</p> : null}
        {isPending(intent) ? <p className="mt-3 text-ink-2">You can leave this page and return to check again.</p> : null}
      </div>
      {currentTransaction && !isPending(intent) ? <div className="mt-6 border border-[color:var(--hairline-strong)] p-4"><p className="font-mono text-[10px] uppercase tracking-widest text-accent">NEXT STEP</p><h4 className="mt-3 font-stencil text-xl uppercase">{STEP_COPY[currentTransaction.step].title}</h4><p className="mt-3 font-mono text-[12px] leading-relaxed text-ink-2">{STEP_COPY[currentTransaction.step].warning}</p><button type="button" className={`${BUTTON} mt-5 bg-accent !text-accent-ink`} onClick={sendNextTransaction} disabled={busy}>{busy ? "CHECK YOUR WALLET…" : STEP_COPY[currentTransaction.step].button}</button></div> : null}
      {intent.quoteExpiresAt ? <p className="mt-4 font-mono text-[10px] uppercase tracking-widest text-ink-3">REQUEST EXPIRES · {quoteExpires}</p> : null}
      {intent.transactionHash ? <details className="mt-4 font-mono text-[11px] text-ink-3"><summary className="min-h-11 cursor-pointer py-3 uppercase tracking-widest">TRANSACTION DETAILS</summary><p className="break-all">{shortHash(intent.transactionHash)}</p></details> : null}
    </div> : null}
    {error ? <p role="alert" className="mt-5 border-l-2 border-[color:var(--err)] pl-4 font-mono text-[12px] leading-relaxed text-ink-2">{error}</p> : null}
    <details className="mt-6 border-t border-[color:var(--hairline)] pt-4"><summary className="min-h-11 cursor-pointer py-3 font-mono text-[11px] uppercase tracking-widest">HOW IT WORKS</summary><ol className="mt-3 list-decimal space-y-2 pl-5 font-mono text-[12px] leading-relaxed text-ink-2"><li>Tell the agent which position to check.</li><li>Review the report price and request details.</li><li>Approve the exact amount in your wallet.</li><li>Receive a report for this request; no liquidity transaction is submitted.</li></ol></details>
  </section>;
}
