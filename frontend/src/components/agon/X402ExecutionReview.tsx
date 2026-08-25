"use client";

import { useCallback, useEffect, useState } from "react";

import { TagButton } from "@/components/redesign/TagButton";
import {
  AGON_PREVIEW_MODE,
  approveX402Execution,
  getX402ExecutionReadiness,
  getX402FacilitatorVerification,
  getX402ReconciliationReadiness,
  getX402SettlementReadiness,
  reconcileX402Receipt,
  settleX402Call,
  verifyX402Facilitator,
} from "@/lib/agon/client";
import {
  executionReadinessLabel,
  executionReadinessTone,
  formatExecutionTimestamp,
  formatUSDCBaseUnits,
  newExecutionApprovalKey,
} from "@/lib/agon/execution-review";
import { settlementReadinessLabel, settlementReadinessTone } from "@/lib/agon/settlement-review";
import { forgetX402Signature, readX402Signature } from "@/lib/agon/signature-memory";
import type {
  X402ExecutionApprovalView,
  X402ExecutionReadinessView,
  X402FacilitatorVerificationView,
  X402ReconciliationReadinessView,
  X402ReconciliationView,
  X402SettlementReadinessView,
  X402SettlementView,
} from "@/lib/agon/types";

type Props = { intentId: string; refreshKey?: string | number };

