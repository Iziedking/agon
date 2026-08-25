"use client";

import { useCallback, useState } from "react";

import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import { AGON_CONTRACTS, EXPLORER, publicClient } from "@/lib/arc";
import { agonArenaAbi, agonJobEscrowAbi, agonPrizeVaultAbi, agonSyndicateRegistryAbi } from "@/lib/agon/abi";
import { AGON_NETWORK } from "@/lib/agon/network";

type ProtocolState = { label: string; value: string };

const explorer = (address: string) => `${EXPLORER}/address/${address}`;

export default function AgonProtocolPage() {
  const [jobId, setJobId] = useState("");
  const [job, setJob] = useState<ProtocolState[] | null>(null);
  const [arenaId, setArenaId] = useState("");
  const [arena, setArena] = useState<ProtocolState[] | null>(null);
  const [syndicateId, setSyndicateId] = useState("");
  const [syndicate, setSyndicate] = useState<ProtocolState[] | null>(null);
  const [poolKey, setPoolKey] = useState("");
  const [pool, setPool] = useState<ProtocolState[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const readJob = useCallback(async () => {
    if (!/^\d+$/.test(jobId)) return;
    setError(null);
    try {
      const value = await publicClient.readContract({ address: AGON_CONTRACTS.JobEscrow, abi: agonJobEscrowAbi, functionName: "getJob", args: [BigInt(jobId)] });
      setJob([
        { label: "buyer", value: value.buyer }, { label: "provider", value: value.provider },
        { label: "listing", value: value.listingId.toString() }, { label: "amount", value: value.amount.toString() },
        { label: "fee", value: value.fee.toString() }, { label: "status", value: value.status.toString() },
        { label: "settlement", value: value.settlement.toString() }, { label: "deliverable", value: value.deliverableHash },
      ]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not read the Agon job."); }
  }, [jobId]);

  const readArena = useCallback(async () => {
    if (!/^\d+$/.test(arenaId)) return;
    setError(null);
    try {
      const value = await publicClient.readContract({ address: AGON_CONTRACTS.Arena, abi: agonArenaAbi, functionName: "getEvaluation", args: [BigInt(arenaId)] });
      setArena([
        { label: "listing", value: value.listingId.toString() }, { label: "agent", value: value.agentId.toString() },
        { label: "version", value: value.listingVersion.toString() }, { label: "score", value: value.score.toString() },
        { label: "state", value: value.state.toString() }, { label: "participant", value: value.participant },
        { label: "evidence", value: value.evidenceRoot }, { label: "response", value: value.validationResponseHash },
      ]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not read the Arena evaluation."); }
  }, [arenaId]);

  const readSyndicate = useCallback(async () => {
    if (!/^\d+$/.test(syndicateId)) return;
    setError(null);
    try {
      const value = await publicClient.readContract({ address: AGON_CONTRACTS.SyndicateRegistry, abi: agonSyndicateRegistryAbi, functionName: "getSyndicate", args: [BigInt(syndicateId)] });
      setSyndicate([
        { label: "creator", value: value.creator }, { label: "state", value: value.state.toString() },
        { label: "members", value: value.memberCount.toString() }, { label: "name hash", value: value.nameHash },
        { label: "campaign", value: value.campaignHash },
      ]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not read the syndicate."); }
  }, [syndicateId]);

  const readPool = useCallback(async () => {
    if (!/^0x[0-9a-fA-F]{64}$/.test(poolKey)) return;
    setError(null);
    try {
      const value = await publicClient.readContract({ address: AGON_CONTRACTS.PrizeVault, abi: agonPrizeVaultAbi, functionName: "getPool", args: [poolKey as `0x${string}`] });
      setPool([
        { label: "sponsor", value: value.sponsor }, { label: "state", value: value.state.toString() },
        { label: "principal", value: value.principal.toString() }, { label: "fee", value: value.fee.toString() },
        { label: "payout", value: value.payoutTotal.toString() }, { label: "claimed", value: value.claimedTotal.toString() },
        { label: "deadline", value: value.claimDeadline.toString() }, { label: "root", value: value.payoutRoot },
      ]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not read the prize pool."); }
  }, [poolKey]);

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />
      <main className="mx-auto max-w-[1500px] px-4 pb-24 pt-14 sm:px-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">AGON PROTOCOL / {AGON_NETWORK.environment} ENVIRONMENT</p>
        <h1 className="mt-4 max-w-3xl font-stencil text-[clamp(42px,7vw,90px)] uppercase leading-[0.88]">The live rails.</h1>
        <p className="mt-6 max-w-2xl font-mono text-sm leading-7 text-ink-2">Inspect deployed protocol state and verify immutable Arc receipts. Operational writes are isolated in the token-gated administrator console.</p>
        <div className="mt-10 grid gap-px bg-[color:var(--hairline)] md:grid-cols-3">
          <ProtocolCard label="JOB ESCROW" address={AGON_CONTRACTS.JobEscrow} />
          <ProtocolCard label="ARENA" address={AGON_CONTRACTS.Arena} />
          <ProtocolCard label="PRIZE VAULT" address={AGON_CONTRACTS.PrizeVault} />
          <ProtocolCard label="SYNDICATE REGISTRY" address={AGON_CONTRACTS.SyndicateRegistry} />
          <ProtocolCard label="PROFILE REGISTRY" address={AGON_CONTRACTS.ProfileRegistry} />
          <ProtocolCard label="SERVICE REGISTRY" address={AGON_CONTRACTS.ServiceRegistry} />
        </div>
        {error ? <p role="alert" className="mt-6 border-l-2 border-[color:var(--err)] bg-canvas-2 p-4 font-mono text-xs leading-6 text-[color:var(--err)]">{error}</p> : null}
        <section className="mt-12 grid gap-5 lg:grid-cols-2">
          <Inspector title="Job escrow" value={jobId} setValue={setJobId} onRead={readJob} data={job} />
          <Inspector title="Arena evaluation" value={arenaId} setValue={setArenaId} onRead={readArena} data={arena} />
          <Inspector title="Syndicate registry" value={syndicateId} setValue={setSyndicateId} onRead={readSyndicate} data={syndicate} />
          <Inspector title="Prize vault" value={poolKey} setValue={setPoolKey} onRead={readPool} data={pool} placeholder="0x pool key" />
        </section>
      </main>
      <Footer />
      <style jsx>{`.action{min-height:44px;border:1px solid var(--hairline-strong);padding:0 14px;font:10px/1 monospace;letter-spacing:.12em}.action:hover{border-color:var(--ink);background:var(--ink);color:var(--canvas)}`}</style>
    </div>
  );
}

function ProtocolCard({ label, address }: { label: string; address: string }) {
  return <a href={explorer(address)} target="_blank" rel="noreferrer" className="bg-canvas p-5 transition-colors hover:bg-canvas-2"><span className="block font-mono text-[10px] uppercase tracking-[.15em] text-accent">{label}</span><span className="mt-4 block break-all font-mono text-[11px] text-ink-2">{address}</span><span className="mt-4 block font-mono text-[10px] uppercase tracking-[.12em] text-ink-3">VIEW ARC RECEIPTS</span></a>;
}

function Inspector({ title, value, setValue, onRead, data, placeholder }: { title: string; value: string; setValue: (value: string) => void; onRead: () => Promise<void>; data: ProtocolState[] | null; placeholder?: string }) {
  return <section className="border border-[color:var(--hairline-strong)] bg-canvas p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-mono text-[11px] uppercase tracking-[.16em]">{title}</h2><span className="font-mono text-[10px] uppercase tracking-[.12em] text-ink-3">READ ONLY</span></div><div className="mt-5 flex gap-2"><input value={value} onChange={(event) => setValue(event.target.value)} placeholder={placeholder ?? "numeric id"} className="h-11 min-w-0 flex-1 border border-[color:var(--hairline-strong)] bg-canvas-2 px-3 font-mono text-xs outline-none focus:border-ink" /><button type="button" onClick={() => void onRead()} className="action">READ</button></div>{data ? <dl className="mt-5 grid gap-2 border-t border-[color:var(--hairline)] pt-4">{data.map((item) => <div key={item.label} className="grid grid-cols-[100px_1fr] gap-3 font-mono text-[11px]"><dt className="uppercase text-ink-3">{item.label}</dt><dd className="break-all text-ink-2">{item.value}</dd></div>)}</dl> : <p className="mt-5 font-mono text-xs leading-6 text-ink-3">Enter an onchain id to load the current state.</p>}</section>;
}
