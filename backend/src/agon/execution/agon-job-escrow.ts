import { getAddress, keccak256, stringToHex, toHex, encodeFunctionData } from "viem";
import { AGON_ESCROW_NETWORK, AGON_ESCROW_PROTOCOL_FEE_BPS, AGON_ESCROW_USDC } from "../escrow-policy.ts";

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const NON_NEGATIVE_INTEGER = /^(0|[1-9]\d*)$/;

export const AGON_JOB_ESCROW_NETWORK = AGON_ESCROW_NETWORK;
export const AGON_JOB_ESCROW_CHAIN_ID = 5042002;

/** ABI pin for the deployed AgonJobEscrow contract. This module has no signer. */
export const AGON_JOB_ESCROW_ABI = [
  { type: "function", name: "createJob", stateMutability: "nonpayable", inputs: [
    { name: "clientReference", type: "bytes32" }, { name: "listingId", type: "uint256" },
    { name: "termsHash", type: "bytes32" }, { name: "amount", type: "uint256" },
    { name: "reviewHours", type: "uint64" },
  ], outputs: [{ name: "jobId", type: "uint256" }] },
  { type: "function", name: "acceptJob", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }], outputs: [] },
  { type: "function", name: "submitJob", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "deliverableHash", type: "bytes32" }], outputs: [] },
  { type: "function", name: "acceptSubmission", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }], outputs: [] },
  { type: "function", name: "autoAccept", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }], outputs: [] },
  { type: "function", name: "rejectSubmission", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "reasonHash", type: "bytes32" }], outputs: [] },
  { type: "function", name: "openDispute", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "reasonHash", type: "bytes32" }], outputs: [] },
  { type: "function", name: "resolveDispute", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "payProvider", type: "bool" }], outputs: [] },
  { type: "function", name: "failJob", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }], outputs: [] },
  { type: "function", name: "usdc", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "serviceRegistry", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "disputeResolver", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "getJob", stateMutability: "view", inputs: [{ name: "jobId", type: "uint256" }], outputs: [{ name: "job", type: "tuple", components: [
    { name: "jobId", type: "uint256" }, { name: "buyer", type: "address" }, { name: "provider", type: "address" },
    { name: "listingId", type: "uint256" }, { name: "agentId", type: "uint256" }, { name: "listingVersion", type: "uint256" },
    { name: "manifestHash", type: "bytes32" }, { name: "termsHash", type: "bytes32" }, { name: "deliverableHash", type: "bytes32" },
    { name: "amount", type: "uint256" }, { name: "fee", type: "uint256" }, { name: "reviewHours", type: "uint64" },
    { name: "acceptanceDeadline", type: "uint64" }, { name: "reviewDeadline", type: "uint64" }, { name: "createdAt", type: "uint64" },
    { name: "submittedAt", type: "uint64" }, { name: "status", type: "uint8" }, { name: "settlement", type: "uint8" },
  ] }] },
] as const;

/** Read ABI for the separately deployable V2 escrow. V2 adds feeBps to the
 * returned job tuple while preserving the legacy lifecycle view functions. */
export const AGON_JOB_ESCROW_V2_READ_ABI = [
  { type: "function", name: "usdc", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "serviceRegistry", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "disputeResolver", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "getJob", stateMutability: "view", inputs: [{ name: "jobId", type: "uint256" }], outputs: [{ name: "job", type: "tuple", components: [
    { name: "jobId", type: "uint256" }, { name: "buyer", type: "address" }, { name: "provider", type: "address" },
    { name: "listingId", type: "uint256" }, { name: "agentId", type: "uint256" }, { name: "listingVersion", type: "uint256" },
    { name: "manifestHash", type: "bytes32" }, { name: "termsHash", type: "bytes32" }, { name: "deliverableHash", type: "bytes32" },
    { name: "amount", type: "uint256" }, { name: "fee", type: "uint256" }, { name: "feeBps", type: "uint16" },
    { name: "reviewHours", type: "uint64" }, { name: "acceptanceDeadline", type: "uint64" }, { name: "reviewDeadline", type: "uint64" },
    { name: "createdAt", type: "uint64" }, { name: "submittedAt", type: "uint64" }, { name: "status", type: "uint8" },
    { name: "settlement", type: "uint8" },
  ] }] },
] as const;

export type AgonJobEscrowContractVersion = "v1" | "v2";
type AgonJobEscrowReadAbi = typeof AGON_JOB_ESCROW_ABI | typeof AGON_JOB_ESCROW_V2_READ_ABI;

