"use client";
import { useEffect, useRef, useState } from "react";
import type { BnbChain, CommerceReadiness } from "./types";
import { checkCommerce } from "./client";

const reasons: Record<string, string> = {
  provider_policy_not_whitelisted: "This service is not ready to accept a new request yet.",
  provider_policy_mismatch: "The service setup needs to be updated before it can be used.",
  provider_wallet_mismatch: "The service identity could not be matched safely.",
  provider_commerce_mismatch: "The service payment setup could not be matched safely.",
  provider_router_mismatch: "The service payment setup could not be matched safely.",
  provider_token_mismatch: "The service payment currency could not be matched safely.",
  exact_price_required: "The service has not supplied one clear price yet.",
  provider_status_unavailable: "The service could not be checked. Try again later.",
  provider_unavailable: "The service is currently unavailable.",
  registration_not_qualified: "The service identity is not ready to accept work.",
  commerce_endpoint_missing: "This service has not connected a usable payment action.",
  deployment_code_missing: "A required service component is unavailable on this network.",
  deployment_binding_mismatch: "The service payment setup could not be matched safely.",
  policy_not_whitelisted: "The service is not ready to accept a new request yet.",
  commerce_paused: "Payments for this service are paused.",
  payment_token_mismatch: "The service payment currency could not be matched safely.",
  invalid_dispute_window: "The service timing could not be checked.",
  policy_quorum_unavailable: "The service review process is not ready yet.",
  mainnet_payments_disabled: "Paid use is available on Testnet first.",
  signed_quote_and_execution_not_enabled: "This service can be inspected, but its use action is not connected yet.",
  provider_hiring_unavailable: "The provider is online, but is not accepting paid requests right now.",
};
export function CommerceReadinessPanel({ chainId, agentId }: { chainId: BnbChain; agentId: string }) {
  const [result, setResult] = useState<CommerceReadiness | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    setResult(null); setError(null); setBusy(false);
    return () => pending.current?.abort();
  }, [chainId, agentId]);
  async function check() {
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setResult(null); setError(null);
    try {
      const value = await checkCommerce(chainId, agentId, controller.signal);
      if (!controller.signal.aborted && value.chainId === chainId && value.agentId === agentId) setResult(value);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "The payment check could not complete. Try again.");
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <section className="border border-[color:var(--hairline-strong)] bg-canvas-2 p-5 sm:p-6" aria-label="Service availability">
    <h3 className="font-stencil text-2xl uppercase">USE THIS AGENT</h3>
    <p className="mt-4 max-w-[85ch] font-mono text-[12px] leading-relaxed text-ink-2">Check whether this service is ready before connecting your wallet. This is free and does not start work or move funds.</p>
    <button type="button" disabled={busy} onClick={check} className="mt-5 inline-flex min-h-11 items-center border border-[color:var(--hairline-strong)] px-4 py-3 font-mono text-[11px] uppercase tracking-widest text-ink hover:bg-canvas-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50">{busy ? "CHECKING…" : "CHECK AVAILABILITY →"}</button>
    {error ? <p role="alert" className="mt-4 font-mono text-sm text-accent">{error}</p> : null}
    {result ? <div role="status" className="mt-5 space-y-4 font-mono text-[12px] leading-relaxed text-ink-2">
      <p className="uppercase tracking-widest text-accent">{result.paymentsEnabled ? "PROVIDER IS ACCEPTING REQUESTS" : "NOT AVAILABLE YET"}</p>
      {result.paymentsEnabled ? <p>The provider reports that its price, payment setup, and service are available on this network.</p> : <ul className="list-disc space-y-2 pl-5">{result.blockers.map((reason) => <li key={reason}>{reasons[reason] ?? "A required payment check did not pass."}</li>)}</ul>}
      <details className="border-t border-[color:var(--hairline)] pt-4"><summary className="cursor-pointer uppercase tracking-widest">TECHNICAL DETAILS</summary>
        <dl className="mt-4 space-y-2 break-all"><dt>SUPPORTED POLICY</dt><dd>{result.contracts.policy}</dd><dt>PROVIDER POLICY</dt><dd>{result.providerPolicy ?? "Not available"}</dd><dt>PROVIDER POLICY APPROVED BY ROUTER</dt><dd>{result.providerPolicyWhitelisted === null ? "Not checked" : result.providerPolicyWhitelisted ? "Yes" : "No"}</dd><dt>ESCROW TOKEN</dt><dd>{result.token.symbol} · {result.token.address} · {result.token.decimals} decimals</dd><dt>SUPPORTED POLICY DISPUTE WINDOW</dt><dd>{result.disputeWindowSeconds} seconds</dd><dt>CHECKED AT BLOCK</dt><dd>{result.blockNumber} · {new Date(result.checkedAt).toLocaleString()}</dd></dl>
        <p className="mt-4">A dispute is not automatically a refund. Settlement depends on the policy&apos;s voter rules. Endpoint availability does not prove delivery.</p>
      </details>
    </div> : null}
  </section>;
}
