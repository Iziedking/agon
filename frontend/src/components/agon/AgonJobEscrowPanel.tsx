"use client";

import { useMemo, useState } from "react";
import { decodeEventLog, parseUnits } from "viem";

import { LoginModal } from "@/components/pengu/LoginModal";
import { TagButton } from "@/components/redesign/TagButton";
import { useArcWrite } from "@/hooks/useArcWrite";
import { useAuth } from "@/hooks/useAuth";
import { agonJobEscrowAbi, agonUsdcAbi } from "@/lib/agon/abi";
import {
  getAgonJobEscrowTransaction,
  markAgonJobEscrowSubmitted,
  prepareAgonJobEscrowIntent,
  reconcileAgonJobEscrowIntent,
} from "@/lib/agon/client";
import type { AgonJobEscrowIntentView, AgonListing } from "@/lib/agon/types";
import { EXPLORER, USDC, confirmTx } from "@/lib/arc";

type Props = {
  listing: AgonListing;
  defaultAmountUSDC: string | null;
  eligible: boolean;
};

const amountPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;

export function AgonJobEscrowPanel({ listing, defaultAmountUSDC, eligible }: Props) {
  const { me } = useAuth();
  const { writeContractAsync, isPending } = useArcWrite();
  const [loginOpen, setLoginOpen] = useState(false);
  const [amountUSDC, setAmountUSDC] = useState(defaultAmountUSDC ?? "0.01");
  const [reviewHours, setReviewHours] = useState("24");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<AgonJobEscrowIntentView | null>(null);
  const [approvalHash, setApprovalHash] = useState<`0x${string}` | null>(null);
  const [transactionHash, setTransactionHash] = useState<`0x${string}` | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const amountBaseUnits = useMemo(() => {
    if (!amountPattern.test(amountUSDC)) return null;
    try {
      const value = parseUnits(amountUSDC, 6);
      return value > 0n ? value : null;
    } catch {
      return null;
    }
  }, [amountUSDC]);
  const reviewHoursNumber = /^\d+$/.test(reviewHours) ? Number(reviewHours) : 0;
  const valid = eligible && amountBaseUnits !== null && Number.isInteger(reviewHoursNumber) && reviewHoursNumber >= 1 && reviewHoursNumber <= 720;

  async function createEscrowJob() {
    if (!me) {
      setLoginOpen(true);
      return;
    }
    if (!valid || amountBaseUnits === null || confirmation !== "FUND_ARC_TESTNET_JOB") return;
    setBusy(true);
    setError(null);
    setStep("Preparing a durable, listing-scoped job intent.");
    try {
      const idempotencyKey = `market-job-${listing.listingId}-${crypto.randomUUID()}`;
      const prepared = await prepareAgonJobEscrowIntent({
        listingReference: listing.id,
        idempotencyKey,
        amountBaseUnits: amountBaseUnits.toString(),
        reviewHours: reviewHoursNumber,
        expiresAt: new Date(Date.now() + reviewHoursNumber * 60 * 60 * 1000).toISOString(),
      });
      setIntent(prepared);
      const transaction = await getAgonJobEscrowTransaction(prepared.intentId);

      setStep("Approve the exact USDC principal in your wallet.");
      const approval = await writeContractAsync({
        address: USDC,
        abi: agonUsdcAbi,
        functionName: "approve",
        args: [transaction.to, amountBaseUnits],
      });
      await confirmTx(approval);
      setApprovalHash(approval);

      setStep("Create and fund the job escrow in your wallet.");
      const hash = await writeContractAsync({
        address: transaction.to,
        abi: agonJobEscrowAbi,
        functionName: "createJob",
        args: transaction.args,
      });
      const receipt = await confirmTx(hash);
      setTransactionHash(hash);

      const createdJobId = readCreatedJobId(receipt.logs, transaction.to);
      if (!createdJobId) throw new Error("The transaction succeeded but no matching JobCreated event was found. Use the transaction link below for recovery.");
      setJobId(createdJobId);

      setStep("Recording the receipt and independently reconciling the job from Arc.");
      await markAgonJobEscrowSubmitted(prepared.intentId, { transactionHash: hash });
      const reconciled = await reconcileAgonJobEscrowIntent(prepared.intentId, createdJobId);
      setIntent(reconciled);
      setStep("Job funded and independently confirmed on Arc Testnet.");
      setConfirmation("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The escrow job could not be completed.");
      setStep(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-7 border-t border-current pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em]">ESCROW PURCHASE</div>
          <p className="mt-2 max-w-[44ch] font-mono text-[10px] leading-relaxed opacity-70">Fund a listing-scoped Agon job. USDC stays in the deployed escrow until delivery is accepted, auto-accepted, refunded, or resolved.</p>
        </div>
        <span className={`font-mono text-[10px] uppercase tracking-[0.12em] ${eligible ? "text-[color:var(--ok)]" : "text-[color:var(--err)]"}`}>{eligible ? "VERIFIED / ELIGIBLE" : "BLOCKED"}</span>
      </div>

      {!eligible ? <p className="mt-4 border-l-2 border-[color:var(--err)] pl-3 font-mono text-[10px] leading-relaxed">Escrow requires a listed, verified Escrow service with a matching manifest anchor.</p> : <>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="font-mono text-[9px] uppercase tracking-[0.12em] opacity-65">PRINCIPAL / USDC<input value={amountUSDC} onChange={(event) => setAmountUSDC(event.target.value)} inputMode="decimal" className="mt-2 h-10 w-full border border-current bg-transparent px-3 font-mono text-[11px] text-current" /></label>
          <label className="font-mono text-[9px] uppercase tracking-[0.12em] opacity-65">REVIEW WINDOW / HOURS<input value={reviewHours} onChange={(event) => setReviewHours(event.target.value)} inputMode="numeric" className="mt-2 h-10 w-full border border-current bg-transparent px-3 font-mono text-[11px] text-current" /></label>
        </div>
        <dl className="mt-4 grid gap-px bg-current/20 sm:grid-cols-2">
          <Fact label="PROVIDER" value={listing.providerSnapshot} />
          <Fact label="LISTING VERSION" value={`${listing.listingId} / ${listing.version}`} />
          <Fact label="PLATFORM FEE" value="0 USDC" />
          <Fact label="TOTAL APPROVAL" value={amountBaseUnits === null ? "INVALID AMOUNT" : `${amountUSDC} USDC / ${amountBaseUnits} BASE UNITS`} />
        </dl>
        <label className="mt-4 block font-mono text-[9px] uppercase tracking-[0.1em] opacity-70">TYPE TO CONFIRM<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="FUND_ARC_TESTNET_JOB" autoComplete="off" spellCheck={false} className="mt-2 h-10 w-full border border-current bg-transparent px-3 font-mono text-[10px] text-current placeholder:opacity-40" /></label>
        <p className="mt-2 font-mono text-[9px] leading-relaxed opacity-60">Two wallet confirmations are required: exact USDC approval, then createJob. A successful transaction is independently read from the deployed contract before this UI reports completion.</p>
        <TagButton variant="primary" size="sm" className="mt-3" onClick={() => void createEscrowJob()} disabled={busy || isPending || !valid || confirmation !== "FUND_ARC_TESTNET_JOB"}>{busy || isPending ? "PROCESSING ESCROW..." : me ? "APPROVE AND FUND JOB" : "SIGN IN TO FUND"}</TagButton>
      </>}

      {step ? <p role="status" className="mt-4 border-l-2 border-[color:var(--ok)] pl-3 font-mono text-[10px] leading-relaxed text-[color:var(--ok)]">{step}</p> : null}
      {error ? <p role="alert" className="mt-4 border-l-2 border-[color:var(--err)] pl-3 font-mono text-[10px] leading-relaxed text-[color:var(--err)]">{error}</p> : null}
      {intent ? <div className="mt-4 space-y-1 border-t border-current pt-3 font-mono text-[10px] leading-relaxed"><div className="break-all">INTENT / {intent.intentId}</div><div>STATE / {intent.state.replaceAll("_", " ").toUpperCase()}</div><div className="break-all">TERMS / {intent.termsHash}</div>{jobId ? <div>JOB ID / {jobId}</div> : null}{approvalHash ? <a className="block break-all underline" href={`${EXPLORER}/tx/${approvalHash}`} target="_blank" rel="noreferrer">USDC APPROVAL / {approvalHash}</a> : null}{transactionHash ? <a className="block break-all underline" href={`${EXPLORER}/tx/${transactionHash}`} target="_blank" rel="noreferrer">JOB TRANSACTION / {transactionHash}</a> : null}</div> : null}
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  );
}

function readCreatedJobId(logs: readonly { address: `0x${string}`; data: `0x${string}`; topics: readonly `0x${string}`[] }[], escrow: `0x${string}`): string | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== escrow.toLowerCase()) continue;
    if (!log.topics[0]) continue;
    try {
      const decoded = decodeEventLog({ abi: agonJobEscrowAbi, data: log.data, topics: [...log.topics] as [`0x${string}`, ...`0x${string}`[]] });
      if (decoded.eventName === "JobCreated" && "jobId" in decoded.args) return decoded.args.jobId.toString();
    } catch {
      // Other escrow events and unrelated logs are expected in the receipt.
    }
  }
  return null;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 bg-black/10 p-3"><dt className="font-mono text-[8px] uppercase tracking-[0.12em] opacity-60">{label}</dt><dd className="mt-1 break-all font-mono text-[10px] leading-relaxed">{value}</dd></div>;
}