export type AgonJobEscrowAction =
  | "create"
  | "accept"
  | "submit"
  | "accept_submission"
  | "auto_accept"
  | "reject"
  | "dispute"
  | "resolve_pay"
  | "resolve_refund"
  | "fail";

export type AgonJobEscrowWritePlan = {
  network: typeof AGON_JOB_ESCROW_NETWORK;
  chainId: typeof AGON_JOB_ESCROW_CHAIN_ID;
  contractAddress: `0x${string}`;
  action: AgonJobEscrowAction;
  functionName: string;
  args: readonly unknown[];
  data: `0x${string}`;
  execution: "disabled";
};

export type AgonJobEscrowJob = {
  jobId: string;
  buyer: `0x${string}`;
  provider: `0x${string}`;
  listingId: string;
  agentId: string;
  listingVersion: string;
  manifestHash: `0x${string}`;
  termsHash: `0x${string}`;
  deliverableHash: `0x${string}`;
  amount: string;
  fee: string;
  /** Present for V2 reads; omitted for legacy V1 jobs. */
  feeBps?: number;
  reviewHours: number;
  acceptanceDeadline: Date;
  reviewDeadline: Date | null;
  createdAt: Date;
  submittedAt: Date | null;
  status: number;
  settlement: number;
};

export type AgonJobEscrowReceipt = {
  status: "success" | "reverted" | 1 | 0;
  transactionHash?: string | null;
  to?: string | null;
  logs?: readonly { address?: string; topics?: readonly string[] }[];
};

export type AgonJobEscrowReceiptResult =
  | { ok: true; transactionHash: `0x${string}`; event: string }
  | { ok: false; code: "receipt_invalid" | "receipt_reverted" | "receipt_unknown"; message: string };

function address(value: unknown, label: string): `0x${string}` {
  if (typeof value !== "string" || !ADDRESS.test(value)) throw new Error(`${label} is invalid`);
  try { return getAddress(value).toLowerCase() as `0x${string}`; } catch { throw new Error(`${label} is invalid`); }
}

function hash(value: unknown, label: string): `0x${string}` {
  if (typeof value !== "string" || !HASH.test(value) || /^0x0{64}$/i.test(value)) throw new Error(`${label} must be a non-zero bytes32`);
  return value.toLowerCase() as `0x${string}`;
}

function integer(value: string | bigint, label: string): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) throw new Error(`${label} must be a non-negative integer`);
    return value;
  }
  if (!NON_NEGATIVE_INTEGER.test(value)) throw new Error(`${label} must be a non-negative integer`);
  return BigInt(value);
}

function jobId(value: string | bigint): bigint {
  const result = integer(value, "job id");
  if (result === 0n) throw new Error("job id must be positive");
  return result;
}

function plan(input: {
  contractAddress: string;
  action: AgonJobEscrowAction;
  functionName: string;
  args: readonly unknown[];
}): AgonJobEscrowWritePlan {
  const contractAddress = address(input.contractAddress, "AgonJobEscrow contract address");
  const data = encodeFunctionData({ abi: AGON_JOB_ESCROW_ABI, functionName: input.functionName as never, args: input.args as never });
  return { network: AGON_JOB_ESCROW_NETWORK, chainId: AGON_JOB_ESCROW_CHAIN_ID, contractAddress, action: input.action, functionName: input.functionName, args: input.args, data, execution: "disabled" };
}

