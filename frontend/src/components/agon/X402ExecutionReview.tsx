"use client";

import { useEffect, useState } from "react";

import { getX402ExecutionReadiness } from "@/lib/agon/client";
import { executionReadinessLabel, executionReadinessTone, formatExecutionTimestamp, formatUSDCBaseUnits } from "@/lib/agon/execution-review";
import type { X402ExecutionReadinessView } from "@/lib/agon/types";

type Props = { intentId: string };

export function X402ExecutionReview({ intentId }: Props) {
  const [readiness, setReadiness] = useState<X402ExecutionReadinessView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setReadiness(null);
    setError(null);
    getX402ExecutionReadiness(intentId)
      .then((value) => { if (live) setReadiness(value); })
      .catch((failure) => {
        if (!live) return;
        setError(failure instanceof Error ? failure.message : "Execution review is not available yet.");
      });
    return () => { live = false; };
  }, [intentId]);

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
