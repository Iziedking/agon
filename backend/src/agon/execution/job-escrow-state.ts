import { keccak256, stringToHex } from "viem";
import { canonicalizeManifest } from "../core/manifest.ts";
import type { AgonJobEscrowJob } from "./agon-job-escrow.ts";

export type AgonJobEscrowIntentState =
  | "prepared"
  | "submitted"
  | "unknown"
  | "created"
  | "accepted"
  | "job_submitted"
  | "complete"
  | "rejected"
  | "disputed"
  | "failed";

export type AgonJobEscrowSettlement = "none" | "provider_paid" | "buyer_refunded";

export type AgonJobEscrowIntent = {
  intentId: string;
  idempotencyKey: string;
  actor: `0x${string}`;
  buyer: `0x${string}`;
  provider: `0x${string}`;
  listingReference: string;
  network: "eip155:5042002";
  asset: `0x${string}`;
  escrowContract: `0x${string}`;
  serviceRegistry: `0x${string}`;
  listingId: string;
  agentId: string;
  listingVersion: string;
  manifestHash: `0x${string}`;
  termsHash: `0x${string}`;
  amountBaseUnits: bigint;
  feeBps: number;
  reviewHours: number;
  expiresAt: Date;
  clientReference: `0x${string}`;
  state: AgonJobEscrowIntentState;
  settlement: AgonJobEscrowSettlement;
  onchainJobId: string | null;
  transactionHash: `0x${string}` | null;
  deliverableHash: `0x${string}` | null;
  reasonHash: `0x${string}` | null;
  lastReconciledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AgonJobEscrowIntentMatch = Pick<AgonJobEscrowIntent,
  "buyer" | "provider" | "listingId" | "agentId" | "listingVersion" | "manifestHash" | "termsHash" | "amountBaseUnits" | "feeBps" | "reviewHours">;

const STATUS_TO_STATE: Record<number, Exclude<AgonJobEscrowIntentState, "prepared" | "submitted" | "unknown">> = {
  0: "created",
  1: "accepted",
  2: "job_submitted",
  3: "complete",
  4: "rejected",
  5: "disputed",
  6: "failed",
};

const SETTLEMENTS: Record<number, AgonJobEscrowSettlement> = {
  0: "none",
  1: "provider_paid",
  2: "buyer_refunded",
};

export function hashAgonJobEscrowTerms(input: {
  network: "eip155:5042002";
  asset: string;
  buyer: string;
  provider: string;
  escrowContract: string;
  serviceRegistry: string;
  listingId: string;
  agentId: string;
  listingVersion: string;
  manifestHash: string;
  amountBaseUnits: bigint;
  feeBps: number;
  reviewHours: number;
  expiresAt: Date;
}): `0x${string}` {
  return keccak256(stringToHex(canonicalizeManifest({
    ...input,
    buyer: input.buyer.toLowerCase(),
    provider: input.provider.toLowerCase(),
    escrowContract: input.escrowContract.toLowerCase(),
    serviceRegistry: input.serviceRegistry.toLowerCase(),
    manifestHash: input.manifestHash.toLowerCase(),
    amountBaseUnits: input.amountBaseUnits.toString(),
    expiresAt: input.expiresAt.toISOString(),
  })));
}

export function clientReferenceForJobEscrow(idempotencyKey: string): `0x${string}` {
  return keccak256(stringToHex(`agon-job-escrow:${idempotencyKey}`));
}

export function stateForAgonJobStatus(status: number): AgonJobEscrowIntentState {
  const state = STATUS_TO_STATE[status];
  if (!state) throw new Error("AgonJobEscrow returned an unknown job status");
  return state;
}

export function settlementForAgonJobStatus(settlement: number): AgonJobEscrowSettlement {
  const value = SETTLEMENTS[settlement];
  if (!value) throw new Error("AgonJobEscrow returned an unknown settlement status");
  return value;
}

export function isAgonJobEscrowTransitionAllowed(
  from: AgonJobEscrowIntentState,
  to: AgonJobEscrowIntentState,
): boolean {
  const allowed: Record<AgonJobEscrowIntentState, readonly AgonJobEscrowIntentState[]> = {
    prepared: ["prepared", "submitted", "unknown", "created", "accepted", "job_submitted", "complete", "rejected", "disputed", "failed"],
    submitted: ["submitted", "unknown", "created", "accepted", "job_submitted", "complete", "rejected", "disputed", "failed"],
    unknown: ["unknown", "created", "accepted", "job_submitted", "complete", "rejected", "disputed", "failed"],
    created: ["created", "accepted", "job_submitted", "complete", "rejected", "disputed", "failed"],
    accepted: ["accepted", "job_submitted", "complete", "rejected", "disputed", "failed"],
    job_submitted: ["job_submitted", "complete", "rejected", "disputed", "failed"],
    complete: ["complete"],
    rejected: ["rejected"],
    disputed: ["disputed", "complete", "rejected"],
    failed: ["failed"],
  };
  return allowed[from].includes(to);
}

export function validateAgonJobEscrowJobMatch(
  intent: AgonJobEscrowIntentMatch,
  job: AgonJobEscrowJob,
): { ok: true } | { ok: false; message: string } {
  const checks: Array<[boolean, string]> = [
    [job.buyer.toLowerCase() === intent.buyer.toLowerCase(), "buyer does not match the prepared intent"],
    [job.provider.toLowerCase() === intent.provider.toLowerCase(), "provider does not match the pinned listing owner"],
    [job.listingId === intent.listingId, "listing id does not match the prepared intent"],
    [job.agentId === intent.agentId, "agent id does not match the prepared intent"],
    [job.listingVersion === intent.listingVersion, "listing version does not match the prepared intent"],
    [job.manifestHash.toLowerCase() === intent.manifestHash.toLowerCase(), "manifest hash does not match the prepared intent"],
    [job.termsHash.toLowerCase() === intent.termsHash.toLowerCase(), "terms hash does not match the prepared intent"],
    [job.amount === intent.amountBaseUnits.toString(), "amount does not match the prepared intent"],
    [job.feeBps === undefined || job.feeBps === intent.feeBps, "fee rate does not match the prepared intent"],
    [job.fee === ((intent.amountBaseUnits * BigInt(intent.feeBps)) / 10_000n).toString(), "fee does not match the prepared intent"],
    [job.reviewHours === intent.reviewHours, "review hours do not match the prepared intent"],
  ];
  const failed = checks.find(([matches]) => !matches);
  return failed ? { ok: false, message: failed[1] } : { ok: true };
}