export function buildAgonJobEscrowWritePlan(input: {
  contractAddress: string;
  action: AgonJobEscrowAction;
  clientReference?: string;
  listingId?: string | bigint;
  termsHash?: string;
  amountBaseUnits?: string | bigint;
  /** @deprecated The protocol fee is fixed and is not encoded in createJob. */
  feeBps?: number;
  reviewHours?: number;
  jobId?: string | bigint;
  deliverableHash?: string;
  reasonHash?: string;
}): AgonJobEscrowWritePlan {
  if (input.action === "create") {
    const clientReference = hash(input.clientReference, "client reference");
    const listingId = integer(input.listingId ?? "", "listing id");
    if (listingId === 0n) throw new Error("listing id must be positive");
    const termsHash = hash(input.termsHash, "terms hash");
    const amount = integer(input.amountBaseUnits ?? "", "amount");
    if (amount === 0n) throw new Error("amount must be positive");
    if (input.feeBps !== undefined && input.feeBps !== AGON_ESCROW_PROTOCOL_FEE_BPS) throw new Error(`fee bps is fixed at ${AGON_ESCROW_PROTOCOL_FEE_BPS}`);
    if (!Number.isInteger(input.reviewHours) || (input.reviewHours ?? 0) < 0 || (input.reviewHours ?? 721) > 720) throw new Error("review hours must be between 0 and 720");
    return plan({ contractAddress: input.contractAddress, action: input.action, functionName: "createJob", args: [clientReference, listingId, termsHash, amount, input.reviewHours] });
  }

  const id = jobId(input.jobId ?? "");
  if (input.action === "accept") return plan({ contractAddress: input.contractAddress, action: input.action, functionName: "acceptJob", args: [id] });
  if (input.action === "submit") return plan({ contractAddress: input.contractAddress, action: input.action, functionName: "submitJob", args: [id, hash(input.deliverableHash, "deliverable hash")] });
  if (input.action === "accept_submission") return plan({ contractAddress: input.contractAddress, action: input.action, functionName: "acceptSubmission", args: [id] });
  if (input.action === "auto_accept") return plan({ contractAddress: input.contractAddress, action: input.action, functionName: "autoAccept", args: [id] });
  if (input.action === "reject") return plan({ contractAddress: input.contractAddress, action: input.action, functionName: "rejectSubmission", args: [id, hash(input.reasonHash, "reason hash")] });
  if (input.action === "dispute") return plan({ contractAddress: input.contractAddress, action: input.action, functionName: "openDispute", args: [id, hash(input.reasonHash, "reason hash")] });
  if (input.action === "resolve_pay") return plan({ contractAddress: input.contractAddress, action: input.action, functionName: "resolveDispute", args: [id, true] });
  if (input.action === "resolve_refund") return plan({ contractAddress: input.contractAddress, action: input.action, functionName: "resolveDispute", args: [id, false] });
  return plan({ contractAddress: input.contractAddress, action: input.action, functionName: "failJob", args: [id] });
}

function topic(signature: string): `0x${string}` { return keccak256(stringToHex(signature)); }
const EVENTS: Record<AgonJobEscrowAction, { name: string; topic: `0x${string}`; indexedJob: boolean }> = {
  create: { name: "JobCreated", topic: topic("JobCreated(uint256,bytes32,address,address,uint256,uint256,uint256,bytes32,bytes32,uint256,uint256,uint64,uint64)"), indexedJob: true },
  accept: { name: "JobAccepted", topic: topic("JobAccepted(uint256,address)"), indexedJob: true },
  submit: { name: "JobSubmitted", topic: topic("JobSubmitted(uint256,bytes32,uint64)"), indexedJob: true },
  accept_submission: { name: "JobSettled", topic: topic("JobSettled(uint256,uint8,address,uint256,uint256)"), indexedJob: true },
  auto_accept: { name: "JobSettled", topic: topic("JobSettled(uint256,uint8,address,uint256,uint256)"), indexedJob: true },
  reject: { name: "JobRejected", topic: topic("JobRejected(uint256,bytes32)"), indexedJob: true },
  dispute: { name: "JobDisputed", topic: topic("JobDisputed(uint256,address,bytes32)"), indexedJob: true },
  resolve_pay: { name: "JobSettled", topic: topic("JobSettled(uint256,uint8,address,uint256,uint256)"), indexedJob: true },
  resolve_refund: { name: "JobSettled", topic: topic("JobSettled(uint256,uint8,address,uint256,uint256)"), indexedJob: true },
  fail: { name: "JobFailed", topic: topic("JobFailed(uint256,address,uint8)"), indexedJob: true },
};

