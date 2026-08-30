"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";

import { ConnectButton } from "@/components/ConnectButton";
import { LoginModal } from "@/components/pengu/LoginModal";
import { ProtocolActions } from "@/components/agon/ProtocolActions";
import { X402CallIntentPanel } from "@/components/agon/X402CallIntentPanel";
import { AgonSyndicatePrizeIntentPanel } from "@/components/agon/AgonSyndicatePrizeIntentPanel";
import { useAuth } from "@/hooks/useAuth";
import {
  getAgonEscrowReadiness,
  getAgonEscrowTransaction,
  getAgonHealth,
  getAgonJobEscrowJob,
  getAgonJobEscrowTransaction,
  evaluatePlaygroundTask,
  prepareAgonArenaEvaluation,
  getAgonArenaRequestTransaction,
  getAgonArenaEvidenceTransaction,
  markAgonArenaEvaluationSubmitted,
  markAgonArenaEvaluationStarted,
  markAgonArenaEvidenceSubmitted,
  reconcileAgonArenaEvaluation,
  listListings,
  prepareAgonEscrowIntent,
  prepareAgonJobEscrowIntent,
  reconcileAgonJobEscrowIntent,
  setAgonAdminAuthorization,
} from "@/lib/agon/client";
import type { AgonArenaEvaluationView, AgonArenaTransactionView, AgonEscrowIntentView, AgonEscrowReadinessView, AgonEscrowTransactionView, AgonHealth, AgonJobEscrowIntentView, AgonJobEscrowJobView, AgonJobEscrowTransactionView, AgonListing } from "@/lib/agon/types";

const inputClass = "w-full border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2 font-mono text-xs text-ink outline-none focus:border-ink";

