import { decodeEventLog, getAddress, parseAbi } from "viem";

const arenaAbi = parseAbi([
  "function getEvaluation(uint256 evaluationId) view returns ((uint256 evaluationId,uint256 listingId,uint256 agentId,uint256 listingVersion,uint256 category,address participant,bytes32 manifestHash,bytes32 capabilityHash,bytes32 evaluatorVersionHash,bytes32 taskCommitment,bytes32 evidenceRoot,bytes32 validationRequestHash,bytes32 validationResponseHash,uint8 score,uint64 requestedAt,uint64 submittedAt,uint64 scoredAt,uint64 expiresAt,uint8 state))",
]);
const syndicateAbi = parseAbi([
  "event ContributionRecorded(uint256 indexed syndicateId,uint256 indexed agentId,bytes32 indexed contributionKey,uint256 score,bytes32 evidenceHash)",
  "function contributionRecorded(uint256 syndicateId,bytes32 contributionKey) view returns (bool)",
]);
const prizeAbi = parseAbi([
  "event PrizeClaimed(bytes32 indexed poolKey,uint256 indexed index,address indexed beneficiary,uint256 amount)",
  "function isClaimed(bytes32 poolKey,uint256 index) view returns (bool)",
]);

export type AgonArenaChainEvaluation = {
  evaluationId: string;
  listingId: string;
  agentId: string;
  listingVersion: string;
  category: string;
  participant: `0x${string}`;
  manifestHash: `0x${string}`;
  capabilityHash: `0x${string}`;
  evaluatorVersionHash: `0x${string}`;
  taskCommitment: `0x${string}`;
  evidenceRoot: `0x${string}`;
  validationRequestHash: `0x${string}`;
  validationResponseHash: `0x${string}`;
  score: number;
  expiresAt: Date;
  state: number;
};

export type AgonProtocolFinalityReader = {
  readonly enabled: boolean;
  inspectArenaEvaluation(evaluationId: string): Promise<AgonArenaChainEvaluation>;
  confirmSyndicateContribution(input: {
    transactionHash: `0x${string}`;
    syndicateId: string;
    agentId: string;
    contributionKey: `0x${string}`;
    score: string;
    evidenceHash: `0x${string}`;
  }): Promise<void>;
  confirmPrizeClaim(input: {
    transactionHash: `0x${string}`;
    poolKey: `0x${string}`;
    index: string;
    beneficiary: `0x${string}`;
    amount: string;
  }): Promise<void>;
};

export type AgonProtocolFinalityClient = {
  readContract(input: { address: `0x${string}`; abi: readonly unknown[]; functionName: string; args: readonly unknown[] }): Promise<unknown>;
  getTransactionReceipt(input: { hash: `0x${string}` }): Promise<{
    status: "success" | "reverted";
    to: `0x${string}` | null;
    logs: readonly { address: `0x${string}`; data: `0x${string}`; topics: readonly `0x${string}`[] }[];
  }>;
};

function address(value: string, label: string): `0x${string}` {
  try { return getAddress(value).toLowerCase() as `0x${string}`; } catch { throw new Error(`${label} must be a valid address`); }
}

function positive(value: string, label: string): bigint {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${label} must be positive`);
  return BigInt(value);
}

function nonNegative(value: string, label: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be non-negative`);
  return BigInt(value);
}

function hash(value: string, label: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${label} must be bytes32`);
  return value.toLowerCase() as `0x${string}`;
}

function arenaEvaluation(raw: unknown): AgonArenaChainEvaluation {
  const record = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  const values = Array.isArray(raw) ? raw : record ? [
    record.evaluationId, record.listingId, record.agentId, record.listingVersion, record.category,
    record.participant, record.manifestHash, record.capabilityHash, record.evaluatorVersionHash,
    record.taskCommitment, record.evidenceRoot, record.validationRequestHash, record.validationResponseHash,
    record.score, record.requestedAt, record.submittedAt, record.scoredAt, record.expiresAt, record.state,
  ] : [];
  if (values.length < 19) throw new Error("AgonArena returned an invalid evaluation tuple");
  const numberValue = (value: unknown, label: string) => {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${label} is invalid`);
    return parsed;
  };
  return {
    evaluationId: positive(String(values[0]), "evaluation id").toString(),
    listingId: positive(String(values[1]), "listing id").toString(),
    agentId: positive(String(values[2]), "agent id").toString(),
    listingVersion: positive(String(values[3]), "listing version").toString(),
    category: nonNegative(String(values[4]), "category").toString(),
    participant: address(String(values[5]), "participant"),
    manifestHash: hash(String(values[6]), "manifest hash"),
    capabilityHash: hash(String(values[7]), "capability hash"),
    evaluatorVersionHash: hash(String(values[8]), "evaluator version hash"),
    taskCommitment: hash(String(values[9]), "task commitment"),
    evidenceRoot: hash(String(values[10]), "evidence root"),
    validationRequestHash: hash(String(values[11]), "validation request hash"),
    validationResponseHash: hash(String(values[12]), "validation response hash"),
    score: numberValue(values[13], "score"),
    expiresAt: new Date(numberValue(values[17], "expiry") * 1000),
    state: numberValue(values[18], "state"),
  };
}