export function validateAgonJobEscrowReceipt(input: {
  receipt: AgonJobEscrowReceipt;
  contractAddress: string;
  action: AgonJobEscrowAction;
  transactionHash: string;
  jobId?: string | bigint;
  contractVersion?: AgonJobEscrowContractVersion;
}): AgonJobEscrowReceiptResult {
  const expectedContract = address(input.contractAddress, "AgonJobEscrow contract address");
  const expectedHash = hash(input.transactionHash, "transaction hash");
  if (input.receipt.status === "reverted" || input.receipt.status === 0) return { ok: false, code: "receipt_reverted", message: "AgonJobEscrow transaction reverted" };
  if (input.receipt.status !== "success" && input.receipt.status !== 1) return { ok: false, code: "receipt_unknown", message: "receipt did not prove a successful AgonJobEscrow transaction" };
  if (!input.receipt.transactionHash || hash(input.receipt.transactionHash, "receipt transaction hash") !== expectedHash) return { ok: false, code: "receipt_invalid", message: "receipt hash does not match the submitted transaction" };
  if (!input.receipt.to || address(input.receipt.to, "receipt contract address") !== expectedContract) return { ok: false, code: "receipt_invalid", message: "receipt is not for the configured AgonJobEscrow contract" };
  const expectedEvent = input.contractVersion === "v2" && input.action === "create"
    ? { name: "JobCreated", topic: topic("JobCreated(uint256,bytes32,address,address,uint256,uint256,uint256,bytes32,bytes32,uint256,uint256,uint16,uint64,uint64)") }
    : EVENTS[input.action];
  const expectedJobTopic = input.action === "create" ? null : toHex(jobId(input.jobId ?? ""), { size: 32 }).toLowerCase();
  const found = (input.receipt.logs ?? []).some((log) => {
    if (!log.address || address(log.address, "receipt log address") !== expectedContract) return false;
    if (!log.topics?.[0] || log.topics[0].toLowerCase() !== expectedEvent.topic.toLowerCase()) return false;
    return expectedJobTopic === null || log.topics[1]?.toLowerCase() === expectedJobTopic;
  });
  if (!found) return { ok: false, code: "receipt_invalid", message: `receipt did not contain the expected ${expectedEvent.name} event` };
  return { ok: true, transactionHash: expectedHash, event: expectedEvent.name };
}

export type AgonJobEscrowReadClient = {
  getBytecode(input: { address: `0x${string}` }): Promise<unknown>;
  readContract(input: { address: `0x${string}`; abi: AgonJobEscrowReadAbi; functionName: "usdc" | "serviceRegistry" | "disputeResolver" | "getJob"; args?: readonly unknown[] }): Promise<unknown>;
};

export type AgonJobEscrowReadAdapter = {
  readonly enabled: boolean;
  inspect(jobId: string | bigint): Promise<AgonJobEscrowJob>;
};

