"use client";

import { useEffect, useMemo, useState } from "react";

import { LoginModal } from "@/components/pengu/LoginModal";
import { ProtocolActions } from "@/components/agon/ProtocolActions";
import { X402CallIntentPanel } from "@/components/agon/X402CallIntentPanel";
import { useAuth } from "@/hooks/useAuth";
import {
  getAgonEscrowReadiness,
  getAgonEscrowTransaction,
  getAgonHealth,
  listListings,
  prepareAgonEscrowIntent,
} from "@/lib/agon/client";
import type { AgonEscrowIntentView, AgonEscrowReadinessView, AgonEscrowTransactionView, AgonHealth, AgonListing } from "@/lib/agon/types";

const inputClass = "w-full border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2 font-mono text-xs text-ink outline-none focus:border-ink";

export function AgonAdminConsole() {
  const [health, setHealth] = useState<AgonHealth | null>(null);
  const [listings, setListings] = useState<AgonListing[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
        <button onClick={() => void load()} disabled={loading} className="border border-[color:var(--hairline-strong)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:text-ink disabled:opacity-50">{loading ? "LOADING" : "REFRESH AGON"}</button>
      </div>

      {error ? <p className="border-l-2 border-[color:var(--err)] p-3 font-mono text-xs text-[color:var(--err)]">{error}</p> : null}
      <AgonReadiness health={health} />

      <div className="grid gap-6 lg:grid-cols-2">
        <AgonListingPicker listings={listings} selectedId={selectedId} onChange={setSelectedId} />
        <AgonEscrowPreparation listing={selected} />
      </div>

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
    </div>
  );
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
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-accent">ARC TESTNET / 5042002</span>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map(([label, enabled]) => <div key={label} className="flex items-center justify-between border-t border-[color:var(--hairline)] py-2 font-mono text-[11px]"><span className="text-ink-2">{label}</span><span className={enabled ? "text-[color:var(--ok)]" : "text-ink-3"}>{enabled ? "READY" : "GATED"}</span></div>)}
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
  const [feeBps, setFeeBps] = useState("0");
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
        feeBps: Number(feeBps),
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

  return <section className="border border-[color:var(--hairline-strong)] bg-canvas p-5"><div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">ESCROW BACKEND FLOW</div><p className="mt-2 font-mono text-[10px] leading-5 text-ink-3">Prepare exact terms, inspect readiness, and review the unsigned createJob transaction. Funding still requires the buyer wallet.</p><div className="mt-4 grid gap-2"><input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="amount in USDC base units" className={inputClass} /><div className="grid grid-cols-2 gap-2"><input value={feeBps} onChange={(event) => setFeeBps(event.target.value)} placeholder="fee bps" className={inputClass} /><input value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} type="datetime-local" className={inputClass} /></div><input value={idempotencyKey} onChange={(event) => setIdempotencyKey(event.target.value)} placeholder="idempotency key, optional" className={inputClass} /><button disabled={busy || !listing || !/^\d+$/.test(amount) || amount === "0" || !/^\d+$/.test(feeBps) || Number(feeBps) > 1000} onClick={() => void prepare()} className="bg-accent px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press disabled:opacity-50">{busy ? "PREPARING" : "PREPARE ESCROW"}</button></div>{message ? <p className="mt-3 font-mono text-[10px] text-[color:var(--err)]">{message}</p> : null}{intent ? <div className="mt-4 grid gap-2 border-t border-[color:var(--hairline)] pt-3 font-mono text-[10px] text-ink-2"><span>INTENT {intent.intentId}</span><span>STATE {intent.state} / {intent.nextAction}</span><span>TERMS {intent.termsHash}</span>{readiness ? <span>READINESS {readiness.status} / {readiness.reason}</span> : null}{transaction ? <span className="break-all">CALL {transaction.functionName} TO {transaction.to} / {transaction.data}</span> : null}</div> : null}<LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} /></section>;
}

function EmptyState({ message }: { message: string }) {
  return <div className="border border-dashed border-[color:var(--hairline-strong)] p-4 font-mono text-[11px] leading-5 text-ink-3">{message}</div>;
}
