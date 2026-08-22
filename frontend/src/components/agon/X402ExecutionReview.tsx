"use client";

import { useEffect, useState } from "react";

import { approveX402Execution, getX402ExecutionReadiness, getX402SettlementReadiness, AGON_PREVIEW_MODE } from "@/lib/agon/client";
import { executionReadinessLabel, executionReadinessTone, formatExecutionTimestamp, formatUSDCBaseUnits, newExecutionApprovalKey } from "@/lib/agon/execution-review";
import { settlementReadinessLabel, settlementReadinessTone } from "@/lib/agon/settlement-review";
import type { X402ExecutionApprovalView, X402ExecutionReadinessView, X402SettlementReadinessView } from "@/lib/agon/types";
import { TagButton } from "@/components/redesign/TagButton";

type Props = { intentId: string; refreshKey?: string | number };

export function X402ExecutionReview({ intentId, refreshKey }: Props) {
  const [readiness, setReadiness] = useState<X402ExecutionReadinessView | null>(null);
  const [settlementReadiness, setSettlementReadiness] = useState<X402SettlementReadinessView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settlementError, setSettlementError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [approval, setApproval] = useState<X402ExecutionApprovalView | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [approvalKey] = useState(newExecutionApprovalKey);

  useEffect(() => {
    let live = true;
    setReadiness(null);
    setSettlementReadiness(null);
    setError(null);
    setSettlementError(null);
    getX402ExecutionReadiness(intentId)
      .then((value) => { if (live) { setReadiness(value); setApproval(value.approval); } })
      .catch((failure) => {
        if (!live) return;
        setError(failure instanceof Error ? failure.message : "Execution review is not available yet.");
      });
    getX402SettlementReadiness(intentId)
      .then((value) => { if (live) setSettlementReadiness(value); })
      .catch((failure) => {
        if (!live) return;
        setSettlementError(failure instanceof Error ? failure.message : "Settlement readiness is not available yet.");
      });
    return () => { live = false; };
  }, [intentId, refreshKey]);

  async function approve() {
    if (!readiness || confirmation !== "APPROVE_ARC_TESTNET_X402") return;
    setApproving(true);
    setApprovalError(null);
    try {
      const result = await approveX402Execution(intentId, {
        planHash: readiness.plan.planHash,
        approvalIdempotencyKey: approvalKey,
        confirmation: "APPROVE_ARC_TESTNET_X402",
      });
      setApproval(result);
      const refreshed = await getX402ExecutionReadiness(intentId);
      setReadiness(refreshed);
      setApproval(refreshed.approval ?? result);
      setSettlementReadiness(await getX402SettlementReadiness(intentId));
    } catch (failure) {
      setApprovalError(failure instanceof Error ? failure.message : "Agon could not record this execution approval.");
    } finally {
      setApproving(false);
    }
  }

  return (
    <section aria-labelledby="x402-execution-review" className="mt-4 border-t border-current pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.15em] opacity-60">CONTROLLED REVIEW</div>
          <h3 id="x402-execution-review" className="mt-1 font-mono text-[12px] uppercase tracking-[0.1em]">EXECUTION REVIEW</h3>
        </div>
        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[color:var(--warn)]">SETTLEMENT OFF</span>
      </div>

      {error ? <p className="mt-3 border-l-2 border-[color:var(--warn)] pl-3 font-mono text-[10px] leading-relaxed opacity-75">{error} A wallet signature must be submitted before Agon can evaluate this exact plan.</p> : null}
      {!readiness && !error ? <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.08em] opacity-60">READING TESTNET PLAN...</p> : null}

      {readiness ? (
        <>
          <div className="mt-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em]" style={{ color: readinessToneColor(executionReadinessTone(readiness.status)) }}>
            <span aria-hidden className="h-2 w-2 bg-current" />
            {executionReadinessLabel(readiness.status)}
          </div>
          <p className="mt-2 font-mono text-[10px] leading-relaxed opacity-75">{readiness.reason}</p>

          <dl className="mt-4 grid gap-px bg-current/20 sm:grid-cols-2">
            <ReviewFact label="NETWORK" value="ARC TESTNET · 5042002" />
            <ReviewFact label="RAIL" value="CIRCLE GATEWAY · x402" />
            <ReviewFact label="AMOUNT" value={`${formatUSDCBaseUnits(readiness.plan.requirements.amount)} · ${readiness.plan.requirements.amount} BASE UNITS`} />
            <ReviewFact label="RECIPIENT" value={readiness.plan.requirements.payTo} mono />
            <ReviewFact label="VALID UNTIL" value={formatExecutionTimestamp(fromUnixSeconds(readiness.plan.paymentPayloadPreview.payload.authorization.validBefore))} />
            <ReviewFact label="CHECKED" value={formatExecutionTimestamp(readiness.checkedAt)} />
          </dl>

          <div className="mt-4 space-y-2 border-t border-current pt-3 font-mono text-[10px] leading-relaxed">
            <div><span className="opacity-60">PLAN HASH · </span><span className="break-all">{readiness.plan.planHash}</span></div>
            <div><span className="opacity-60">AUTHORIZATION HASH · </span><span className="break-all">{readiness.plan.authorizationHash}</span></div>
          </div>

          <div className="mt-4 border-l-2 border-[color:var(--warn)] pl-3 font-mono text-[10px] leading-relaxed text-[color:var(--warn)]">
            <div className="uppercase tracking-[0.1em]">NO PAYMENT WILL BE SENT</div>
            <p className="mt-1 text-current/80">The Circle testnet adapter is disabled. This review does not create or display a wallet signature.</p>
          </div>

          {readiness.status === "approval_required" && !approval ? (
            <div className="mt-4 border border-current p-3">
              <div className="font-mono text-[9px] uppercase tracking-[0.12em]">EXPLICIT EXECUTION APPROVAL</div>
              <p className="mt-2 font-mono text-[10px] leading-relaxed opacity-75">Confirm the exact plan above. This approval expires with the authorization and still cannot settle while the adapter is disabled.</p>
              <label className="mt-3 block font-mono text-[9px] uppercase tracking-[0.1em] opacity-70" htmlFor="agon-execution-confirmation">TYPE TO CONFIRM</label>
              <input id="agon-execution-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="APPROVE_ARC_TESTNET_X402" autoComplete="off" spellCheck={false} className="mt-2 h-10 w-full border border-current bg-transparent px-3 font-mono text-[10px] text-current placeholder:opacity-40" />
              <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.08em] opacity-50">RETRY-SAFE APPROVAL KEY · {approvalKey}</div>
              {AGON_PREVIEW_MODE ? <p className="mt-2 font-mono text-[10px] text-[color:var(--warn)]">PREVIEW MODE · approval is local fixture state only.</p> : null}
              <TagButton variant="primary" size="sm" className="mt-3" onClick={approve} disabled={approving || confirmation !== "APPROVE_ARC_TESTNET_X402"}>{approving ? "RECORDING APPROVAL..." : "APPROVE EXACT PLAN →"}</TagButton>
              {approvalError ? <p role="alert" className="mt-3 border-l-2 border-[color:var(--err)] pl-3 font-mono text-[10px] leading-relaxed text-[color:var(--err)]">{approvalError}</p> : null}
            </div>
          ) : null}

          {approval ? <div className="mt-4 border-l-2 border-[color:var(--ok)] pl-3 font-mono text-[10px] leading-relaxed text-[color:var(--ok)]"><div className="uppercase tracking-[0.1em]">APPROVED · ADAPTER OFF</div><p className="mt-1 text-current/80">Approval {approval.approvalHash} is bound to this plan and expires {formatExecutionTimestamp(approval.expiresAt)}. No payment was sent.</p></div> : null}
          <section aria-labelledby="x402-settlement-readiness" className="mt-4 border-t border-current pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h4 id="x402-settlement-readiness" className="font-mono text-[9px] uppercase tracking-[0.14em] opacity-70">SETTLEMENT READINESS</h4>
              {settlementReadiness ? <span className="font-mono text-[9px] uppercase tracking-[0.1em]" style={{ color: readinessToneColor(settlementReadinessTone(settlementReadiness.status)) }}>{settlementReadinessLabel(settlementReadiness.status)}</span> : null}
            </div>
            {settlementError ? <p className="mt-3 border-l-2 border-[color:var(--warn)] pl-3 font-mono text-[10px] leading-relaxed opacity-75">{settlementError}</p> : null}
            {!settlementReadiness && !settlementError ? <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.08em] opacity-60">CHECKING DURABLE RECEIPT...</p> : null}
            {settlementReadiness ? (
              <>
                <p className="mt-2 font-mono text-[10px] leading-relaxed opacity-75">{settlementReadiness.reason}</p>
                <dl className="mt-3 grid gap-px bg-current/20 sm:grid-cols-2">
                  <ReviewFact label="NETWORK" value="ARC TESTNET · 5042002" />
                  <ReviewFact label="NEXT ACTION" value={settlementReadiness.nextAction.replaceAll("_", " ")} />
                  <ReviewFact label="SETTLEMENT REF" value={settlementReadiness.settlementRef ?? "NOT RECORDED"} mono={Boolean(settlementReadiness.settlementRef)} />
                  <ReviewFact label="CHECKED" value={formatExecutionTimestamp(settlementReadiness.checkedAt)} />
                </dl>
              </>
            ) : null}
          </section>
        </>
      ) : null}
    </section>
  );
}

function fromUnixSeconds(value: string): string {
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) ? new Date(seconds * 1000).toISOString() : value;
}

function readinessToneColor(tone: "warn" | "ok" | "err"): string {
  return tone === "ok" ? "var(--ok)" : tone === "err" ? "var(--err)" : "var(--warn)";
}

function ReviewFact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="min-w-0 bg-black/10 p-3"><dt className="font-mono text-[8px] uppercase tracking-[0.12em] opacity-60">{label}</dt><dd className={`mt-1 break-all text-[10px] leading-relaxed ${mono ? "font-mono" : "font-mono"}`}>{value}</dd></div>;
}