export function AgonAdminConsole({ adminToken }: { adminToken: string }) {
  const { address } = useAccount();
  const [health, setHealth] = useState<AgonHealth | null>(null);
  const [listings, setListings] = useState<AgonListing[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setAgonAdminAuthorization(adminToken, address ?? null);
    return () => setAgonAdminAuthorization(null, null);
  }, [adminToken, address]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [nextHealth, nextListings] = await Promise.all([
        getAgonHealth(),
        listListings({ limit: 50 }),
      ]);
      setHealth(nextHealth);
      setListings(nextListings.items);
      setSelectedId((current) => current || nextListings.items[0]?.id || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load Agon operator state.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const selected = useMemo(
    () => listings.find((listing) => listing.id === selectedId) ?? null,
    [listings, selectedId],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">AGON OPERATIONS</div>
          <h2 className="mt-2 font-stencil text-4xl uppercase leading-none">Operator control plane</h2>
          <p className="mt-3 max-w-2xl font-mono text-xs leading-6 text-ink-2">Backend readiness, listing verification, x402 preparation, escrow preparation, and wallet-originated protocol writes live in one workflow. Every ownership-sensitive action still requires the connected operator session or wallet.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3"><ConnectButton /><button onClick={() => void load()} disabled={loading} className="border border-[color:var(--hairline-strong)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:text-ink disabled:opacity-50">{loading ? "LOADING" : "REFRESH AGON"}</button></div>
      </div>

      {!address ? <p className="border-l-2 border-[color:var(--warn)] p-3 font-mono text-xs text-ink-2">Connect the authorized Arc wallet to bind admin API intents to an actor and sign contract writes. The admin token remains the only console login.</p> : null}

      {error ? <p className="border-l-2 border-[color:var(--err)] p-3 font-mono text-xs text-[color:var(--err)]">{error}</p> : null}
      <AgonReadiness health={health} />

      <div className="grid gap-6 lg:grid-cols-2">
        <AgonListingPicker listings={listings} selectedId={selectedId} onChange={setSelectedId} />
        <AgonEscrowPreparation listing={selected} />
      </div>
      <AgonJobEscrowIntentPanel listing={selected} />
      <AgonArenaEvaluationPanel listing={selected} />
      <AgonSyndicatePrizeIntentPanel />

      {selected ? (
        <section className="border border-[color:var(--hairline-strong)] bg-canvas p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">SELECTED SERVICE / X402 BACKEND FLOW</div>
          <div className="mt-3 grid gap-2 font-mono text-[11px] text-ink-2 sm:grid-cols-3">
            <span>LISTING {selected.listingId}</span>
            <span>{selected.verification.status.toUpperCase()}</span>
            <span>{selected.payment.rail}</span>
          </div>
          <X402CallIntentPanel listing={selected} defaultAmount={selected.manifest.body && typeof selected.manifest.body === "object" && "pricing" in selected.manifest.body ? null : "0.01"} endpointUrl={selected.endpointQa.endpointUrl ?? null} />
        </section>
      ) : (
        <EmptyState message="No indexed listings are available. Publish a service from the market workflow, then refresh this console." />
      )}

      <ProtocolActions />
      <AgonJobInspector />
    </div>
  );
}

function AgonArenaEvaluationPanel({ listing }: { listing: AgonListing | null }) {
  const { me } = useAuth();
  const [evaluation, setEvaluation] = useState<AgonArenaEvaluationView | null>(null);
  const [requestTransaction, setRequestTransaction] = useState<AgonArenaTransactionView | null>(null);
  const [evidenceTransaction, setEvidenceTransaction] = useState<AgonArenaTransactionView | null>(null);
  const [requestTxHash, setRequestTxHash] = useState("");
  const [evaluationId, setEvaluationId] = useState("");
  const [startTxHash, setStartTxHash] = useState("");
  const [evidenceTxHash, setEvidenceTxHash] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function prepare() {
    if (!listing || !me) { setMessage("Sign in as the current listing provider before running Arena verification."); return; }
    setBusy(true); setMessage(null); setEvaluation(null); setRequestTransaction(null); setEvidenceTransaction(null);
    try {
      const key = `admin-arena-${listing.listingId}-${Date.now()}`;
      const run = await evaluatePlaygroundTask({
        category: "development",
        taskId: "selector-guard",
        input: { to: "0x0000000000000000000000000000000000001234", value: "0", data: `0xa9059cbb${"00".repeat(64)}` },
        listingReference: listing.id,
        listingVersion: listing.version,
        idempotencyKey: `${key}-run`,
      });
      const next = await prepareAgonArenaEvaluation({
        listingReference: listing.id,
        idempotencyKey: key,
        playgroundRunId: run.runId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
      setEvaluation(next);
      setRequestTransaction(await getAgonArenaRequestTransaction(next.intentId));
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not prepare Arena verification."); }
    finally { setBusy(false); }
  }

  async function loadEvidencePlan() {
    if (!evaluation) return;
    setBusy(true); setMessage(null);
    try { setEvidenceTransaction(await getAgonArenaEvidenceTransaction(evaluation.intentId)); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not prepare Arena evidence transaction."); }
    finally { setBusy(false); }
  }

  async function recordStart() {
    if (!evaluation || !/^0x[0-9a-fA-F]{64}$/.test(startTxHash)) return;
    setBusy(true); setMessage(null);
    try { setEvaluation(await markAgonArenaEvaluationStarted(evaluation.intentId, startTxHash as `0x${string}`)); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not record the evaluator start marker."); }
    finally { setBusy(false); }
  }

  async function recordRequest() {
    if (!evaluation || !/^0x[0-9a-fA-F]{64}$/.test(requestTxHash) || !/^[1-9]\d*$/.test(evaluationId)) return;
    setBusy(true); setMessage(null);
    try { setEvaluation(await markAgonArenaEvaluationSubmitted(evaluation.intentId, evaluationId, requestTxHash as `0x${string}`)); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not record the Arena request marker."); }
    finally { setBusy(false); }
  }

  async function recordEvidence() {
    if (!evaluation || !/^0x[0-9a-fA-F]{64}$/.test(evidenceTxHash)) return;
    setBusy(true); setMessage(null);
    try { setEvaluation(await markAgonArenaEvidenceSubmitted(evaluation.intentId, evidenceTxHash as `0x${string}`)); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not record the Arena evidence marker."); }
    finally { setBusy(false); }
  }
  async function reconcileEvaluation() {
    if (!evaluation) return;
    setBusy(true); setMessage(null);
    try { setEvaluation(await reconcileAgonArenaEvaluation(evaluation.intentId)); }
    catch (failure) { setMessage(failure instanceof Error ? failure.message : "Arena finality reconciliation failed."); }
    finally { setBusy(false); }
  }

  return <section className="border border-[color:var(--hairline-strong)] bg-canvas p-5"><div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">AGON ARENA VERIFICATION</div><p className="mt-2 max-w-3xl font-mono text-[10px] leading-5 text-ink-3">Runs an authenticated adversarial playground task, pins its evidence to the exact listing version, and prepares unsigned Arena calldata. Final states are accepted only after an independent contract read matches every pinned field.</p><button disabled={busy || !listing} onClick={() => void prepare()} className="mt-4 bg-accent px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press disabled:opacity-50">{busy ? "WORKING" : "RUN PLAYGROUND + PREPARE ARENA"}</button>{message ? <p className="mt-3 font-mono text-[10px] text-[color:var(--err)]">{message}</p> : null}{evaluation ? <div className="mt-4 grid gap-2 border-t border-[color:var(--hairline)] pt-3 font-mono text-[10px] leading-5 text-ink-2"><span>INTENT {evaluation.intentId}</span><span>STATE {evaluation.state} / {evaluation.verificationStatus}</span><span>RUN {evaluation.playgroundRunId}</span><span className="break-all">EVIDENCE {evaluation.evidenceRoot}</span><span className="break-all">VALIDATION REQUEST {evaluation.validationRequestHash}</span>{requestTransaction ? <span className="break-all">UNSIGNED REQUEST {requestTransaction.to} / {requestTransaction.data}</span> : null}<div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><input value={evaluationId} onChange={(event) => setEvaluationId(event.target.value)} placeholder="onchain evaluation id" className={inputClass} /><input value={requestTxHash} onChange={(event) => setRequestTxHash(event.target.value)} placeholder="request tx hash marker" className={inputClass} /><button disabled={busy || !/^[1-9]\d*$/.test(evaluationId) || !/^0x[0-9a-fA-F]{64}$/.test(requestTxHash)} onClick={() => void recordRequest()} className="border border-[color:var(--hairline-strong)] px-3 py-2 uppercase disabled:opacity-50">RECORD REQUEST</button></div><div className="grid gap-2 sm:grid-cols-[1fr_auto]"><input value={startTxHash} onChange={(event) => setStartTxHash(event.target.value)} placeholder="evaluator start tx hash marker" className={inputClass} /><button disabled={busy || evaluation.state !== "request_submitted" || !/^0x[0-9a-fA-F]{64}$/.test(startTxHash)} onClick={() => void recordStart()} className="border border-[color:var(--hairline-strong)] px-3 py-2 uppercase disabled:opacity-50">RECORD EVALUATOR START</button></div><button disabled={busy || evaluation.state !== "evidence_ready"} onClick={() => void loadEvidencePlan()} className="border border-[color:var(--hairline-strong)] px-3 py-2 uppercase disabled:opacity-50">PREPARE EVIDENCE CALL</button>{evidenceTransaction ? <span className="break-all">UNSIGNED EVIDENCE {evidenceTransaction.to} / {evidenceTransaction.data}</span> : null}<div className="grid gap-2 sm:grid-cols-[1fr_auto]"><input value={evidenceTxHash} onChange={(event) => setEvidenceTxHash(event.target.value)} placeholder="evidence tx hash marker" className={inputClass} /><button disabled={busy || !/^0x[0-9a-fA-F]{64}$/.test(evidenceTxHash)} onClick={() => void recordEvidence()} className="border border-[color:var(--hairline-strong)] px-3 py-2 uppercase disabled:opacity-50">RECORD EVIDENCE</button></div><button disabled={busy || !evaluation.evaluationId} onClick={() => void reconcileEvaluation()} className="border border-[color:var(--hairline-strong)] px-3 py-2 uppercase disabled:opacity-50">RECONCILE ARENA FINALITY</button></div> : null}</section>;
}

const JOB_STATUS = ["Created", "Accepted", "Submitted", "Complete", "Rejected", "Disputed", "Failed"];
const JOB_SETTLEMENT = ["None", "Provider paid", "Buyer refunded"];

function AgonJobInspector() {
  const { me } = useAuth();
  const [jobId, setJobId] = useState("");
  const [job, setJob] = useState<AgonJobEscrowJobView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function inspect() {
    if (!me) { setMessage("Sign in before inspecting a deployed job."); return; }
    if (!/^[1-9]\d*$/.test(jobId)) { setMessage("Enter a positive onchain job id."); return; }
    setBusy(true); setMessage(null); setJob(null);
    try { setJob(await getAgonJobEscrowJob(jobId)); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not inspect the deployed job."); }
    finally { setBusy(false); }
  }

  return <section className="border border-[color:var(--hairline-strong)] bg-canvas p-5"><div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">DEPLOYED AGON JOB INSPECTOR</div><p className="mt-2 max-w-2xl font-mono text-[10px] leading-5 text-ink-3">Read-only inspection of the canonical AgonJobEscrow contract. This panel never signs, funds, settles, or retries a transaction.</p><div className="mt-4 flex flex-wrap gap-2"><input value={jobId} onChange={(event) => setJobId(event.target.value)} inputMode="numeric" placeholder="onchain job id" className={`${inputClass} max-w-xs`} /><button disabled={busy || !/^[1-9]\d*$/.test(jobId)} onClick={() => void inspect()} className="border border-[color:var(--hairline-strong)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:text-ink disabled:opacity-50">{busy ? "READING" : "INSPECT JOB"}</button></div>{message ? <p className="mt-3 font-mono text-[10px] text-[color:var(--err)]">{message}</p> : null}{job ? <div className="mt-4 grid gap-2 border-t border-[color:var(--hairline)] pt-3 font-mono text-[10px] leading-5 text-ink-2 sm:grid-cols-2"><span>JOB {job.jobId} / LISTING {job.listingId} / AGENT {job.agentId}</span><span>STATE {JOB_STATUS[job.status] ?? `UNKNOWN(${job.status})`}</span><span>SETTLEMENT {JOB_SETTLEMENT[job.settlement] ?? `UNKNOWN(${job.settlement})`}</span><span>AMOUNT {job.amount} / FEE {job.fee} BASE UNITS</span><span className="break-all">BUYER {job.buyer}</span><span className="break-all">PROVIDER {job.provider}</span><span className="break-all">TERMS {job.termsHash}</span><span className="break-all">DELIVERABLE {job.deliverableHash}</span><span>ACCEPT BY {job.acceptanceDeadline}</span><span>REVIEW BY {job.reviewDeadline ?? "NOT SUBMITTED"}</span></div> : null}</section>;
}

function AgonJobEscrowIntentPanel({ listing }: { listing: AgonListing | null }) {
  const { me } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reviewHours, setReviewHours] = useState("24");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [jobId, setJobId] = useState("");
  const [intent, setIntent] = useState<AgonJobEscrowIntentView | null>(null);
  const [transaction, setTransaction] = useState<AgonJobEscrowTransactionView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function prepare() {
    if (!listing) return;
    if (!me) { setLoginOpen(true); return; }
    setBusy(true); setMessage(null); setIntent(null); setTransaction(null);
    try {
      const value = await prepareAgonJobEscrowIntent({
        listingReference: listing.id,
        idempotencyKey: idempotencyKey || `admin-job-escrow-${listing.listingId}-${Date.now()}`,
        amountBaseUnits: amount,
        reviewHours: Number(reviewHours),
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : new Date(Date.now() + 7 * 86400000).toISOString(),
      });
      setIntent(value);
      setTransaction(await getAgonJobEscrowTransaction(value.intentId));
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not prepare the deployed job escrow intent."); }
    finally { setBusy(false); }
  }

  async function reconcile() {
    if (!intent || !/^[1-9]\d*$/.test(jobId)) return;
    setBusy(true); setMessage(null);
    try { setIntent(await reconcileAgonJobEscrowIntent(intent.intentId, jobId)); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not reconcile the onchain job."); }
    finally { setBusy(false); }
  }

  const valid = listing && /^\d+$/.test(amount) && amount !== "0" && /^[1-9]\d*$/.test(reviewHours) && Number(reviewHours) <= 720;
  return <section className="border border-[color:var(--hairline-strong)] bg-canvas p-5"><div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">DEPLOYED JOB ESCROW INTENT</div><p className="mt-2 max-w-3xl font-mono text-[10px] leading-5 text-ink-3">Pins the exact AgonJobEscrow createJob terms, produces unsigned calldata, and reconciles a user-submitted onchain job by independently reading the deployed contract. The protocol fee is fixed at 5%. No backend signer or automatic retry exists.</p><div className="mt-4 grid gap-2 sm:grid-cols-2"><input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="amount in USDC base units" className={inputClass} /><input value={reviewHours} onChange={(event) => setReviewHours(event.target.value)} placeholder="review hours (1-720)" className={inputClass} /><div className="border border-[color:var(--hairline-strong)] px-3 py-2 font-mono text-[10px] text-ink-2">PROTOCOL FEE: 5% FIXED</div><input value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} type="datetime-local" className={inputClass} /><input value={idempotencyKey} onChange={(event) => setIdempotencyKey(event.target.value)} placeholder="idempotency key, optional" className={`${inputClass} sm:col-span-2`} /><button disabled={busy || !valid} onClick={() => void prepare()} className="bg-accent px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press disabled:opacity-50 sm:col-span-2">{busy ? "WORKING" : "PREPARE JOB INTENT"}</button></div>{message ? <p className="mt-3 font-mono text-[10px] text-[color:var(--err)]">{message}</p> : null}{intent ? <div className="mt-4 grid gap-2 border-t border-[color:var(--hairline)] pt-3 font-mono text-[10px] leading-5 text-ink-2"><span>INTENT {intent.intentId}</span><span>STATE {intent.state} / {intent.nextAction}</span><span>CLIENT REF {intent.clientReference}</span><span>TERMS {intent.termsHash}</span>{transaction ? <span className="break-all">UNSIGNED CALL {transaction.functionName} TO {transaction.to} / {transaction.data}</span> : null}<div className="mt-2 flex flex-wrap gap-2"><input value={jobId} onChange={(event) => setJobId(event.target.value)} placeholder="onchain job id" inputMode="numeric" className={`${inputClass} max-w-xs`} /><button disabled={busy || !/^[1-9]\d*$/.test(jobId)} onClick={() => void reconcile()} className="border border-[color:var(--hairline-strong)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] hover:text-ink disabled:opacity-50">RECONCILE READ-ONLY</button></div></div> : null}<LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} /></section>;
}

function AgonReadiness({ health }: { health: AgonHealth | null }) {
  if (!health) return <EmptyState message="Agon health has not been loaded yet." />;
  const capabilities = health.capabilities;
  const rows = [
    ["profile writes", capabilities.profileWrites],
    ["listing writes", capabilities.listingWrites],
    ["direct x402", capabilities.directX402],
    ["escrow contract", capabilities.escrow],
    ["arena contract", capabilities.arenaVerification],
    ["syndicate registry", capabilities.syndicateRegistry],
    ["prize vault", capabilities.prizeVault],
  ] as const;
  return (
    <section className="border border-[color:var(--hairline-strong)] bg-canvas-2 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">LIVE BACKEND CAPABILITIES</div>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-accent">AGON / NETWORK {capabilities.protocolReadiness.chainId ?? "UNKNOWN"}</span>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map(([label, enabled]) => <div key={label} className="flex items-center justify-between border-t border-[color:var(--hairline)] py-2 font-mono text-[11px]"><span className="text-ink-2">{label}</span><span className={enabled ? "text-[color:var(--ok)]" : "text-ink-3"}>{enabled ? "READY" : "GATED"}</span></div>)}
      </div>
      <div className="mt-5 border-t border-[color:var(--hairline)] pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
          <span className="text-ink-2">protocol release gate</span>
          <span className={capabilities.protocolReadiness.ready ? "text-[color:var(--ok)]" : "text-[color:var(--warn)]"}>
            {capabilities.protocolReadiness.ready ? "READY" : "BLOCKED"}
          </span>
        </div>
        <div className="mt-2 grid gap-1 font-mono text-[10px] leading-5 text-ink-3">
          <span>CHAIN {capabilities.protocolReadiness.chainId ?? "UNKNOWN"}</span>
          {capabilities.protocolReadiness.missingContracts.length ? <span>MISSING {capabilities.protocolReadiness.missingContracts.join(", ")}</span> : null}
          {capabilities.protocolReadiness.unverifiedContracts.length ? <span>UNVERIFIED {capabilities.protocolReadiness.unverifiedContracts.join(", ")}</span> : null}
          {capabilities.protocolReadiness.externalRegistry.validation ? <span>VALIDATION REGISTRY {capabilities.protocolReadiness.externalRegistry.validation}</span> : null}
        </div>
        {capabilities.protocolReadiness.reasons.length ? <div className="mt-3 border-l-2 border-[color:var(--warn)] p-3 font-mono text-[10px] leading-5 text-ink-2">RELEASE GATE: {capabilities.protocolReadiness.reasons.join(", ")}</div> : null}
      </div>
      {capabilities.escrowReadiness.reasons.length ? <div className="mt-4 border-l-2 border-[color:var(--warn)] p-3 font-mono text-[10px] leading-5 text-ink-2">ESCROW READINESS: {capabilities.escrowReadiness.reasons.join(", ")}</div> : null}
    </section>
  );
}

function AgonListingPicker({ listings, selectedId, onChange }: { listings: AgonListing[]; selectedId: string; onChange: (value: string) => void }) {
  return (
    <section className="border border-[color:var(--hairline-strong)] bg-canvas p-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">INDEXED LISTINGS</div>
      <p className="mt-2 font-mono text-[10px] leading-5 text-ink-3">Choose the service that the x402 and escrow backend workflows should target.</p>
      <div className="mt-4 grid gap-2">
        {listings.length ? listings.map((listing) => <button key={listing.id} onClick={() => onChange(listing.id)} className={`grid gap-1 border p-3 text-left font-mono text-[11px] ${selectedId === listing.id ? "border-accent bg-canvas-2" : "border-[color:var(--hairline)] hover:border-[color:var(--hairline-strong)]"}`}><span className="text-ink">#{listing.listingId} / agent {listing.agentId}</span><span className="text-ink-3">{listing.verification.status} / {listing.payment.rail} / v{listing.version}</span><span className="break-all text-ink-3">{listing.id}</span></button>) : <EmptyState message="No listings returned." />}
      </div>
    </section>
  );
}

function AgonEscrowPreparation({ listing }: { listing: AgonListing | null }) {
  const { me } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [intent, setIntent] = useState<AgonEscrowIntentView | null>(null);
  const [readiness, setReadiness] = useState<AgonEscrowReadinessView | null>(null);
  const [transaction, setTransaction] = useState<AgonEscrowTransactionView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function prepare() {
    if (!listing) return;
    if (!me) { setLoginOpen(true); return; }
    setBusy(true); setMessage(null); setIntent(null); setReadiness(null); setTransaction(null);
    try {
      const value = await prepareAgonEscrowIntent({
        listingReference: listing.id,
        idempotencyKey: idempotencyKey || `admin-escrow-${listing.listingId}-${Date.now()}`,
        amountBaseUnits: amount,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : new Date(Date.now() + 7 * 86400000).toISOString(),
      });
      setIntent(value);
      const [nextReadiness, nextTransaction] = await Promise.all([
        getAgonEscrowReadiness(value.intentId),
        getAgonEscrowTransaction(value.intentId),
      ]);
      setReadiness(nextReadiness);
      setTransaction(nextTransaction);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not prepare the escrow intent.");
    } finally { setBusy(false); }
  }

  return <section className="border border-[color:var(--hairline-strong)] bg-canvas p-5"><div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">ESCROW BACKEND FLOW</div><p className="mt-2 font-mono text-[10px] leading-5 text-ink-3">Prepare exact terms, inspect readiness, and review the unsigned createJob transaction. The protocol fee is fixed at 5%; funding still requires the buyer wallet.</p><div className="mt-4 grid gap-2"><input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="amount in USDC base units" className={inputClass} /><div className="grid gap-2 sm:grid-cols-2"><div className="border border-[color:var(--hairline-strong)] px-3 py-2 font-mono text-[10px] text-ink-2">PROTOCOL FEE: 5% FIXED</div><input value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} type="datetime-local" className={inputClass} /></div><input value={idempotencyKey} onChange={(event) => setIdempotencyKey(event.target.value)} placeholder="idempotency key, optional" className={inputClass} /><button disabled={busy || !listing || !/^\d+$/.test(amount) || amount === "0"} onClick={() => void prepare()} className="bg-accent px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press disabled:opacity-50">{busy ? "PREPARING" : "PREPARE ESCROW"}</button></div>{message ? <p className="mt-3 font-mono text-[10px] text-[color:var(--err)]">{message}</p> : null}{intent ? <div className="mt-4 grid gap-2 border-t border-[color:var(--hairline)] pt-3 font-mono text-[10px] text-ink-2"><span>INTENT {intent.intentId}</span><span>STATE {intent.state} / {intent.nextAction}</span><span>TERMS {intent.termsHash}</span>{readiness ? <span>READINESS {readiness.status} / {readiness.reason}</span> : null}{transaction ? <span className="break-all">CALL {transaction.functionName} TO {transaction.to} / {transaction.data}</span> : null}</div> : null}<LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} /></section>;
}

function EmptyState({ message }: { message: string }) {
  return <div className="border border-dashed border-[color:var(--hairline-strong)] p-4 font-mono text-[11px] leading-5 text-ink-3">{message}</div>;
}