function matchingLog(receipt: Awaited<ReturnType<AgonProtocolFinalityClient["getTransactionReceipt"]>>, contract: `0x${string}`, abi: readonly unknown[], eventName: string, matches: (args: Record<string, unknown>) => boolean): boolean {
  if (receipt.status !== "success" || receipt.to?.toLowerCase() !== contract) return false;
  return receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== contract || !log.topics[0]) return false;
    try {
      const decoded = decodeEventLog({ abi, data: log.data, topics: [...log.topics] as [`0x${string}`, ...`0x${string}`[]] });
      return decoded.eventName === eventName && matches(decoded.args as Record<string, unknown>);
    } catch {
      return false;
    }
  });
}

export function createViemAgonProtocolFinalityReader(options: {
  client?: AgonProtocolFinalityClient;
  arenaAddress: string;
  syndicateRegistryAddress: string;
  prizeVaultAddress: string;
}): AgonProtocolFinalityReader {
  const arena = address(options.arenaAddress, "Arena address");
  const syndicate = address(options.syndicateRegistryAddress, "syndicate registry address");
  const prize = address(options.prizeVaultAddress, "prize vault address");
  const enabled = options.client !== undefined;
  const client = () => {
    if (!enabled || !options.client) throw new Error("Agon protocol finality reads are disabled");
    return options.client;
  };
  return {
    enabled,
    async inspectArenaEvaluation(evaluationId) {
      const id = positive(evaluationId, "evaluation id");
      return arenaEvaluation(await client().readContract({ address: arena, abi: arenaAbi, functionName: "getEvaluation", args: [id] }));
    },
    async confirmSyndicateContribution(input) {
      const syndicateId = positive(input.syndicateId, "syndicate id");
      const agentId = positive(input.agentId, "agent id");
      const contributionKey = hash(input.contributionKey, "contribution key");
      const score = positive(input.score, "score");
      const evidenceHash = hash(input.evidenceHash, "evidence hash");
      const [recorded, receipt] = await Promise.all([
        client().readContract({ address: syndicate, abi: syndicateAbi, functionName: "contributionRecorded", args: [syndicateId, contributionKey] }),
        client().getTransactionReceipt({ hash: hash(input.transactionHash, "transaction hash") }),
      ]);
      if (recorded !== true) throw new Error("syndicate contribution is not recorded on chain");
      const matches = matchingLog(receipt, syndicate, syndicateAbi, "ContributionRecorded", (args) =>
        String(args.syndicateId) === syndicateId.toString()
        && String(args.agentId) === agentId.toString()
        && String(args.contributionKey).toLowerCase() === contributionKey
        && String(args.score) === score.toString()
        && String(args.evidenceHash).toLowerCase() === evidenceHash);
      if (!matches) throw new Error("transaction receipt does not prove the exact syndicate contribution");
    },
    async confirmPrizeClaim(input) {
      const poolKey = hash(input.poolKey, "pool key");
      const index = nonNegative(input.index, "claim index");
      const beneficiary = address(input.beneficiary, "beneficiary");
      const amount = positive(input.amount, "claim amount");
      const [claimed, receipt] = await Promise.all([
        client().readContract({ address: prize, abi: prizeAbi, functionName: "isClaimed", args: [poolKey, index] }),
        client().getTransactionReceipt({ hash: hash(input.transactionHash, "transaction hash") }),
      ]);
      if (claimed !== true) throw new Error("prize allocation is not claimed on chain");
      const matches = matchingLog(receipt, prize, prizeAbi, "PrizeClaimed", (args) =>
        String(args.poolKey).toLowerCase() === poolKey
        && String(args.index) === index.toString()
        && String(args.beneficiary).toLowerCase() === beneficiary
        && String(args.amount) === amount.toString());
      if (!matches) throw new Error("transaction receipt does not prove the exact prize claim");
    },
  };
}
