"use client";
import { useEffect, useRef, useState } from "react";
import type { BnbChain, CommerceReadiness } from "./types";
import { checkCommerce } from "./client";

const reasons: Record<string, string> = {
  provider_policy_not_whitelisted: "The provider's payment policy is not approved by the onchain router. The provider must update its configuration before a new hire can proceed.",
  provider_policy_mismatch: "The provider advertises a different payment policy from the supported deployment.",
  provider_wallet_mismatch: "The service wallet does not match the registered agent wallet.",
  provider_commerce_mismatch: "The provider uses a different escrow contract.",
  provider_router_mismatch: "The provider uses a different settlement router.",
  provider_token_mismatch: "The provider's payment asset differs from the escrow token.",
  exact_price_required: "The provider has not supplied a safely readable exact price string. A signed quote is required before any payment.",
  provider_status_unavailable: "The provider's payment status could not be checked. Retry later.",
  provider_unavailable: "The provider reports that its service is unavailable.",
  registration_not_qualified: "The registration must be active, readable and match this agent and network.",
  commerce_endpoint_missing: "This agent does not advertise a supported payment-status endpoint.",
  deployment_code_missing: "A required contract is missing from this network.",
  deployment_binding_mismatch: "The escrow, router and policy do not point to the same deployment.",
  policy_not_whitelisted: "The supported policy is not approved by the router.",
  commerce_paused: "The escrow or settlement router is paused.",
  payment_token_mismatch: "The escrow token does not match the supported deployment.",
  invalid_dispute_window: "The dispute window could not be validated.",
  policy_quorum_unavailable: "The policy does not have enough voters for its required quorum.",
  mainnet_payments_disabled: "Mainnet payments remain disabled until the testnet flow is proven.",
  signed_quote_and_execution_not_enabled: "Signed quotes and wallet-approved hiring are still being connected. No payment can be made from this check.",
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
  return <section className="border border-[color:var(--hairline-strong)] bg-canvas-2 p-5 sm:p-6" aria-label="Payment readiness">
    <h3 className="font-stencil text-2xl uppercase">PAYMENT READINESS</h3>
    <p className="mt-4 max-w-[85ch] font-mono text-[12px] leading-relaxed text-ink-2">Check the provider's payment setup against the selected network. This only reads contracts and service status. It does not request a quote, run a task or spend funds.</p>
    <button type="button" disabled={busy} onClick={check} className="mt-5 inline-flex min-h-11 items-center border border-[color:var(--hairline-strong)] px-4 py-3 font-mono text-[11px] uppercase tracking-widest text-ink hover:bg-canvas-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50">{busy ? "CHECKING CONTRACTS…" : "CHECK PAYMENT SETUP →"}</button>
    {error ? <p role="alert" className="mt-4 font-mono text-sm text-accent">{error}</p> : null}
    {result ? <div role="status" className="mt-5 space-y-4 font-mono text-[12px] leading-relaxed text-ink-2">
      <p className="uppercase tracking-widest text-accent">HIRING UNAVAILABLE</p>
      <ul className="list-disc space-y-2 pl-5">{result.blockers.map((reason) => <li key={reason}>{reasons[reason] ?? "A required payment check did not pass."}</li>)}</ul>
      <details className="border-t border-[color:var(--hairline)] pt-4"><summary className="cursor-pointer uppercase tracking-widest">CONTRACT EVIDENCE</summary>
        <dl className="mt-4 space-y-2 break-all"><dt>SUPPORTED POLICY</dt><dd>{result.contracts.policy}</dd><dt>PROVIDER POLICY</dt><dd>{result.providerPolicy ?? "Not available"}</dd><dt>PROVIDER POLICY APPROVED BY ROUTER</dt><dd>{result.providerPolicyWhitelisted === null ? "Not checked" : result.providerPolicyWhitelisted ? "Yes" : "No"}</dd><dt>ESCROW TOKEN</dt><dd>{result.token.symbol} · {result.token.address} · {result.token.decimals} decimals</dd><dt>SUPPORTED POLICY DISPUTE WINDOW</dt><dd>{result.disputeWindowSeconds} seconds</dd><dt>CHECKED AT BLOCK</dt><dd>{result.blockNumber} · {new Date(result.checkedAt).toLocaleString()}</dd></dl>
        <p className="mt-4">A dispute is not automatically a refund. Settlement depends on the policy's voter rules. Endpoint availability does not prove delivery.</p>
      </details>
    </div> : null}
  </section>;
}
