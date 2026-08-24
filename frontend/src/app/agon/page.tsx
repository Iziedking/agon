"use client";

import { useCallback, useState, type ReactNode } from "react";
import { keccak256, stringToHex } from "viem";
import { useAccount } from "wagmi";

import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import { AGON_CONTRACTS, EXPLORER, publicClient, confirmTx } from "@/lib/arc";
import {
  agonArenaAbi,
  agonJobEscrowAbi,
  agonPrizeVaultAbi,
  agonSyndicateRegistryAbi,
} from "@/lib/agon/abi";
import { useArcWrite } from "@/hooks/useArcWrite";
import { ProtocolActions } from "@/components/agon/ProtocolActions";

type ProtocolState = { label: string; value: string };

const explorer = (address: string) => `${EXPLORER}/address/${address}`;

function stringify(value: unknown): string {
  return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item, 2);
}

export default function AgonProtocolPage() {
  const { address } = useAccount();
  const { writeContractAsync, isPending } = useArcWrite();
  const [jobId, setJobId] = useState("");
  const [jobHash, setJobHash] = useState("");
  const [job, setJob] = useState<ProtocolState[] | null>(null);
  const [arenaId, setArenaId] = useState("");
  const [arenaHash, setArenaHash] = useState("");
  const [arenaScore, setArenaScore] = useState("");
  const [arena, setArena] = useState<ProtocolState[] | null>(null);
  const [syndicateId, setSyndicateId] = useState("");
  const [syndicate, setSyndicate] = useState<ProtocolState[] | null>(null);
  const [poolKey, setPoolKey] = useState("");
  const [pool, setPool] = useState<ProtocolState[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const readJob = useCallback(async () => {
    if (!jobId || !/^\d+$/.test(jobId)) return;
    setError(null);
    try {
      const value = await publicClient.readContract({
        address: AGON_CONTRACTS.JobEscrow,
        abi: agonJobEscrowAbi,
        functionName: "getJob",
        args: [BigInt(jobId)],
      });
      setJob([
        { label: "buyer", value: value.buyer },
        { label: "provider", value: value.provider },
        { label: "listing", value: value.listingId.toString() },
        { label: "amount", value: value.amount.toString() },
        { label: "fee", value: value.fee.toString() },
        { label: "status", value: value.status.toString() },
        { label: "settlement", value: value.settlement.toString() },
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read the Agon job.");
    }
  }, [jobId]);

  const readArena = useCallback(async () => {
    if (!arenaId || !/^\d+$/.test(arenaId)) return;
    setError(null);
    try {
      const value = await publicClient.readContract({
        address: AGON_CONTRACTS.Arena,
        abi: agonArenaAbi,
        functionName: "getEvaluation",
        args: [BigInt(arenaId)],
      });
      setArena([
        { label: "listing", value: value.listingId.toString() },
        { label: "agent", value: value.agentId.toString() },
        { label: "version", value: value.listingVersion.toString() },
        { label: "score", value: value.score.toString() },
        { label: "state", value: value.state.toString() },
        { label: "participant", value: value.participant },
        { label: "evaluator version", value: value.evaluatorVersionHash },
        { label: "task commitment", value: value.taskCommitment },
        { label: "evidence root", value: value.evidenceRoot },
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read the Arena evaluation.");
    }
  }, [arenaId]);

  const readSyndicate = useCallback(async () => {
    if (!syndicateId || !/^\d+$/.test(syndicateId)) return;
    setError(null);
    try {
      const value = await publicClient.readContract({
        address: AGON_CONTRACTS.SyndicateRegistry,
        abi: agonSyndicateRegistryAbi,
        functionName: "getSyndicate",
        args: [BigInt(syndicateId)],
      });
      setSyndicate([
        { label: "creator", value: value.creator },
        { label: "state", value: value.state.toString() },
        { label: "members", value: value.memberCount.toString() },
        { label: "name hash", value: value.nameHash },
        { label: "campaign hash", value: value.campaignHash },
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read the syndicate.");
    }
  }, [syndicateId]);

  const readPool = useCallback(async () => {
    if (!/^0x[0-9a-fA-F]{64}$/.test(poolKey)) return;
    setError(null);
    try {
      const value = await publicClient.readContract({
        address: AGON_CONTRACTS.PrizeVault,
        abi: agonPrizeVaultAbi,
        functionName: "getPool",
        args: [poolKey as `0x${string}`],
      });
      setPool([
        { label: "sponsor", value: value.sponsor },
        { label: "state", value: value.state.toString() },
        { label: "gross", value: value.grossAmount.toString() },
        { label: "distributable", value: value.distributableAmount.toString() },
        { label: "claimed", value: value.claimedAmount.toString() },
        { label: "deadline", value: value.claimDeadline.toString() },
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read the prize pool.");
    }
  }, [poolKey]);

  async function runWrite(action: () => Promise<`0x${string}`>, label: string) {
    setError(null);
    setNotice(null);
    try {
      const hash = await action();
      await confirmTx(hash);
      setNotice(`${label} confirmed: ${hash}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${label} failed.`);
    }
  }

  async function acceptJob() {
    if (!jobId) return;
    await runWrite(() => writeContractAsync({ address: AGON_CONTRACTS.JobEscrow, abi: agonJobEscrowAbi, functionName: "acceptJob", args: [BigInt(jobId)] }), "Job acceptance");
    await readJob();
  }

  async function autoAcceptJob() {
    if (!jobId) return;
    await runWrite(() => writeContractAsync({ address: AGON_CONTRACTS.JobEscrow, abi: agonJobEscrowAbi, functionName: "autoAccept", args: [BigInt(jobId)] }), "Job auto-acceptance");
    await readJob();
  }

  async function submitJob() {
    if (!jobId || !/^0x[0-9a-fA-F]{64}$/.test(jobHash)) return;
    await runWrite(() => writeContractAsync({ address: AGON_CONTRACTS.JobEscrow, abi: agonJobEscrowAbi, functionName: "submitJob", args: [BigInt(jobId), jobHash as `0x${string}`] }), "Job submission");
    await readJob();
  }

  async function acceptSubmission() {
    if (!jobId) return;
    await runWrite(() => writeContractAsync({ address: AGON_CONTRACTS.JobEscrow, abi: agonJobEscrowAbi, functionName: "acceptSubmission", args: [BigInt(jobId)] }), "Submission acceptance");
    await readJob();
  }

  async function rejectSubmission() {
    if (!jobId || !/^0x[0-9a-fA-F]{64}$/.test(jobHash)) return;
    await runWrite(() => writeContractAsync({ address: AGON_CONTRACTS.JobEscrow, abi: agonJobEscrowAbi, functionName: "rejectSubmission", args: [BigInt(jobId), jobHash as `0x${string}`] }), "Submission rejection");
    await readJob();
  }

  async function openDispute() {
    if (!jobId || !/^0x[0-9a-fA-F]{64}$/.test(jobHash)) return;
    await runWrite(() => writeContractAsync({ address: AGON_CONTRACTS.JobEscrow, abi: agonJobEscrowAbi, functionName: "openDispute", args: [BigInt(jobId), jobHash as `0x${string}`] }), "Dispute opening");
    await readJob();
  }

  async function failJob() {
    if (!jobId) return;
    await runWrite(() => writeContractAsync({ address: AGON_CONTRACTS.JobEscrow, abi: agonJobEscrowAbi, functionName: "failJob", args: [BigInt(jobId)] }), "Job refund");
    await readJob();
  }

  async function expireArena() {
    if (!arenaId) return;
    await runWrite(() => writeContractAsync({ address: AGON_CONTRACTS.Arena, abi: agonArenaAbi, functionName: "expireEvaluation", args: [BigInt(arenaId)] }), "Arena expiry");
    await readArena();
  }

  async function startArena() {
    if (!arenaId) return;
    await runWrite(() => writeContractAsync({ address: AGON_CONTRACTS.Arena, abi: agonArenaAbi, functionName: "startEvaluation", args: [BigInt(arenaId)] }), "Arena evaluation start");
    await readArena();
  }

  async function submitArenaEvidence() {
    if (!arenaId || !/^0x[0-9a-fA-F]{64}$/.test(arenaHash)) return;
    await runWrite(() => writeContractAsync({ address: AGON_CONTRACTS.Arena, abi: agonArenaAbi, functionName: "submitEvidence", args: [BigInt(arenaId), arenaHash as `0x${string}`] }), "Arena evidence submission");
    await readArena();
  }

  async function scoreArena() {
    if (!arenaId || !/^0x[0-9a-fA-F]{64}$/.test(arenaHash) || !/^\d+$/.test(arenaScore)) return;
    await runWrite(() => writeContractAsync({ address: AGON_CONTRACTS.Arena, abi: agonArenaAbi, functionName: "scoreEvaluation", args: [BigInt(arenaId), Number(arenaScore), arenaHash as `0x${string}`] }), "Arena score");
    await readArena();
  }

  async function joinSyndicate() {
    if (!syndicateId || !address) return;
    document.getElementById("agon-protocol-actions")?.scrollIntoView({ behavior: "smooth", block: "start" });
    setNotice("The join form is ready below. Enter an ERC-8004 agent id owned by this wallet, then sign the transaction.");
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />
      <main className="mx-auto max-w-[1500px] px-4 pb-24 pt-14 sm:px-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">AGON PROTOCOL / ARC TESTNET</p>
        <h1 className="mt-4 max-w-3xl font-stencil text-[clamp(42px,7vw,90px)] uppercase leading-[0.88]">The live rails.</h1>
        <p className="mt-6 max-w-2xl font-mono text-sm leading-7 text-ink-2">Inspect deployed protocol state, verify receipts, and execute bounded testnet actions from one place. Every write opens the connected wallet and waits for a successful Arc receipt.</p>
        <div className="mt-10 grid gap-px bg-[color:var(--hairline)] md:grid-cols-3">
          <ProtocolCard label="JOB ESCROW" address={AGON_CONTRACTS.JobEscrow} />
          <ProtocolCard label="ARENA" address={AGON_CONTRACTS.Arena} />
          <ProtocolCard label="PRIZE VAULT" address={AGON_CONTRACTS.PrizeVault} />
          <ProtocolCard label="SYNDICATE REGISTRY" address={AGON_CONTRACTS.SyndicateRegistry} />
          <ProtocolCard label="PROFILE REGISTRY" address={AGON_CONTRACTS.ProfileRegistry} />
          <ProtocolCard label="SERVICE REGISTRY" address={AGON_CONTRACTS.ServiceRegistry} />
        </div>

        {notice ? <p role="status" className="mt-6 border-l-2 border-accent bg-canvas-2 p-4 font-mono text-xs leading-6">{notice}</p> : null}
        {error ? <p role="alert" className="mt-6 border-l-2 border-[color:var(--err)] bg-canvas-2 p-4 font-mono text-xs leading-6 text-[color:var(--err)]">{error}</p> : null}

        <section className="mt-12 grid gap-5 lg:grid-cols-2">
          <Inspector title="Job escrow" value={jobId} setValue={setJobId} onRead={readJob} data={job}>
            <input value={jobHash} onChange={(event) => setJobHash(event.target.value)} placeholder="deliverable or reason hash (0x...)" className="h-11 min-w-[240px] flex-1 border border-[color:var(--hairline-strong)] bg-canvas-2 px-3 font-mono text-xs outline-none focus:border-ink" />
            <button type="button" onClick={acceptJob} disabled={isPending || !jobId} className="action">ACCEPT JOB</button>
            <button type="button" onClick={submitJob} disabled={isPending || !jobId || !/^0x[0-9a-fA-F]{64}$/.test(jobHash)} className="action">SUBMIT</button>
            <button type="button" onClick={acceptSubmission} disabled={isPending || !jobId} className="action">ACCEPT DELIVERY</button>
            <button type="button" onClick={rejectSubmission} disabled={isPending || !jobId || !/^0x[0-9a-fA-F]{64}$/.test(jobHash)} className="action">REJECT</button>
            <button type="button" onClick={openDispute} disabled={isPending || !jobId || !/^0x[0-9a-fA-F]{64}$/.test(jobHash)} className="action">OPEN DISPUTE</button>
            <button type="button" onClick={autoAcceptJob} disabled={isPending || !jobId} className="action">AUTO-ACCEPT</button>
            <button type="button" onClick={failJob} disabled={isPending || !jobId} className="action">REFUND AFTER TIMEOUT</button>
          </Inspector>
          <Inspector title="Arena evaluation" value={arenaId} setValue={setArenaId} onRead={readArena} data={arena}>
            <input value={arenaHash} onChange={(event) => setArenaHash(event.target.value)} placeholder="evidence or validation hash (0x...)" className="h-11 min-w-[240px] flex-1 border border-[color:var(--hairline-strong)] bg-canvas-2 px-3 font-mono text-xs outline-none focus:border-ink" />
            <input value={arenaScore} onChange={(event) => setArenaScore(event.target.value)} placeholder="score 0-100" className="h-11 w-32 border border-[color:var(--hairline-strong)] bg-canvas-2 px-3 font-mono text-xs outline-none focus:border-ink" />
            <button type="button" onClick={startArena} disabled={isPending || !arenaId} className="action">START</button>
            <button type="button" onClick={submitArenaEvidence} disabled={isPending || !arenaId || !/^0x[0-9a-fA-F]{64}$/.test(arenaHash)} className="action">SUBMIT EVIDENCE</button>
            <button type="button" onClick={scoreArena} disabled={isPending || !arenaId || !/^0x[0-9a-fA-F]{64}$/.test(arenaHash) || !/^\d+$/.test(arenaScore)} className="action">SCORE</button>
            <button type="button" onClick={expireArena} disabled={isPending || !arenaId} className="action">EXPIRE EVALUATION</button>
          </Inspector>
          <Inspector title="Syndicate registry" value={syndicateId} setValue={setSyndicateId} onRead={readSyndicate} data={syndicate}>
            <button type="button" onClick={joinSyndicate} disabled={!syndicateId} className="action">CHECK JOIN FLOW</button>
          </Inspector>
          <Inspector title="Prize vault" value={poolKey} setValue={setPoolKey} onRead={readPool} data={pool} placeholder="0x pool key" />
        </section>
        <div id="agon-protocol-actions"><ProtocolActions /></div>
      </main>
      <Footer />
      <style jsx>{`
        .action { min-height: 44px; border: 1px solid var(--hairline-strong); padding: 0 14px; font: 10px/1 monospace; letter-spacing: .12em; }
        .action:hover:not(:disabled) { border-color: var(--ink); background: var(--ink); color: var(--canvas); }
        .action:disabled { cursor: not-allowed; opacity: .4; }
      `}</style>
    </div>
  );
}

function ProtocolCard({ label, address }: { label: string; address: string }) {
  return <a href={explorer(address)} target="_blank" rel="noreferrer" className="bg-canvas p-5 transition-colors hover:bg-canvas-2"><span className="block font-mono text-[10px] uppercase tracking-[.15em] text-accent">{label}</span><span className="mt-4 block break-all font-mono text-[11px] text-ink-2">{address}</span><span className="mt-4 block font-mono text-[10px] uppercase tracking-[.12em] text-ink-3">VIEW ARC RECEIPTS ↗</span></a>;
}

function Inspector({ title, value, setValue, onRead, data, children, placeholder }: { title: string; value: string; setValue: (value: string) => void; onRead: () => Promise<void>; data: ProtocolState[] | null; children?: ReactNode; placeholder?: string }) {
  return <section className="border border-[color:var(--hairline-strong)] bg-canvas p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-mono text-[11px] uppercase tracking-[.16em]">{title}</h2><span className="font-mono text-[10px] uppercase tracking-[.12em] text-ink-3">READ + PROVE</span></div><div className="mt-5 flex gap-2"><input value={value} onChange={(event) => setValue(event.target.value)} placeholder={placeholder ?? "numeric id"} className="h-11 min-w-0 flex-1 border border-[color:var(--hairline-strong)] bg-canvas-2 px-3 font-mono text-xs outline-none focus:border-ink" /><button type="button" onClick={() => void onRead()} className="action">READ</button></div>{data ? <dl className="mt-5 grid gap-2 border-t border-[color:var(--hairline)] pt-4">{data.map((item) => <div key={item.label} className="grid grid-cols-[100px_1fr] gap-3 font-mono text-[11px]"><dt className="uppercase text-ink-3">{item.label}</dt><dd className="break-all text-ink-2">{item.value}</dd></div>)}</dl> : <p className="mt-5 font-mono text-xs leading-6 text-ink-3">Enter an onchain id to load the current state.</p>}{children ? <div className="mt-5 flex flex-wrap gap-2 border-t border-[color:var(--hairline)] pt-4">{children}</div> : null}</section>;
}
