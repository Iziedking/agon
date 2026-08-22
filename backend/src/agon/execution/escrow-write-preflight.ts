import { getAddress, keccak256, stringToHex, encodeFunctionData } from "viem";
import { AGON_ESCROW_NETWORK, AGON_ESCROW_USDC } from "../escrow-policy.ts";
import { AGON_PRIZE_ESCROW_CONTROLLER_ROLE } from "./escrow-reconciliation.ts";

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const NON_NEGATIVE_INTEGER = /^(0|[1-9]\d*)$/;
const BYTES = /^0x[0-9a-f]*$/i;

export const AGON_PRIZE_ESCROW_WRITE_NETWORK = AGON_ESCROW_NETWORK;

/**
 * This is an ABI pin, not a write capability. The adapter below has no signer,
 * wallet client, send method, or transaction broadcaster.
 */
export const PRIZE_ESCROW_WRITE_ABI = [
  {
    type: "function",
    name: "depositPrizePool",
    stateMutability: "nonpayable",
    inputs: [
      { name: "contestId", type: "uint256" },
      { name: "from", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "depositChallengePot",
    stateMutability: "nonpayable",
    inputs: [
      { name: "challengeId", type: "uint256" },
      { name: "from", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "collectListingFee",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "payout",
    stateMutability: "nonpayable",
    inputs: [
      { name: "poolId", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "skimPlatformFee",
    stateMutability: "nonpayable",
    inputs: [
      { name: "poolId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "sweepUnclaimed",
    stateMutability: "nonpayable",
    inputs: [{ name: "poolId", type: "uint256" }],
    outputs: [],
  },
] as const;

export const PRIZE_ESCROW_WRITE_PREFLIGHT_VIEW_ABI = [
  {
    type: "function",
    name: "usdc",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "CONTROLLER_ROLE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "hasRole",
    stateMutability: "view",
    inputs: [
      { name: "role", type: "bytes32" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export const PRIZE_ESCROW_REQUIRED_MUTATING_SIGNATURES = [
  "depositPrizePool(uint256,address,uint256)",
  "depositChallengePot(uint256,address,uint256)",
  "collectListingFee(address,uint256)",
  "payout(uint256,address,uint256)",
  "skimPlatformFee(uint256,uint256)",
  "sweepUnclaimed(uint256)",
] as const;

export type AgonEscrowWriteOperation = "fund" | "release" | "refund";

export type AgonPrizeEscrowWritePreflightRequest = {
  network: string;
  escrowAddress: string;
  controller: string;
  operation: AgonEscrowWriteOperation;
  poolId: string;
  amountBaseUnits: string | bigint;
  participant: string;
  expectedAsset?: string | null;
};

export type AgonPrizeEscrowWriteIntent = {
  network: typeof AGON_PRIZE_ESCROW_WRITE_NETWORK;
  escrowAddress: `0x${string}`;
  controller: `0x${string}`;
  asset: `0x${string}`;
  operation: AgonEscrowWriteOperation;
  functionName: "depositPrizePool" | "payout";
  poolId: string;
  amountBaseUnits: string;
  participant: `0x${string}`;
  args: readonly unknown[];
  data: `0x${string}`;
  execution: "disabled";
};

export type AgonPrizeEscrowWritePreflightResult = {
  status: "preflight_passed";
  codePresent: true;
  controllerAuthorized: true;
  controllerRole: `0x${string}`;
  requiredMutatingSignatures: typeof PRIZE_ESCROW_REQUIRED_MUTATING_SIGNATURES;
  requiredMutatingSelectors: readonly `0x${string}`[];
  intent: AgonPrizeEscrowWriteIntent;
};

export type AgonPrizeEscrowWritePreflightClient = {
  getBytecode(input: { address: `0x${string}` }): Promise<unknown>;
  readContract(input: {
    address: `0x${string}`;
    abi: typeof PRIZE_ESCROW_WRITE_PREFLIGHT_VIEW_ABI;
    functionName: "usdc" | "CONTROLLER_ROLE" | "hasRole";
    args: readonly [] | readonly [`0x${string}`, `0x${string}`];
  }): Promise<unknown>;
};

export type AgonPrizeEscrowWritePreflightAdapter = {
  readonly enabled: boolean;
  preflight(input: AgonPrizeEscrowWritePreflightRequest): Promise<AgonPrizeEscrowWritePreflightResult>;
};

function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && ADDRESS.test(value);
}

function normalizedAddress(value: string, label: string): `0x${string}` {
  if (!isAddress(value)) throw new Error(`${label} is invalid`);
  return getAddress(value).toLowerCase() as `0x${string}`;
}

function normalizedInteger(value: string | bigint, label: string): string {
  if (typeof value === "bigint") {
    if (value < 0n) throw new Error(`${label} must be a non-negative integer`);
    return value.toString();
  }
  if (!NON_NEGATIVE_INTEGER.test(value)) throw new Error(`${label} must be a non-negative integer`);
  return BigInt(value).toString();
}

function validateRequest(input: AgonPrizeEscrowWritePreflightRequest) {
  if (input.network !== AGON_PRIZE_ESCROW_WRITE_NETWORK) throw new Error("PrizeEscrow preflight must remain on Arc Testnet");
  const escrowAddress = normalizedAddress(input.escrowAddress, "PrizeEscrow contract address");
  const controller = normalizedAddress(input.controller, "PrizeEscrow controller");
  const participant = normalizedAddress(input.participant, "PrizeEscrow participant");
  const poolId = normalizedInteger(input.poolId, "PrizeEscrow pool id");
  const amountBaseUnits = normalizedInteger(input.amountBaseUnits, "PrizeEscrow amount");
  if (amountBaseUnits === "0") throw new Error("PrizeEscrow amount must be positive");
  const expectedAsset = input.expectedAsset === undefined || input.expectedAsset === null
    ? AGON_ESCROW_USDC
    : normalizedAddress(input.expectedAsset, "PrizeEscrow USDC asset");
  if (expectedAsset !== AGON_ESCROW_USDC) throw new Error("PrizeEscrow asset is not pinned to Arc Testnet USDC");
  return { ...input, escrowAddress, controller, participant, poolId, amountBaseUnits, expectedAsset };
}

function selector(signature: string): `0x${string}` {
  return keccak256(stringToHex(signature)).slice(0, 10) as `0x${string}`;
}

export function buildAgonPrizeEscrowWriteIntent(input: AgonPrizeEscrowWritePreflightRequest): AgonPrizeEscrowWriteIntent {
  const request = validateRequest(input);
  const functionName = request.operation === "fund" ? "depositPrizePool" : "payout";
  const args = request.operation === "fund"
    ? [BigInt(request.poolId), request.participant, BigInt(request.amountBaseUnits)] as const
    : [BigInt(request.poolId), request.participant, BigInt(request.amountBaseUnits)] as const;
  const data = encodeFunctionData({ abi: PRIZE_ESCROW_WRITE_ABI, functionName, args });
  return {
    network: AGON_PRIZE_ESCROW_WRITE_NETWORK,
    escrowAddress: request.escrowAddress,
    controller: request.controller,
    asset: request.expectedAsset,
    operation: request.operation,
    functionName,
    poolId: request.poolId,
    amountBaseUnits: request.amountBaseUnits,
    participant: request.participant,
    args,
    data,
    execution: "disabled",
  };
}

function hasCode(value: unknown): value is `0x${string}` {
  return typeof value === "string" && BYTES.test(value) && value.length > 2 && /[1-9a-f]/i.test(value.slice(2));
}

function normalizedRole(value: unknown): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/i.test(value)) throw new Error("PrizeEscrow controller role is invalid");
  return value.toLowerCase() as `0x${string}`;
}

/** No RPC, signer, wallet, or transaction call is made by this default adapter. */
export function createDisabledAgonPrizeEscrowWritePreflightAdapter(): AgonPrizeEscrowWritePreflightAdapter {
  return {
    enabled: false,
    async preflight(): Promise<AgonPrizeEscrowWritePreflightResult> {
      throw new Error("PrizeEscrow write preflight is disabled by policy");
    },
  };
}

/**
 * Bounded read-only preflight. A successful result means only that a safe,
 * deterministic intent was built; it never authorizes execution.
 */
export function createViemAgonPrizeEscrowWritePreflightAdapter(options: {
  enabled: boolean;
  client?: AgonPrizeEscrowWritePreflightClient;
  escrowAddress: string;
  expectedAsset?: string;
  timeoutMs?: number;
}): AgonPrizeEscrowWritePreflightAdapter {
  const configuredContract = normalizedAddress(options.escrowAddress, "configured PrizeEscrow contract address");
  const expectedAsset = normalizedAddress(options.expectedAsset ?? AGON_ESCROW_USDC, "configured PrizeEscrow USDC asset");
  const timeoutMs = Math.max(250, Math.min(options.timeoutMs ?? 5_000, 15_000));
  return {
    enabled: options.enabled === true && options.client !== undefined,
    async preflight(input): Promise<AgonPrizeEscrowWritePreflightResult> {
      if (options.enabled !== true || !options.client) throw new Error("PrizeEscrow write preflight is disabled by policy");
      const request = validateRequest(input);
      if (request.escrowAddress !== configuredContract) throw new Error("PrizeEscrow request is not pinned to the configured contract");
      if (request.expectedAsset !== expectedAsset) throw new Error("PrizeEscrow request is not pinned to the configured USDC asset");
      const [code, asset, role, authorized] = await withTimeout(Promise.all([
        options.client.getBytecode({ address: configuredContract }),
        options.client.readContract({ address: configuredContract, abi: PRIZE_ESCROW_WRITE_PREFLIGHT_VIEW_ABI, functionName: "usdc", args: [] }),
        options.client.readContract({ address: configuredContract, abi: PRIZE_ESCROW_WRITE_PREFLIGHT_VIEW_ABI, functionName: "CONTROLLER_ROLE", args: [] }),
        options.client.readContract({ address: configuredContract, abi: PRIZE_ESCROW_WRITE_PREFLIGHT_VIEW_ABI, functionName: "hasRole", args: [AGON_PRIZE_ESCROW_CONTROLLER_ROLE, request.controller] }),
      ]), timeoutMs);
      if (!hasCode(code)) throw new Error("PrizeEscrow contract has no deployed bytecode");
      if (normalizedAddress(String(asset), "PrizeEscrow USDC asset") !== expectedAsset) throw new Error("PrizeEscrow contract returned a different USDC asset");
      const controllerRole = normalizedRole(role);
      if (controllerRole !== AGON_PRIZE_ESCROW_CONTROLLER_ROLE.toLowerCase()) throw new Error("PrizeEscrow contract returned a different controller role");
      if (typeof authorized !== "boolean") throw new Error("PrizeEscrow controller authorization is invalid");
      if (!authorized) throw new Error("PrizeEscrow controller is not authorized");
      return {
        status: "preflight_passed",
        codePresent: true,
        controllerAuthorized: true,
        controllerRole,
        requiredMutatingSignatures: PRIZE_ESCROW_REQUIRED_MUTATING_SIGNATURES,
        requiredMutatingSelectors: PRIZE_ESCROW_REQUIRED_MUTATING_SIGNATURES.map(selector),
        intent: buildAgonPrizeEscrowWriteIntent(request),
      };
    },
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("PrizeEscrow write preflight timed out")), timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}
