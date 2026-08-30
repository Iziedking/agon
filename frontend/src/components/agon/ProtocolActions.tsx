"use client";

import { useMemo, useState, type ReactNode } from "react";
import { keccak256, stringToHex, type Abi } from "viem";
import { useAccount } from "wagmi";

import { useArcWrite } from "@/hooks/useArcWrite";
import type { CircleWriteArgs } from "@/hooks/useCircleExecute";
import { AGON_CONTRACTS, EXPLORER, USDC, confirmTx } from "@/lib/arc";
import { agonArenaAbi, agonJobEscrowAbi, agonPrizeVaultAbi, agonSyndicateRegistryAbi, agonUsdcAbi } from "@/lib/agon/abi";

const inputClass = "h-11 w-full border border-[color:var(--hairline-strong)] bg-canvas-2 px-3 font-mono text-xs outline-none focus:border-ink";
const CONFIRMATION = "EXECUTE_ARC_TESTNET_WRITE";

export function ProtocolActions() {
  const { address } = useAccount();
  const { writeContractAsync, isPending } = useArcWrite();
  const [confirmation, setConfirmation] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [jobId, setJobId] = useState("");
  const [jobHash, setJobHash] = useState("");
  const [listingId, setListingId] = useState("");
  const [amount, setAmount] = useState("");
  const [reviewHours, setReviewHours] = useState("24");
  const [termsHash, setTermsHash] = useState("");

  const [evaluationId, setEvaluationId] = useState("");
  const [arenaHash, setArenaHash] = useState("");
  const [arenaScore, setArenaScore] = useState("");

  const [syndicateId, setSyndicateId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [syndicateName, setSyndicateName] = useState("");
  const [campaign, setCampaign] = useState("");

  const [poolKey, setPoolKey] = useState("");
  const [poolKind, setPoolKind] = useState("1");
  const [sourceId, setSourceId] = useState("");
  const [principal, setPrincipal] = useState("");
  const [poolFeeBps, setPoolFeeBps] = useState("0");
  const [payoutRoot, setPayoutRoot] = useState("");
  const [payoutTotal, setPayoutTotal] = useState("");
  const [claimDeadline, setClaimDeadline] = useState("");

  const confirmed = confirmation === CONFIRMATION;
  const amountUnits = uint(amount);
  const reviewUnits = uint(reviewHours);
  const principalUnits = uint(principal);
  const poolFeeUnits = uint(poolFeeBps);
  const poolFundingTotal = useMemo(
    () => principalUnits + (principalUnits * poolFeeUnits) / 10_000n,
    [principalUnits, poolFeeUnits],
  );

  async function submit(action: () => Promise<`0x${string}`>, label: string) {
    if (!confirmed) {
      setError(`Type ${CONFIRMATION} before sending an operator write.`);
      return;
    }
    setNotice(null);
    setError(null);
    try {
      const txHash = await action();
      await confirmTx(txHash);
      setNotice(`${label} confirmed on Arc Testnet: ${txHash}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${label} failed.`);
    }
  }

  const parsedTerms = bytes32(termsHash) ?? keccak256(stringToHex("Agon admin job terms"));
  const clientReference = keccak256(stringToHex(`agon-admin:${listingId}:${parsedTerms}:${amount}:${reviewHours}`));
  const parsedPoolKey = bytes32(poolKey);
  const parsedArenaHash = bytes32(arenaHash);
  const deadlineSeconds = claimDeadline ? BigInt(Math.floor(new Date(claimDeadline).getTime() / 1000)) : 0n;

  return (
    <section className="mt-2 border border-[color:var(--hairline-strong)] bg-canvas-2 p-5 sm:p-7">
      <p className="font-mono text-[10px] uppercase tracking-[.16em] text-accent">CONNECTED WALLET CONTROL PLANE</p>
      <h2 className="mt-3 font-stencil text-4xl uppercase leading-none">Operate the deployed protocol.</h2>
      <p className="mt-4 max-w-3xl font-mono text-xs leading-6 text-ink-2">Every transaction is wallet-originated, pinned to Arc Testnet, and accepted only after a successful receipt. Contract role checks remain authoritative.</p>
      <label className="mt-5 grid max-w-xl gap-1">
        <span className="font-mono text-[9px] uppercase tracking-[.12em] text-ink-3">TYPE {CONFIRMATION}</span>
        <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className={inputClass} autoComplete="off" />
      </label>
      {notice ? <p role="status" className="mt-5 border-l-2 border-accent p-3 font-mono text-xs leading-6">{notice} <a href={`${EXPLORER}/tx/${notice.split(": ").at(-1)}`} target="_blank" rel="noreferrer" className="underline">VIEW RECEIPT</a></p> : null}
      {error ? <p role="alert" className="mt-5 border-l-2 border-[color:var(--err)] p-3 font-mono text-xs leading-6 text-[color:var(--err)]">{error}</p> : null}

      <div className="mt-8 grid gap-8 xl:grid-cols-2">
        <ActionBlock title="Job escrow creation">
          <Field label="LISTING ID" value={listingId} setValue={setListingId} />
          <Field label="TERMS HASH" value={termsHash} setValue={setTermsHash} placeholder="bytes32, or leave blank for admin terms" />
          <div className="grid gap-2 sm:grid-cols-3"><Field label="AMOUNT" value={amount} setValue={setAmount} /><div className="border border-[color:var(--hairline-strong)] p-3 font-mono text-[10px] text-ink-2"><span className="block text-[9px] uppercase tracking-[.12em] text-ink-3">PROTOCOL FEE</span><span className="mt-2 block">5% fixed</span></div><Field label="REVIEW HOURS" value={reviewHours} setValue={setReviewHours} /></div>
          <button type="button" disabled={isPending || !confirmed || amountUnits === 0n} className="action" onClick={() => void submit(() => writeContractAsync({ address: USDC, abi: agonUsdcAbi, functionName: "approve", args: [AGON_CONTRACTS.JobEscrow, amountUnits] }), "USDC escrow approval")}>1. APPROVE EXACT PRINCIPAL</button>
          <button type="button" disabled={isPending || !confirmed || !positive(listingId) || amountUnits === 0n || reviewUnits < 1n || reviewUnits > 720n} className="action" onClick={() => void submit(() => writeContractAsync({ address: AGON_CONTRACTS.JobEscrow, abi: agonJobEscrowAbi, functionName: "createJob", args: [clientReference, BigInt(listingId), parsedTerms, amountUnits, reviewUnits] }), "Escrow job creation")}>2. CREATE FUNDED JOB</button>
        </ActionBlock>

        <ActionBlock title="Job escrow lifecycle">
          <Field label="JOB ID" value={jobId} setValue={setJobId} />
          <Field label="DELIVERABLE OR REASON HASH" value={jobHash} setValue={setJobHash} placeholder="bytes32" />
          <ActionGrid>
            <WriteButton disabled={!positive(jobId)} onClick={() => submitWrite(writeContractAsync, AGON_CONTRACTS.JobEscrow, agonJobEscrowAbi, "acceptJob", [BigInt(jobId)], "Job acceptance", submit)}>ACCEPT JOB</WriteButton>
            <WriteButton disabled={!positive(jobId) || !bytes32(jobHash)} onClick={() => submitWrite(writeContractAsync, AGON_CONTRACTS.JobEscrow, agonJobEscrowAbi, "submitJob", [BigInt(jobId), jobHash], "Job submission", submit)}>SUBMIT DELIVERY</WriteButton>
            <WriteButton disabled={!positive(jobId)} onClick={() => submitWrite(writeContractAsync, AGON_CONTRACTS.JobEscrow, agonJobEscrowAbi, "acceptSubmission", [BigInt(jobId)], "Delivery acceptance", submit)}>ACCEPT DELIVERY</WriteButton>
            <WriteButton disabled={!positive(jobId) || !bytes32(jobHash)} onClick={() => submitWrite(writeContractAsync, AGON_CONTRACTS.JobEscrow, agonJobEscrowAbi, "rejectSubmission", [BigInt(jobId), jobHash], "Delivery rejection", submit)}>REJECT DELIVERY</WriteButton>
            <WriteButton disabled={!positive(jobId) || !bytes32(jobHash)} onClick={() => submitWrite(writeContractAsync, AGON_CONTRACTS.JobEscrow, agonJobEscrowAbi, "openDispute", [BigInt(jobId), jobHash], "Dispute opening", submit)}>OPEN DISPUTE</WriteButton>
            <WriteButton disabled={!positive(jobId)} onClick={() => submitWrite(writeContractAsync, AGON_CONTRACTS.JobEscrow, agonJobEscrowAbi, "autoAccept", [BigInt(jobId)], "Timed auto-acceptance", submit)}>AUTO-ACCEPT</WriteButton>
            <WriteButton disabled={!positive(jobId)} onClick={() => submitWrite(writeContractAsync, AGON_CONTRACTS.JobEscrow, agonJobEscrowAbi, "failJob", [BigInt(jobId)], "Timed job refund", submit)}>REFUND TIMEOUT</WriteButton>
            <WriteButton disabled={!positive(jobId)} onClick={() => submitWrite(writeContractAsync, AGON_CONTRACTS.JobEscrow, agonJobEscrowAbi, "resolveDispute", [BigInt(jobId), true], "Provider dispute resolution", submit)}>RESOLVE TO PROVIDER</WriteButton>
            <WriteButton disabled={!positive(jobId)} onClick={() => submitWrite(writeContractAsync, AGON_CONTRACTS.JobEscrow, agonJobEscrowAbi, "resolveDispute", [BigInt(jobId), false], "Buyer dispute resolution", submit)}>RESOLVE TO BUYER</WriteButton>
          </ActionGrid>
        </ActionBlock>

        <ActionBlock title="Arena evaluator lifecycle">
          <Field label="EVALUATION ID" value={evaluationId} setValue={setEvaluationId} />
          <Field label="EVIDENCE OR RESPONSE HASH" value={arenaHash} setValue={setArenaHash} placeholder="bytes32" />
          <Field label="SCORE 0-100" value={arenaScore} setValue={setArenaScore} />
          <ActionGrid>
            <WriteButton disabled={!positive(evaluationId)} onClick={() => submitWrite(writeContractAsync, AGON_CONTRACTS.Arena, agonArenaAbi, "startEvaluation", [BigInt(evaluationId)], "Arena start", submit)}>START</WriteButton>
            <WriteButton disabled={!positive(evaluationId) || !parsedArenaHash} onClick={() => submitWrite(writeContractAsync, AGON_CONTRACTS.Arena, agonArenaAbi, "submitEvidence", [BigInt(evaluationId), parsedArenaHash], "Arena evidence submission", submit)}>SUBMIT EVIDENCE</WriteButton>
            <WriteButton disabled={!positive(evaluationId) || !parsedArenaHash || !/^\d+$/.test(arenaScore) || Number(arenaScore) > 100} onClick={() => submitWrite(writeContractAsync, AGON_CONTRACTS.Arena, agonArenaAbi, "scoreEvaluation", [BigInt(evaluationId), Number(arenaScore), parsedArenaHash], "Arena score", submit)}>SCORE</WriteButton>
            <WriteButton disabled={!positive(evaluationId)} onClick={() => submitWrite(writeContractAsync, AGON_CONTRACTS.Arena, agonArenaAbi, "expireEvaluation", [BigInt(evaluationId)], "Arena expiry", submit)}>EXPIRE</WriteButton>
          </ActionGrid>
        </ActionBlock>

        <ActionBlock title="Syndicate lifecycle">
          <Field label="NAME OR NAME HASH" value={syndicateName} setValue={setSyndicateName} />
          <Field label="CAMPAIGN OR CAMPAIGN HASH" value={campaign} setValue={setCampaign} />
          <button type="button" disabled={isPending || !confirmed || !syndicateName || !campaign} className="action" onClick={() => void submit(() => writeContractAsync({ address: AGON_CONTRACTS.SyndicateRegistry, abi: agonSyndicateRegistryAbi, functionName: "createSyndicate", args: [bytes32(syndicateName) ?? keccak256(stringToHex(syndicateName)), bytes32(campaign) ?? keccak256(stringToHex(campaign))] }), "Syndicate creation")}>CREATE SYNDICATE</button>
          <div className="grid grid-cols-2 gap-2"><Field label="SYNDICATE ID" value={syndicateId} setValue={setSyndicateId} /><Field label="ERC-8004 AGENT ID" value={agentId} setValue={setAgentId} /></div>
          <ActionGrid>
            <WriteButton disabled={!positive(syndicateId) || !positive(agentId)} onClick={() => submitWrite(writeContractAsync, AGON_CONTRACTS.SyndicateRegistry, agonSyndicateRegistryAbi, "joinSyndicate", [BigInt(syndicateId), BigInt(agentId)], "Syndicate membership", submit)}>JOIN AGENT</WriteButton>
            <WriteButton disabled={!positive(syndicateId)} onClick={() => submitWrite(writeContractAsync, AGON_CONTRACTS.SyndicateRegistry, agonSyndicateRegistryAbi, "lockRoster", [BigInt(syndicateId)], "Roster lock", submit)}>LOCK ROSTER</WriteButton>
            <WriteButton disabled={!positive(syndicateId)} onClick={() => submitWrite(writeContractAsync, AGON_CONTRACTS.SyndicateRegistry, agonSyndicateRegistryAbi, "startCompetition", [BigInt(syndicateId)], "Competition start", submit)}>START CAMPAIGN</WriteButton>
            <WriteButton disabled={!positive(syndicateId)} onClick={() => submitWrite(writeContractAsync, AGON_CONTRACTS.SyndicateRegistry, agonSyndicateRegistryAbi, "settleCampaign", [BigInt(syndicateId)], "Campaign settlement", submit)}>SETTLE CAMPAIGN</WriteButton>
          </ActionGrid>
        </ActionBlock>

        <ActionBlock title="Prize vault lifecycle">
          <Field label="POOL KEY" value={poolKey} setValue={setPoolKey} placeholder="bytes32" />
          <div className="grid grid-cols-2 gap-2"><Field label="KIND 0 ARENA / 1 SYNDICATE" value={poolKind} setValue={setPoolKind} /><Field label="SOURCE ID" value={sourceId} setValue={setSourceId} /></div>
          <div className="grid grid-cols-2 gap-2"><Field label="PRINCIPAL" value={principal} setValue={setPrincipal} /><Field label="FEE BPS" value={poolFeeBps} setValue={setPoolFeeBps} /></div>
          <p className="font-mono text-[10px] text-ink-3">SPONSOR {address ?? "CONNECT WALLET"} / APPROVAL {poolFundingTotal.toString()} BASE UNITS</p>
          <button type="button" disabled={isPending || !confirmed || poolFundingTotal === 0n} className="action" onClick={() => void submit(() => writeContractAsync({ address: USDC, abi: agonUsdcAbi, functionName: "approve", args: [AGON_CONTRACTS.PrizeVault, poolFundingTotal] }), "Prize pool USDC approval")}>1. APPROVE EXACT POOL TOTAL</button>
          <button type="button" disabled={isPending || !confirmed || !parsedPoolKey || !address || !positive(sourceId) || principalUnits === 0n || poolFeeUnits > 1000n || !/^[01]$/.test(poolKind)} className="action" onClick={() => void submit(() => writeContractAsync({ address: AGON_CONTRACTS.PrizeVault, abi: agonPrizeVaultAbi, functionName: "createPool", args: [parsedPoolKey!, Number(poolKind), BigInt(sourceId), address!, principalUnits, Number(poolFeeUnits)] }), "Prize pool funding")}>2. CREATE FUNDED POOL</button>
          <Field label="PAYOUT ROOT" value={payoutRoot} setValue={setPayoutRoot} placeholder="bytes32" />
          <div className="grid grid-cols-2 gap-2"><Field label="PAYOUT TOTAL" value={payoutTotal} setValue={setPayoutTotal} /><Field label="CLAIM DEADLINE" value={claimDeadline} setValue={setClaimDeadline} type="datetime-local" /></div>
          <ActionGrid>
            <WriteButton disabled={!parsedPoolKey || !bytes32(payoutRoot) || !positive(payoutTotal) || deadlineSeconds <= BigInt(Math.floor(Date.now() / 1000))} onClick={() => submitWrite(writeContractAsync, AGON_CONTRACTS.PrizeVault, agonPrizeVaultAbi, "publishPayoutRoot", [parsedPoolKey, payoutRoot, BigInt(payoutTotal), deadlineSeconds], "Payout root publication", submit)}>PUBLISH ROOT</WriteButton>
            <WriteButton disabled={!parsedPoolKey} onClick={() => submitWrite(writeContractAsync, AGON_CONTRACTS.PrizeVault, agonPrizeVaultAbi, "refundRemaining", [parsedPoolKey], "Prize pool refund", submit)}>REFUND REMAINING</WriteButton>
          </ActionGrid>
        </ActionBlock>
      </div>
      <style jsx>{`.action{min-height:44px;border:1px solid var(--hairline-strong);padding:0 14px;font:10px/1 monospace;letter-spacing:.12em}.action:hover:not(:disabled){border-color:var(--ink);background:var(--ink);color:var(--canvas)}.action:disabled{cursor:not-allowed;opacity:.4}`}</style>
    </section>
  );
}

function uint(value: string): bigint { return /^\d+$/.test(value) ? BigInt(value) : 0n; }
function positive(value: string): boolean { return /^[1-9]\d*$/.test(value); }
function bytes32(value: string): `0x${string}` | null { return /^0x[0-9a-fA-F]{64}$/.test(value) ? value as `0x${string}` : null; }

async function submitWrite(
  write: (args: CircleWriteArgs) => Promise<`0x${string}`>,
  address: `0x${string}`,
  abi: Abi,
  functionName: string,
  args: readonly unknown[],
  label: string,
  submit: (action: () => Promise<`0x${string}`>, label: string) => Promise<void>,
) {
  await submit(() => write({ address, abi, functionName, args }), label);
}

function WriteButton({ children, disabled, onClick }: { children: ReactNode; disabled: boolean; onClick: () => Promise<void> }) {
  return <button type="button" disabled={disabled} className="action" onClick={() => void onClick()}>{children}</button>;
}

function ActionGrid({ children }: { children: ReactNode }) { return <div className="grid grid-cols-2 gap-2">{children}</div>; }
function ActionBlock({ title, children }: { title: string; children: ReactNode }) { return <div className="border-t border-[color:var(--hairline-strong)] pt-4"><h3 className="font-mono text-[11px] uppercase tracking-[.14em]">{title}</h3><div className="mt-4 grid gap-3">{children}</div></div>; }
function Field({ label, value, setValue, placeholder, type }: { label: string; value: string; setValue: (value: string) => void; placeholder?: string; type?: string }) {
  return <label className="grid gap-1"><span className="font-mono text-[9px] uppercase tracking-[.12em] text-ink-3">{label}</span><input type={type} value={value} onChange={(event) => setValue(event.target.value)} placeholder={placeholder} className={inputClass} /></label>;
}