function normalizeJob(value: unknown): AgonJobEscrowJob {
  const record = value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const hasFeeBps = Array.isArray(value) ? value.length >= 19 : record?.feeBps !== undefined;
  const values = Array.isArray(value) ? value : record ? [
    record.jobId, record.buyer, record.provider, record.listingId, record.agentId,
    record.listingVersion, record.manifestHash, record.termsHash, record.deliverableHash,
    record.amount, record.fee, ...(hasFeeBps ? [record.feeBps] : []), record.reviewHours, record.acceptanceDeadline, record.reviewDeadline,
    record.createdAt, record.submittedAt, record.status, record.settlement,
  ] : [];
  if (values.length < 18) throw new Error("AgonJobEscrow returned an invalid job tuple");
  const buyer = address(values[1], "job buyer");
  const provider = address(values[2], "job provider");
  const manifestHash = hash(values[6], "job manifest hash");
  const termsHash = hash(values[7], "job terms hash");
  const deliverableHash: `0x${string}` = typeof values[8] === "string" && HASH.test(values[8]) ? values[8].toLowerCase() as `0x${string}` : `0x${"0".repeat(64)}`;
  const timestamp = (raw: unknown, label: string) => { const n = Number(raw); if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${label} is invalid`); return n; };
  const reviewHoursIndex = hasFeeBps ? 12 : 11;
  const acceptanceDeadlineIndex = hasFeeBps ? 13 : 12;
  const reviewDeadlineIndex = hasFeeBps ? 14 : 13;
  const createdAtIndex = hasFeeBps ? 15 : 14;
  const submittedAtIndex = hasFeeBps ? 16 : 15;
  const statusIndex = hasFeeBps ? 17 : 16;
  const settlementIndex = hasFeeBps ? 18 : 17;
  const reviewDeadline = timestamp(values[reviewDeadlineIndex], "review deadline");
  const submittedAt = timestamp(values[submittedAtIndex], "submitted timestamp");
  return {
    jobId: integer(String(values[0]), "job id").toString(), buyer, provider,
    listingId: integer(String(values[3]), "listing id").toString(), agentId: integer(String(values[4]), "agent id").toString(),
    listingVersion: integer(String(values[5]), "listing version").toString(), manifestHash, termsHash, deliverableHash,
    amount: integer(String(values[9]), "job amount").toString(), fee: integer(String(values[10]), "job fee").toString(),
    ...(hasFeeBps ? { feeBps: timestamp(values[11], "job fee bps") } : {}),
    reviewHours: timestamp(values[reviewHoursIndex], "review hours"), acceptanceDeadline: new Date(timestamp(values[acceptanceDeadlineIndex], "acceptance deadline") * 1000),
    reviewDeadline: reviewDeadline === 0 ? null : new Date(reviewDeadline * 1000), createdAt: new Date(timestamp(values[createdAtIndex], "created timestamp") * 1000),
    submittedAt: submittedAt === 0 ? null : new Date(submittedAt * 1000), status: timestamp(values[statusIndex], "job status"), settlement: timestamp(values[settlementIndex], "job settlement"),
  };
}

export function createDisabledAgonJobEscrowReadAdapter(): AgonJobEscrowReadAdapter {
  return { enabled: false, async inspect(): Promise<AgonJobEscrowJob> { throw new Error("AgonJobEscrow inspection is disabled by policy"); } };
}

export function createViemAgonJobEscrowReadAdapter(options: {
  enabled: boolean;
  client?: AgonJobEscrowReadClient;
  escrowAddress: string;
  legacyEscrowAddresses?: readonly string[];
  escrowVersion?: AgonJobEscrowContractVersion;
  expectedServiceRegistry: string;
  expectedAsset?: string;
  expectedDisputeResolver?: string;
}): AgonJobEscrowReadAdapter {
  const escrowAddress = address(options.escrowAddress, "configured AgonJobEscrow contract address");
  const currentVersion = options.escrowVersion ?? "v1";
  const escrowCandidates = [
    { address: escrowAddress, version: currentVersion },
    ...(options.legacyEscrowAddresses ?? []).map((value) => ({
      address: address(value, "configured legacy AgonJobEscrow contract address"),
      version: "v1" as const,
    })),
  ].filter((candidate, index, all) => all.findIndex((other) => other.address === candidate.address) === index);
  const serviceRegistry = address(options.expectedServiceRegistry, "configured AgonServiceRegistry address");
  const expectedAsset = address(options.expectedAsset ?? AGON_ESCROW_USDC, "configured AgonJobEscrow USDC asset");
  const expectedResolver = options.expectedDisputeResolver ? address(options.expectedDisputeResolver, "configured dispute resolver") : null;
  const enabled = options.enabled === true && options.client !== undefined;
  return {
    enabled,
    async inspect(input): Promise<AgonJobEscrowJob> {
      if (!enabled || !options.client) throw new Error("AgonJobEscrow inspection is disabled by policy");
      const id = jobId(input);
      let lastError: unknown = new Error("AgonJobEscrow job was not found in configured contracts");
      for (const candidate of escrowCandidates) {
        try {
          const abi = candidate.version === "v2" ? AGON_JOB_ESCROW_V2_READ_ABI : AGON_JOB_ESCROW_ABI;
          const [code, asset, registry, resolver, rawJob] = await Promise.all([
            options.client.getBytecode({ address: candidate.address }),
            options.client.readContract({ address: candidate.address, abi, functionName: "usdc" }),
            options.client.readContract({ address: candidate.address, abi, functionName: "serviceRegistry" }),
            options.client.readContract({ address: candidate.address, abi, functionName: "disputeResolver" }),
            options.client.readContract({ address: candidate.address, abi, functionName: "getJob", args: [id] }),
          ]);
          if (typeof code !== "string" || !/^0x[0-9a-f]+$/i.test(code) || code.length <= 2) throw new Error("AgonJobEscrow contract has no deployed bytecode");
          if (address(asset, "AgonJobEscrow USDC asset") !== expectedAsset) throw new Error("AgonJobEscrow returned a different USDC asset");
          if (address(registry, "AgonJobEscrow service registry") !== serviceRegistry) throw new Error("AgonJobEscrow returned a different service registry");
          const normalizedResolver = address(resolver, "AgonJobEscrow dispute resolver");
          if (expectedResolver && normalizedResolver !== expectedResolver) throw new Error("AgonJobEscrow returned a different dispute resolver");
          const job = normalizeJob(rawJob);
          if (job.jobId !== id.toString()) throw new Error("AgonJobEscrow returned a different job");
          return job;
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError;
    },
  };
}
