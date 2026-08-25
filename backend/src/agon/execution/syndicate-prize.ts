import { encodeAbiParameters, encodeFunctionData, getAddress, keccak256 } from "viem";
import { allocateAgonPrizePool, type AgonPrizeShare } from "../escrow-policy.ts";

export type AgonSyndicateContributionPlan = {
  chainId: 5042002;
  to: `0x${string}`;
  value: "0x0";
  functionName: "recordContribution";
  args: readonly [bigint, bigint, `0x${string}`, bigint, `0x${string}`];
  data: `0x${string}`;
};

export type AgonSyndicateContributionState = "prepared" | "submitted" | "confirmed" | "unknown";

export type AgonSyndicateContribution = {
  intentId: string;
  actor: `0x${string}`;
  idempotencyKey: string;
  registryContract: `0x${string}`;
  syndicateId: string;
  agentId: string;
  contributionKey: `0x${string}`;
  score: string;
  evidenceHash: `0x${string}`;
  state: AgonSyndicateContributionState;
  transactionHash: `0x${string}` | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AgonSyndicateContributionInput = Omit<AgonSyndicateContribution, "state" | "transactionHash" | "createdAt" | "updatedAt"> & {
  state: "prepared";
  transactionHash: null;
  createdAt?: Date;
};

export type AgonPrizeClaimPlan = {
  chainId: 5042002;
  to: `0x${string}`;
  value: "0x0";
  functionName: "claim";
  args: readonly [`0x${string}`, bigint, `0x${string}`, bigint, readonly `0x${string}`[]];
  data: `0x${string}`;
  leaf: `0x${string}`;
};

export type AgonPrizeClaimState = "prepared" | "submitted" | "confirmed" | "unknown";

export type AgonPrizeClaim = {
  intentId: string;
  actor: `0x${string}`;
  idempotencyKey: string;
  vaultContract: `0x${string}`;
  poolKey: `0x${string}`;
  index: string;
  beneficiary: `0x${string}`;
  amount: string;
  proof: `0x${string}`[];
  leaf: `0x${string}`;
  state: AgonPrizeClaimState;
  transactionHash: `0x${string}` | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AgonPrizeClaimInput = Omit<AgonPrizeClaim, "state" | "transactionHash" | "createdAt" | "updatedAt"> & {
  state: "prepared";
  transactionHash: null;
  createdAt?: Date;
};

const syndicateAbi = [{
  type: "function", name: "recordContribution", stateMutability: "nonpayable",
  inputs: [
    { name: "syndicateId", type: "uint256" }, { name: "agentId", type: "uint256" },
    { name: "contributionKey", type: "bytes32" }, { name: "score", type: "uint256" },
    { name: "evidenceHash", type: "bytes32" },
  ], outputs: [],
}] as const;

const prizeVaultAbi = [{
  type: "function", name: "claim", stateMutability: "nonpayable",
  inputs: [
    { name: "poolKey", type: "bytes32" }, { name: "index", type: "uint256" },
    { name: "beneficiary", type: "address" }, { name: "amount", type: "uint256" },
    { name: "proof", type: "bytes32[]" },
  ], outputs: [],
}] as const;

function address(value: string, label: string): `0x${string}` {
  try { return getAddress(value) as `0x${string}`; } catch { throw new Error(`${label} must be a valid EVM address`); }
}

function bytes32(value: string, label: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${label} must be bytes32`);
  return value as `0x${string}`;
}

function positive(value: string | bigint, label: string): bigint {
  const result = typeof value === "bigint" ? value : /^\d+$/.test(value) ? BigInt(value) : -1n;
  if (result <= 0n) throw new Error(`${label} must be positive`);
  return result;
}

function nonNegative(value: string | bigint, label: string): bigint {
  const result = typeof value === "bigint" ? value : /^\d+$/.test(value) ? BigInt(value) : -1n;
  if (result < 0n) throw new Error(`${label} must be non-negative`);
  return result;
}

export function buildAgonSyndicateContributionPlan(input: {
  contract: string; syndicateId: string | bigint; agentId: string | bigint;
  contributionKey: string; score: string | bigint; evidenceHash: string;
}): AgonSyndicateContributionPlan {
  const args = [positive(input.syndicateId, "syndicate id"), positive(input.agentId, "agent id"),
    bytes32(input.contributionKey, "contribution key"), positive(input.score, "score"),
    bytes32(input.evidenceHash, "evidence hash")] as const;
  return { chainId: 5042002, to: address(input.contract, "syndicate registry"), value: "0x0",
    functionName: "recordContribution", args,
    data: encodeFunctionData({ abi: syndicateAbi, functionName: "recordContribution", args }) };
}

export function prizeClaimLeaf(input: { index: string | bigint; beneficiary: string; amount: string | bigint }): `0x${string}` {
  const encoded = encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "uint256" }],
    [nonNegative(input.index, "claim index"), address(input.beneficiary, "beneficiary"), positive(input.amount, "claim amount")]);
  return keccak256(keccak256(encoded));
}

export function buildAgonPrizeClaimPlan(input: {
  vault: string; poolKey: string; index: string | bigint; beneficiary: string;
  amount: string | bigint; proof: readonly string[];
}): AgonPrizeClaimPlan {
  const poolKey = bytes32(input.poolKey, "pool key");
  const index = nonNegative(input.index, "claim index");
  const beneficiary = address(input.beneficiary, "beneficiary");
  const amount = positive(input.amount, "claim amount");
  const proof = input.proof.map((value) => bytes32(value, "Merkle proof item"));
  const args = [poolKey, index, beneficiary, amount, proof] as const;
  return { chainId: 5042002, to: address(input.vault, "prize vault"), value: "0x0",
    functionName: "claim", args,
    data: encodeFunctionData({ abi: prizeVaultAbi, functionName: "claim", args }),
    leaf: prizeClaimLeaf({ index, beneficiary, amount }) };
}

export type AgonPrizeAllocation = { platformFeeBaseUnits: bigint; distributableBaseUnits: bigint; shares: AgonPrizeShare[] };

export function buildAgonPrizeAllocation(input: {
  poolBaseUnits: string | bigint; platformFeeBps: number;
  winners: readonly { beneficiary: string; rank: number; weightBps: number }[];
}): AgonPrizeAllocation {
  const result = allocateAgonPrizePool(input);
  if (!result.ok) throw new Error(result.error.message);
  return { platformFeeBaseUnits: result.value.platformFeeBaseUnits,
    distributableBaseUnits: result.value.poolBaseUnits - result.value.platformFeeBaseUnits,
    shares: result.value.shares };
}
