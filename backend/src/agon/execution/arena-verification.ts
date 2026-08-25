import { encodeFunctionData, getAddress, keccak256, stringToHex } from "viem";
import { canonicalizeManifest } from "../core/manifest.ts";
import type { PlaygroundRun } from "../playground.ts";

export type AgonArenaEvaluationState =
  | "prepared"
  | "request_submitted"
  | "evidence_ready"
  | "evidence_submitted"
  | "verified"
  | "rejected"
  | "expired"
  | "revoked"
  | "unknown";

export type AgonArenaEvaluation = {
  intentId: string;
  actor: `0x${string}`;
  idempotencyKey: string;
  listingReference: string;
  network: "eip155:5042002";
  arenaContract: `0x${string}`;
  validationRegistry: `0x${string}`;
  participant: `0x${string}`;
  serviceRegistry: `0x${string}`;
  listingId: string;
  agentId: string;
  listingVersion: string;
  category: string;
  manifestHash: `0x${string}`;
  capabilityHash: `0x${string}`;
  evaluatorVersionHash: `0x${string}`;
  taskCommitment: `0x${string}`;
  validationRequestHash: `0x${string}`;
  evidenceRoot: `0x${string}`;
  playgroundRunId: string;
  expiresAt: Date;
  state: AgonArenaEvaluationState;
  evaluationId: string | null;
  requestTransactionHash: `0x${string}` | null;
  startTransactionHash: `0x${string}` | null;
  evidenceTransactionHash: `0x${string}` | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AgonArenaEvaluationInput = Omit<AgonArenaEvaluation, "createdAt" | "updatedAt" | "state" | "evaluationId" | "requestTransactionHash" | "evidenceTransactionHash">;

const arenaAbi = [
  {
    type: "function",
    name: "requestEvaluation",
    stateMutability: "nonpayable",
    inputs: [
      { name: "validationRequestHash", type: "bytes32" },
      { name: "listingId", type: "uint256" },
      { name: "capabilityHash", type: "bytes32" },
      { name: "evaluatorVersionHash", type: "bytes32" },
      { name: "taskCommitment", type: "bytes32" },
      { name: "expiresAt", type: "uint64" },
    ],
    outputs: [{ name: "evaluationId", type: "uint256" }],
  },
  {
    type: "function",
    name: "submitEvidence",
    stateMutability: "nonpayable",
    inputs: [
      { name: "evaluationId", type: "uint256" },
      { name: "evidenceRoot", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

function address(value: string): `0x${string}` {
  return getAddress(value) as `0x${string}`;
}

function hash(value: unknown): `0x${string}` {
  return keccak256(stringToHex(canonicalizeManifest(value)));
}

function bytes32(value: string, label: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${label} must be a bytes32 value`);
  return value as `0x${string}`;
}

function futureExpiry(value: Date): void {
  if (!Number.isFinite(value.getTime()) || value.getTime() <= Date.now()) throw new Error("Arena evaluation expiry must be in the future");
}

export function buildAgonArenaEvaluationInput(input: {
  intentId: string;
  actor: string;
  idempotencyKey: string;
  listingReference: string;
  arenaContract: string;
  validationRegistry: string;
  listing: {
    serviceRegistry: string;
    listingId: string;
    agentId: string;
    version: string;
    category: string;
    manifestHash: string;
    providerSnapshot: string;
  };
  playgroundRun: PlaygroundRun;
  expiresAt: Date;
}): AgonArenaEvaluationInput {
  if (!/^[0-9a-f-]{36}$/i.test(input.intentId)) throw new Error("Arena evaluation intent id must be a UUID");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(input.idempotencyKey)) throw new Error("Arena evaluation idempotency key is invalid");
  const actor = address(input.actor);
  const provider = address(input.listing.providerSnapshot);
  if (actor.toLowerCase() !== provider.toLowerCase()) throw new Error("only the current listing provider can prepare Arena verification");
  const scope = input.playgroundRun.scope;
  if (!scope || scope.listingReference !== input.listingReference || scope.listingVersion !== input.listing.version) {
    throw new Error("playground evidence scope does not match the current listing version");
  }
  if (!input.playgroundRun.evidence) throw new Error("completed playground evidence is required");
  futureExpiry(input.expiresAt);
  const run = input.playgroundRun;
  const evidence = run.evidence;
  return {
    intentId: input.intentId,
    actor,
    idempotencyKey: input.idempotencyKey,
    listingReference: input.listingReference,
    network: "eip155:5042002",
    arenaContract: address(input.arenaContract),
    validationRegistry: address(input.validationRegistry),
    participant: actor,
    serviceRegistry: address(input.listing.serviceRegistry),
    listingId: input.listing.listingId,
    agentId: input.listing.agentId,
    listingVersion: input.listing.version,
    category: input.listing.category,
    manifestHash: bytes32(input.listing.manifestHash, "manifest hash"),
    capabilityHash: hash({ capability: run.task.capability }),
    evaluatorVersionHash: bytes32(evidence.evaluatorVersionHash, "evaluator version hash"),
    taskCommitment: bytes32(evidence.taskCommitment, "task commitment"),
    validationRequestHash: bytes32(evidence.validationRequestHash, "validation request hash"),
    evidenceRoot: bytes32(evidence.evidenceRoot, "evidence root"),
    playgroundRunId: run.runId,
    expiresAt: input.expiresAt,
    startTransactionHash: null,
  };
}

export type AgonArenaTransactionPlan = {
  chainId: 5042002;
  to: `0x${string}`;
  value: "0x0";
  functionName: "requestEvaluation" | "submitEvidence";
  args: readonly unknown[];
  data: `0x${string}`;
};

export function buildAgonArenaRequestPlan(evaluation: AgonArenaEvaluation): AgonArenaTransactionPlan {
  if (evaluation.state !== "prepared") throw new Error(`Arena evaluation is ${evaluation.state}; request transaction is no longer ready`);
  const args = [
    evaluation.validationRequestHash,
    BigInt(evaluation.listingId),
    evaluation.capabilityHash,
    evaluation.evaluatorVersionHash,
    evaluation.taskCommitment,
    BigInt(Math.floor(evaluation.expiresAt.getTime() / 1000)),
  ] as const;
  return { chainId: 5042002, to: evaluation.arenaContract, value: "0x0", functionName: "requestEvaluation", args, data: encodeFunctionData({ abi: arenaAbi, functionName: "requestEvaluation", args }) };
}

export function buildAgonArenaEvidencePlan(evaluation: AgonArenaEvaluation): AgonArenaTransactionPlan {
  if (!evaluation.evaluationId) throw new Error("on-chain evaluation id is required before evidence submission");
  if (evaluation.state !== "evidence_ready") throw new Error(`Arena evidence is not ready while evaluation is ${evaluation.state}; evaluator start must be reconciled first`);
  const args = [BigInt(evaluation.evaluationId), evaluation.evidenceRoot] as const;
  return { chainId: 5042002, to: evaluation.arenaContract, value: "0x0", functionName: "submitEvidence", args, data: encodeFunctionData({ abi: arenaAbi, functionName: "submitEvidence", args }) };
}
