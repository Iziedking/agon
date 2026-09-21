import { getAddress, parseAbi } from "viem";

const arenaEvaluatorAbi = parseAbi([
  "function getEvaluation(uint256 evaluationId) view returns ((uint256 evaluationId,uint256 listingId,uint256 agentId,uint256 listingVersion,uint256 category,address participant,bytes32 manifestHash,bytes32 capabilityHash,bytes32 evaluatorVersionHash,bytes32 taskCommitment,bytes32 evidenceRoot,bytes32 validationRequestHash,bytes32 validationResponseHash,uint8 score,uint64 requestedAt,uint64 submittedAt,uint64 scoredAt,uint64 expiresAt,uint8 state))",
  "function startEvaluation(uint256 evaluationId)",
  "function scoreEvaluation(uint256 evaluationId,uint8 score,bytes32 validationResponseHash)",
]);

export type AgonArenaEvaluatorClient = {
  readContract(input: { address: `0x${string}`; abi: readonly unknown[]; functionName: "getEvaluation"; args: readonly [bigint] }): Promise<unknown>;
  waitForTransactionReceipt(input: { hash: `0x${string}`; timeout?: number }): Promise<{ status: "success" | "reverted" }>;
};

export type AgonArenaEvaluatorWallet = {
  writeContract(input: { address: `0x${string}`; abi: readonly unknown[]; functionName: "startEvaluation" | "scoreEvaluation"; args: readonly unknown[] }): Promise<`0x${string}`>;
};

export type AgonArenaEvaluatorAdapter = {
  readonly enabled: boolean;
  startEvaluation(evaluationId: string): Promise<`0x${string}` | null>;
  scoreEvaluation(input: { evaluationId: string; score: number; validationResponseHash: `0x${string}` }): Promise<`0x${string}` | null>;
};

function positiveId(value: string): bigint {
  if (!/^[1-9]\d*$/.test(value)) throw new Error("Arena evaluation id must be positive");
  return BigInt(value);
}

function evaluationState(value: unknown): number {
  const record = value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const raw = Array.isArray(value) ? value[18] : record?.state;
  const state = Number(raw);
  if (!Number.isInteger(state) || state < 0 || state > 6) throw new Error("AgonArena returned an invalid state");
  return state;
}

function responseHash(value: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value) || /^0x0{64}$/i.test(value)) throw new Error("Arena validation response hash must be non-zero bytes32");
  return value as `0x${string}`;
}

export function createViemAgonArenaEvaluator(input: {
  enabled: boolean;
  arenaAddress: string;
  client?: AgonArenaEvaluatorClient;
  wallet?: AgonArenaEvaluatorWallet;
  receiptTimeoutMs?: number;
}): AgonArenaEvaluatorAdapter {
  const arenaAddress = getAddress(input.arenaAddress) as `0x${string}`;
  const enabled = input.enabled && Boolean(input.client) && Boolean(input.wallet);
  const receiptTimeoutMs = input.receiptTimeoutMs ?? 60_000;

  async function state(evaluationId: bigint): Promise<number> {
    if (!input.client) throw new Error("Arena evaluator read client is unavailable");
    return evaluationState(await input.client.readContract({ address: arenaAddress, abi: arenaEvaluatorAbi, functionName: "getEvaluation", args: [evaluationId] }));
  }

  async function submit(functionName: "startEvaluation" | "scoreEvaluation", args: readonly unknown[]): Promise<`0x${string}`> {
    if (!enabled || !input.client || !input.wallet) throw new Error("Arena evaluator execution is disabled");
    const hash = await input.wallet.writeContract({ address: arenaAddress, abi: arenaEvaluatorAbi, functionName, args });
    const receipt = await input.client.waitForTransactionReceipt({ hash, timeout: receiptTimeoutMs });
    if (receipt.status !== "success") throw new Error(`Arena ${functionName} transaction reverted`);
    return hash;
  }

  return {
    enabled,
    async startEvaluation(evaluationId) {
      const id = positiveId(evaluationId);
      const before = await state(id);
      if (before !== 0) return null;
      const hash = await submit("startEvaluation", [id]);
      if (await state(id) !== 1) throw new Error("Arena evaluation did not become active after start confirmation");
      return hash;
    },
    async scoreEvaluation(request) {
      const id = positiveId(request.evaluationId);
      if (!Number.isInteger(request.score) || request.score < 0 || request.score > 100) throw new Error("Arena score must be an integer from 0 to 100");
      const hashValue = responseHash(request.validationResponseHash);
      const before = await state(id);
      if (before >= 3) return null;
      if (before !== 2) throw new Error("Arena evidence is not ready to score");
      const hash = await submit("scoreEvaluation", [id, request.score, hashValue]);
      const after = await state(id);
      if (after !== 3 && after !== 4) throw new Error("Arena evaluation did not reach a final score after confirmation");
      return hash;
    },
  };
}