export function X402ExecutionReview({ intentId, refreshKey }: Props) {
  const [readiness, setReadiness] = useState<X402ExecutionReadinessView | null>(null);
  const [settlementReadiness, setSettlementReadiness] = useState<X402SettlementReadinessView | null>(null);
  const [reconciliationReadiness, setReconciliationReadiness] = useState<X402ReconciliationReadinessView | null>(null);
  const [approval, setApproval] = useState<X402ExecutionApprovalView | null>(null);
  const [signature, setSignature] = useState<`0x${string}` | null>(null);
  const [verification, setVerification] = useState<X402FacilitatorVerificationView | null>(null);
  const [settlement, setSettlement] = useState<X402SettlementView | null>(null);
  const [reconciliation, setReconciliation] = useState<X402ReconciliationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [verificationConfirmation, setVerificationConfirmation] = useState("");
  const [settlementConfirmation, setSettlementConfirmation] = useState("");
  const [reconciliationConfirmation, setReconciliationConfirmation] = useState("");
  const [busy, setBusy] = useState<"approve" | "verify" | "settle" | "reconcile" | null>(null);
  const [approvalKey] = useState(newExecutionApprovalKey);

  const refresh = useCallback(async () => {
    const [execution, settlementState, reconciliationState] = await Promise.all([
      getX402ExecutionReadiness(intentId),
      getX402SettlementReadiness(intentId),
      getX402ReconciliationReadiness(intentId),
    ]);
    setReadiness(execution);
    setApproval(execution.approval);
    setSettlementReadiness(settlementState);
    setReconciliationReadiness(reconciliationState);
  }, [intentId]);

  useEffect(() => {
    let live = true;
    setReadiness(null);
    setSettlementReadiness(null);
    setReconciliationReadiness(null);
    setError(null);
    setSignature(readX402Signature(intentId));
    setVerification(null);
    setSettlement(null);
    setReconciliation(null);
    void refresh().catch((failure) => {
      if (live) setError(message(failure, "Execution review is not available yet."));
    });
    void getX402FacilitatorVerification(intentId)
      .then((value) => { if (live) setVerification(value); })
      .catch(() => { /* First-run state has no verification record. */ });
    return () => { live = false; };
  }, [intentId, refreshKey, refresh]);

  async function approve() {
    if (!readiness || confirmation !== "APPROVE_ARC_TESTNET_X402") return;
    setBusy("approve");
    setError(null);
    try {
      await approveX402Execution(intentId, {
        planHash: readiness.plan.planHash,
        approvalIdempotencyKey: approvalKey,
        confirmation: "APPROVE_ARC_TESTNET_X402",
      });
      await refresh();
    } catch (failure) {
      setError(message(failure, "Agon could not record this execution approval."));
    } finally {
      setBusy(null);
    }
  }

  async function verifyWithCircle() {
    if (!signature || !approval || verificationConfirmation !== "VERIFY_ARC_TESTNET_X402") return;
    setBusy("verify");
    setError(null);
    try {
      setVerification(await verifyX402Facilitator(intentId, {
        signature,
        confirmation: "VERIFY_ARC_TESTNET_X402",
      }));
      await refresh();
    } catch (failure) {
      setError(message(failure, "Circle verification is not available."));
    } finally {
      setBusy(null);
    }
  }

  async function settle() {
    if (!signature || !settlementReadiness?.executionEnabled || settlementConfirmation !== "EXECUTE_ARC_TESTNET_X402") return;
    setBusy("settle");
    setError(null);
    try {
      const result = await settleX402Call(intentId, {
        signature,
        confirmation: "EXECUTE_ARC_TESTNET_X402",
      });
      setSettlement(result);
      forgetX402Signature(intentId);
      setSignature(null);
      setSettlementConfirmation("");
      await refresh();
    } catch (failure) {
      setError(message(failure, "The paid provider execution did not complete with trusted evidence."));
      await refresh().catch(() => undefined);
    } finally {
      setBusy(null);
    }
  }

  async function reconcile() {
    if (!reconciliationReadiness?.lookupEnabled || reconciliationConfirmation !== "RECONCILE_ARC_TESTNET_X402") return;
    setBusy("reconcile");
    setError(null);
    try {
      setReconciliation(await reconcileX402Receipt(intentId, { confirmation: "RECONCILE_ARC_TESTNET_X402" }));
      setReconciliationConfirmation("");
      await refresh();
    } catch (failure) {
      setError(message(failure, "Receipt reconciliation did not complete."));
    } finally {
      setBusy(null);
    }
  }

  const adapterReady = settlementReadiness?.executionEnabled === true;

  return (
    <section aria-labelledby="x402-execution-review" className="mt-4 border-t border-current pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.15em] opacity-60">CONTROLLED REVIEW</div>
          <h3 id="x402-execution-review" className="mt-1 font-mono text-[12px] uppercase tracking-[0.1em]">EXECUTION REVIEW</h3>
        </div>
        <span className={`font-mono text-[9px] uppercase tracking-[0.1em] ${adapterReady ? "text-[color:var(--ok)]" : "text-[color:var(--warn)]"}`}>
          {adapterReady ? "ARC TESTNET READY" : "SETTLEMENT OFF"}
        </span>
      </div>

      {error ? <p role="alert" className="mt-3 border-l-2 border-[color:var(--err)] pl-3 font-mono text-[10px] leading-relaxed text-[color:var(--err)]">{error}</p> : null}
      {!readiness && !error ? <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.08em] opacity-60">READING TESTNET PLAN...</p> : null}

      {readiness ? <>
        <div className="mt-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em]" style={{ color: readinessToneColor(executionReadinessTone(readiness.status)) }}>
          <span aria-hidden className="h-2 w-2 bg-current" />{executionReadinessLabel(readiness.status)}
        </div>
        <p className="mt-2 font-mono text-[10px] leading-relaxed opacity-75">{readiness.reason}</p>
        <dl className="mt-4 grid gap-px bg-current/20 sm:grid-cols-2">
          <ReviewFact label="NETWORK" value="ARC TESTNET / 5042002" />
          <ReviewFact label="RAIL" value="CIRCLE GATEWAY / x402" />
          <ReviewFact label="AMOUNT" value={`${formatUSDCBaseUnits(readiness.plan.requirements.amount)} / ${readiness.plan.requirements.amount} BASE UNITS`} />
          <ReviewFact label="RECIPIENT" value={readiness.plan.requirements.payTo} />
          <ReviewFact label="VALID UNTIL" value={formatExecutionTimestamp(fromUnixSeconds(readiness.plan.paymentPayloadPreview.payload.authorization.validBefore))} />
          <ReviewFact label="CHECKED" value={formatExecutionTimestamp(readiness.checkedAt)} />
        </dl>
        <div className="mt-4 space-y-2 border-t border-current pt-3 font-mono text-[10px] leading-relaxed">
          <div><span className="opacity-60">PLAN HASH / </span><span className="break-all">{readiness.plan.planHash}</span></div>
          <div><span className="opacity-60">AUTHORIZATION HASH / </span><span className="break-all">{readiness.plan.authorizationHash}</span></div>
        </div>

        {!adapterReady ? <div className="mt-4 border-l-2 border-[color:var(--warn)] pl-3 font-mono text-[10px] leading-relaxed text-[color:var(--warn)]"><div className="uppercase tracking-[0.1em]">NO PAYMENT WILL BE SENT</div><p className="mt-1 text-current/80">The Circle Arc Testnet settlement adapter is disabled in this environment.</p></div> : null}

        {readiness.status === "approval_required" && !approval ? <ConfirmationBox
          title="EXPLICIT EXECUTION APPROVAL"
          description="Confirm the exact plan above. The approval is retry-safe and expires with the authorization."
          value={confirmation}
          onChange={setConfirmation}
          phrase="APPROVE_ARC_TESTNET_X402"
          action={busy === "approve" ? "RECORDING APPROVAL..." : "APPROVE EXACT PLAN"}
          disabled={busy !== null}
          onSubmit={() => void approve()}
          footnote={`RETRY-SAFE APPROVAL KEY / ${approvalKey}`}
        /> : null}

        {approval ? <div className="mt-4 border-l-2 border-[color:var(--ok)] pl-3 font-mono text-[10px] leading-relaxed text-[color:var(--ok)]"><div className="uppercase tracking-[0.1em]">APPROVED{adapterReady ? " / READY" : " / ADAPTER OFF"}</div><p className="mt-1 break-all text-current/80">{approval.approvalHash} / expires {formatExecutionTimestamp(approval.expiresAt)}</p></div> : null}

        {approval ? <section aria-labelledby="x402-facilitator-verification" className="mt-4 border border-current p-3">
          <div className="flex flex-wrap items-center justify-between gap-3"><h4 id="x402-facilitator-verification" className="font-mono text-[9px] uppercase tracking-[0.14em]">CIRCLE SIGNATURE CHECK</h4>{verification ? <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[color:var(--ok)]">VERIFIED</span> : null}</div>
          <p className="mt-2 font-mono text-[10px] leading-relaxed opacity-75">Checks this authorization with Circle. Verification never settles payment.</p>
          {!signature && !settlement ? <p className="mt-3 border-l-2 border-[color:var(--warn)] pl-3 font-mono text-[10px] leading-relaxed text-[color:var(--warn)]">WALLET SIGNATURE REQUIRED / complete the authorization step first.</p> : null}
          {!verification ? <ConfirmationBox title="VERIFY BEFORE SETTLEMENT" description="Optional preflight. The signature stays in memory for settlement after a successful check." value={verificationConfirmation} onChange={setVerificationConfirmation} phrase="VERIFY_ARC_TESTNET_X402" action={busy === "verify" ? "CHECKING WITH CIRCLE..." : "VERIFY SIGNATURE"} disabled={busy !== null || !signature} onSubmit={() => void verifyWithCircle()} /> : <div className="mt-3 space-y-1 border-t border-current pt-3 font-mono text-[10px] leading-relaxed text-[color:var(--ok)]"><div>PAYER / {verification.payer ?? "NOT RETURNED"}</div><div className="break-all">EVIDENCE / {verification.evidenceHash}</div><div>RECORDED / {formatExecutionTimestamp(verification.verifiedAt)}</div></div>}
        </section> : null}

        {settlementReadiness ? <section aria-labelledby="x402-settlement-readiness" className="mt-4 border-t border-current pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><h4 id="x402-settlement-readiness" className="font-mono text-[9px] uppercase tracking-[0.14em] opacity-70">SETTLEMENT</h4><span className="font-mono text-[9px] uppercase tracking-[0.1em]" style={{ color: readinessToneColor(settlementReadinessTone(settlementReadiness.status)) }}>{settlementReadinessLabel(settlementReadiness.status)}</span></div>
          <p className="mt-2 font-mono text-[10px] leading-relaxed opacity-75">{settlementReadiness.reason}</p>
          <dl className="mt-3 grid gap-px bg-current/20 sm:grid-cols-2"><ReviewFact label="STATE" value={settlementReadiness.state.replaceAll("_", " ")} /><ReviewFact label="NEXT ACTION" value={settlementReadiness.nextAction.replaceAll("_", " ")} /><ReviewFact label="SETTLEMENT REF" value={settlementReadiness.settlementRef ?? "NOT RECORDED"} /><ReviewFact label="PROVIDER TRANSFER" value={settlementReadiness.providerTransferId ?? "NOT RECORDED"} /></dl>
          {settlementReadiness.status === "ready" ? <ConfirmationBox title="EXECUTE PAID AGENT TASK" description="This sends the reviewed x402 authorization to the exact provider resource. The provider settles testnet USDC and must return both the task result and PAYMENT-RESPONSE proof." value={settlementConfirmation} onChange={setSettlementConfirmation} phrase="EXECUTE_ARC_TESTNET_X402" action={busy === "settle" ? "RUNNING PAID TASK..." : "PAY AND RUN AGENT"} disabled={busy !== null || !signature || AGON_PREVIEW_MODE} onSubmit={() => void settle()} /> : null}
          {settlement ? <div role="status" className="mt-3 border-l-2 border-[color:var(--ok)] pl-3 font-mono text-[10px] leading-relaxed text-[color:var(--ok)]"><p>{settlement.state === "service_delivered" ? "SERVICE DELIVERED" : "PAYMENT SUBMITTED"} / {settlement.providerTransferId ?? settlement.transaction ?? "REFERENCE PENDING"}</p>{settlement.responseHash ? <p className="mt-1 break-all">RESPONSE HASH / {settlement.responseHash}</p> : null}{settlement.serviceResult !== undefined ? <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap border border-current/30 p-3 text-current">{JSON.stringify(settlement.serviceResult, null, 2)}</pre> : null}</div> : null}
        </section> : null}

        {reconciliationReadiness ? <section className="mt-4 border-t border-current pt-4">
          <div className="font-mono text-[9px] uppercase tracking-[0.12em]">RECEIPT RECONCILIATION / {reconciliationReadiness.status.replaceAll("_", " ")}</div>
          <p className="mt-2 font-mono text-[10px] leading-relaxed opacity-75">{reconciliationReadiness.reason}</p>
          {reconciliationReadiness.lookupEnabled && (reconciliationReadiness.status === "lookup_required" || reconciliationReadiness.nextAction === "reconcile_receipt") ? <ConfirmationBox title="READ PROVIDER RECEIPT" description="This performs a read-only Circle transfer lookup. It cannot submit another payment." value={reconciliationConfirmation} onChange={setReconciliationConfirmation} phrase="RECONCILE_ARC_TESTNET_X402" action={busy === "reconcile" ? "RECONCILING..." : "RECONCILE RECEIPT"} disabled={busy !== null} onSubmit={() => void reconcile()} /> : null}
          {reconciliation ? <p role="status" className="mt-3 border-l-2 border-[color:var(--ok)] pl-3 font-mono text-[10px] leading-relaxed text-[color:var(--ok)]">LOOKUP {reconciliation.status.toUpperCase()} / STATE {reconciliation.state.replaceAll("_", " ").toUpperCase()}</p> : null}
        </section> : null}
      </> : null}
    </section>
  );
}

function ConfirmationBox({ title, description, value, onChange, phrase, action, disabled, onSubmit, footnote }: { title: string; description: string; value: string; onChange: (value: string) => void; phrase: string; action: string; disabled: boolean; onSubmit: () => void; footnote?: string }) {
  return <div className="mt-4 border border-current p-3"><div className="font-mono text-[9px] uppercase tracking-[0.12em]">{title}</div><p className="mt-2 font-mono text-[10px] leading-relaxed opacity-75">{description}</p><label className="mt-3 block font-mono text-[9px] uppercase tracking-[0.1em] opacity-70">TYPE TO CONFIRM<input value={value} onChange={(event) => onChange(event.target.value)} placeholder={phrase} autoComplete="off" spellCheck={false} className="mt-2 h-10 w-full border border-current bg-transparent px-3 font-mono text-[10px] text-current placeholder:opacity-40" /></label>{footnote ? <div className="mt-2 break-all font-mono text-[9px] uppercase tracking-[0.08em] opacity-50">{footnote}</div> : null}<TagButton variant="primary" size="sm" className="mt-3" onClick={onSubmit} disabled={disabled || value !== phrase}>{action}</TagButton></div>;
}

function fromUnixSeconds(value: string): string {
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) ? new Date(seconds * 1000).toISOString() : value;
}

function readinessToneColor(tone: "warn" | "ok" | "err"): string {
  return tone === "ok" ? "var(--ok)" : tone === "err" ? "var(--err)" : "var(--warn)";
}

function ReviewFact({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 bg-black/10 p-3"><dt className="font-mono text-[8px] uppercase tracking-[0.12em] opacity-60">{label}</dt><dd className="mt-1 break-all font-mono text-[10px] leading-relaxed">{value}</dd></div>;
}

function message(failure: unknown, fallback: string): string {
  return failure instanceof Error ? failure.message : fallback;
}
