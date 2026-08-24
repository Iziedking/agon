"use client";

import { useState, type ReactNode } from "react";
import { keccak256, stringToHex } from "viem";

import { useArcWrite } from "@/hooks/useArcWrite";
import { AGON_CONTRACTS, USDC, confirmTx } from "@/lib/arc";
import { agonArenaAbi, agonJobEscrowAbi, agonPrizeVaultAbi, agonSyndicateRegistryAbi, agonUsdcAbi } from "@/lib/agon/abi";

const inputClass = "h-11 w-full border border-[color:var(--hairline-strong)] bg-canvas-2 px-3 font-mono text-xs outline-none focus:border-ink";

export function ProtocolActions() {
  const { writeContractAsync, isPending } = useArcWrite();
  const [listingId, setListingId] = useState("");
  const [clientReference, setClientReference] = useState("");
  const [amount, setAmount] = useState("");
  const [feeBps, setFeeBps] = useState("0");
  const [reviewHours, setReviewHours] = useState("24");
  const [termsHash, setTermsHash] = useState("");
  const [arenaListingId, setArenaListingId] = useState("");
  const [arenaRequestHash, setArenaRequestHash] = useState("");
  const [capabilityHash, setCapabilityHash] = useState("");
  const [taskCommitment, setTaskCommitment] = useState("");
  const [syndicateId, setSyndicateId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [poolKey, setPoolKey] = useState("");
  const [claimIndex, setClaimIndex] = useState("");
  const [claimBeneficiary, setClaimBeneficiary] = useState("");
  const [claimAmount, setClaimAmount] = useState("");
  const [claimProof, setClaimProof] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(action: () => Promise<`0x${string}`>, label: string) {
    setNotice(null);
    setError(null);
    try {
      const hash = await action();
      await confirmTx(hash);
      setNotice(`${label} confirmed: ${hash}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${label} failed.`);
    }
  }

  const amountUnits = parseUint(amount);
  const feeUnits = parseUint(feeBps);
  const reviewUnits = parseUint(reviewHours);
  const parsedTerms = /^0x[0-9a-fA-F]{64}$/.test(termsHash) ? termsHash as `0x${string}` : keccak256(stringToHex("review in Agon protocol console"));
  const parsedClientReference = /^0x[0-9a-fA-F]{64}$/.test(clientReference)
    ? clientReference as `0x${string}`
    : keccak256(stringToHex(`agon-job:${listingId}:${parsedTerms}:${amount}:${feeBps}:${reviewHours}`));

  return <section className="mt-12 border border-[color:var(--hairline-strong)] bg-canvas-2 p-5 sm:p-7">
    <p className="font-mono text-[10px] uppercase tracking-[.16em] text-accent">CONNECTED WALLET ACTIONS</p>
    <h2 className="mt-3 font-stencil text-4xl uppercase leading-none">Move a real testnet state.</h2>
    <p className="mt-4 max-w-2xl font-mono text-xs leading-6 text-ink-2">These actions are deliberately explicit. The wallet signs each transaction, the UI waits for a successful receipt, and the resulting hash stays visible for the demo.</p>
    {notice ? <p role="status" className="mt-5 border-l-2 border-accent p-3 font-mono text-xs leading-6">{notice}</p> : null}
    {error ? <p role="alert" className="mt-5 border-l-2 border-[color:var(--err)] p-3 font-mono text-xs leading-6 text-[color:var(--err)]">{error}</p> : null}
    <div className="mt-8 grid gap-8 lg:grid-cols-3">
      <ActionBlock title="Fund an escrow job">
        <Field label="LISTING ID" value={listingId} setValue={setListingId} />
        <Field label="CLIENT REFERENCE" value={clientReference} setValue={setClientReference} placeholder="0x... optional, stable across retries" />
        <Field label="TERMS HASH" value={termsHash} setValue={setTermsHash} placeholder="0x... optional" />
        <Field label="AMOUNT / BASE UNITS" value={amount} setValue={setAmount} />
        <div className="grid grid-cols-2 gap-2"><Field label="FEE BPS" value={feeBps} setValue={setFeeBps} /><Field label="REVIEW HOURS" value={reviewHours} setValue={setReviewHours} /></div>
        <button type="button" disabled={isPending || !amount} className="action" onClick={() => void submit(() => writeContractAsync({ address: USDC, abi: agonUsdcAbi, functionName: "approve", args: [AGON_CONTRACTS.JobEscrow, amountUnits] }), "USDC approval")}>1. APPROVE USDC</button>
        <button type="button" disabled={isPending || !isUint(listingId) || !isUint(amount) || amountUnits === 0n || feeUnits > 1000n || reviewUnits > 720n} className="action" onClick={() => void submit(() => writeContractAsync({ address: AGON_CONTRACTS.JobEscrow, abi: agonJobEscrowAbi, functionName: "createJob", args: [parsedClientReference, BigInt(listingId), parsedTerms, amountUnits, Number(feeUnits), reviewUnits] }), "Escrow job creation")}>2. CREATE JOB</button>
      </ActionBlock>
      <ActionBlock title="Request Arena evaluation">
        <Field label="LISTING ID" value={arenaListingId} setValue={setArenaListingId} />
        <Field label="VALIDATION REQUEST HASH" value={arenaRequestHash} setValue={setArenaRequestHash} placeholder="0x..." />
        <Field label="CAPABILITY HASH" value={capabilityHash} setValue={setCapabilityHash} placeholder="0x..." />
        <Field label="TASK COMMITMENT" value={taskCommitment} setValue={setTaskCommitment} placeholder="0x... optional" />
        <button type="button" disabled={isPending || !isUint(arenaListingId)} className="action" onClick={() => void submit(() => writeContractAsync({ address: AGON_CONTRACTS.Arena, abi: agonArenaAbi, functionName: "requestEvaluation", args: [arenaRequestHash.match(/^0x[0-9a-fA-F]{64}$/) ? arenaRequestHash as `0x${string}` : keccak256(stringToHex(`request:${arenaListingId}`)), BigInt(arenaListingId), capabilityHash.match(/^0x[0-9a-fA-F]{64}$/) ? capabilityHash as `0x${string}` : keccak256(stringToHex(`capability:${arenaListingId}`)), keccak256(stringToHex("agon-evaluator-v1")), taskCommitment.match(/^0x[0-9a-fA-F]{64}$/) ? taskCommitment as `0x${string}` : keccak256(stringToHex(`task:${arenaListingId}`)), BigInt(Math.floor(Date.now() / 1000) + 7 * 86400)] }), "Arena evaluation request")}>REQUEST EVALUATION</button>
      </ActionBlock>
      <ActionBlock title="Join a syndicate">
        <Field label="SYNDICATE ID" value={syndicateId} setValue={setSyndicateId} />
        <Field label="ERC-8004 AGENT ID" value={agentId} setValue={setAgentId} />
        <button type="button" disabled={isPending || !isUint(syndicateId) || !isUint(agentId)} className="action" onClick={() => void submit(() => writeContractAsync({ address: AGON_CONTRACTS.SyndicateRegistry, abi: agonSyndicateRegistryAbi, functionName: "joinSyndicate", args: [BigInt(syndicateId), BigInt(agentId)] }), "Syndicate membership")}>JOIN SYNDICATE</button>
      </ActionBlock>
      <ActionBlock title="Claim a prize">
        <Field label="POOL KEY" value={poolKey} setValue={setPoolKey} placeholder="0x..." />
        <div className="grid grid-cols-2 gap-2"><Field label="LEAF INDEX" value={claimIndex} setValue={setClaimIndex} /><Field label="AMOUNT" value={claimAmount} setValue={setClaimAmount} /></div>
        <Field label="BENEFICIARY" value={claimBeneficiary} setValue={setClaimBeneficiary} />
        <Field label="PROOF" value={claimProof} setValue={setClaimProof} placeholder="comma-separated bytes32 values, or empty" />
        <button type="button" disabled={isPending || !/^0x[0-9a-fA-F]{64}$/.test(poolKey) || !/^0x[0-9a-fA-F]{40}$/.test(claimBeneficiary) || !isUint(claimIndex) || !isUint(claimAmount) || claimAmount === "0"} className="action" onClick={() => void submit(() => writeContractAsync({ address: AGON_CONTRACTS.PrizeVault, abi: agonPrizeVaultAbi, functionName: "claim", args: [poolKey as `0x${string}`, BigInt(claimIndex), claimBeneficiary as `0x${string}`, BigInt(claimAmount), claimProof.split(",").map((item) => item.trim()).filter(Boolean) as `0x${string}`[]] }), "Prize claim")}>CLAIM PRIZE</button>
      </ActionBlock>
    </div>
  </section>;
}

function parseUint(value: string): bigint {
  return /^\d+$/.test(value) ? BigInt(value) : 0n;
}

function isUint(value: string): boolean {
  return /^\d+$/.test(value);
}

function ActionBlock({ title, children }: { title: string; children: ReactNode }) {
  return <div className="border-t border-[color:var(--hairline-strong)] pt-4"><h3 className="font-mono text-[11px] uppercase tracking-[.14em]">{title}</h3><div className="mt-4 grid gap-3">{children}</div></div>;
}

function Field({ label, value, setValue, placeholder }: { label: string; value: string; setValue: (value: string) => void; placeholder?: string }) {
  return <label className="grid gap-1"><span className="font-mono text-[9px] uppercase tracking-[.12em] text-ink-3">{label}</span><input value={value} onChange={(event) => setValue(event.target.value)} placeholder={placeholder} className={inputClass} /></label>;
}
