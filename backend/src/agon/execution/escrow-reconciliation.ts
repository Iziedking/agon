import { getAddress } from "viem";
import { AGON_ESCROW_NETWORK, AGON_ESCROW_USDC } from "../escrow-policy.ts";

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const NON_NEGATIVE_INTEGER = /^(0|[1-9]\d*)$/;
const MAX_REASON_LENGTH = 512;

export const AGON_PRIZE_ESCROW_NETWORK = AGON_ESCROW_NETWORK;

export type AgonPrizeEscrowPoolBinding = {
  contractAddress: `0x${string}`;
  controller: `0x${string}`;
  poolId: string;
};

export type AgonPrizeEscrowReadRequest = {
  network: typeof AGON_PRIZE_ESCROW_NETWORK;
  escrowAddress: `0x${string}`;
  controller: `0x${string}`;
  poolId: string;
  expectedAsset?: `0x${string}` | null;
  expectedBalanceBaseUnits?: string | null;
};

export type AgonPrizeEscrowReadResult = {
  network: typeof AGON_PRIZE_ESCROW_NETWORK;
  escrowAddress: `0x${string}`;
  asset: `0x${string}`;
  controller: `0x${string}`;
  poolId: string;
  balanceBaseUnits: string;
  checkedAt?: string;
  reason?: string;
};

export type AgonPrizeEscrowReadClient = {
  readContract(input: {
    address: `0x${string}`;
    abi: typeof PRIZE_ESCROW_VIEW_ABI;
    functionName: "usdc" | "poolBalance";
    args: readonly [] | readonly [`0x${string}`, bigint];
  }): Promise<unknown>;
};

export type AgonPrizeEscrowReadAdapter = {
  readonly enabled: boolean;
  inspect(input: AgonPrizeEscrowReadRequest): Promise<AgonPrizeEscrowReadResult>;
};

export function validateAgonPrizeEscrowPoolBinding(input: {
  contractAddress: string;
  controller: string;
  poolId: string;
}, configuredContract?: string): AgonPrizeEscrowPoolBinding {
  const contractAddress = normalizedAddress(input.contractAddress);
  const controller = normalizedAddress(input.controller);
  const poolId = normalizedPoolId(input.poolId);
  if (configuredContract !== undefined && contractAddress !== normalizedAddress(configuredContract)) {
    throw new Error("PrizeEscrow pool binding is not pinned to the configured contract");
  }
  return { contractAddress, controller, poolId };
}

export const PRIZE_ESCROW_VIEW_ABI = [
  {
    type: "function",
    name: "usdc",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "poolBalance",
    stateMutability: "view",
    inputs: [
      { name: "controller", type: "address" },
      { name: "poolId", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && ADDRESS.test(value);
}

function normalizedAddress(value: string): `0x${string}` {
  if (!isAddress(value)) throw new Error("PrizeEscrow address is invalid");
  return getAddress(value).toLowerCase() as `0x${string}`;
}

function normalizedPoolId(value: string): string {
  if (!NON_NEGATIVE_INTEGER.test(value)) throw new Error("PrizeEscrow pool id must be a non-negative integer");
  return BigInt(value).toString();
}

function normalizedAmount(value: unknown, label: string): string {
  if (typeof value === "bigint") {
    if (value < 0n) throw new Error(`${label} must be a non-negative integer`);
    return value.toString();
  }
  if (typeof value !== "string" || !NON_NEGATIVE_INTEGER.test(value)) throw new Error(`${label} must be a non-negative integer`);
  return BigInt(value).toString();
}

function validateRequest(input: AgonPrizeEscrowReadRequest): AgonPrizeEscrowReadRequest {
  if (input.network !== AGON_PRIZE_ESCROW_NETWORK) throw new Error("PrizeEscrow inspection must remain on Arc Testnet");
  const escrowAddress = normalizedAddress(input.escrowAddress);
  const controller = normalizedAddress(input.controller);
  const poolId = normalizedPoolId(input.poolId);
  const expectedAsset = input.expectedAsset ? normalizedAddress(input.expectedAsset) : AGON_ESCROW_USDC;
  const expectedBalanceBaseUnits = input.expectedBalanceBaseUnits === undefined || input.expectedBalanceBaseUnits === null
    ? input.expectedBalanceBaseUnits
    : normalizedAmount(input.expectedBalanceBaseUnits, "expected pool balance");
  return { ...input, escrowAddress, controller, poolId, expectedAsset, expectedBalanceBaseUnits };
}

export function validateAgonPrizeEscrowReadResult(input: AgonPrizeEscrowReadResult, request: AgonPrizeEscrowReadRequest): AgonPrizeEscrowReadResult {
  const expected = validateRequest(request);
  if (input.network !== AGON_PRIZE_ESCROW_NETWORK) throw new Error("PrizeEscrow result is not on Arc Testnet");
  if (normalizedAddress(input.escrowAddress) !== expected.escrowAddress) throw new Error("PrizeEscrow result returned a different contract");
  if (normalizedAddress(input.controller) !== expected.controller) throw new Error("PrizeEscrow result returned a different controller");
  if (normalizedPoolId(input.poolId) !== expected.poolId) throw new Error("PrizeEscrow result returned a different pool");
  if (normalizedAddress(input.asset) !== expected.expectedAsset) throw new Error("PrizeEscrow result returned a different USDC asset");
  const balanceBaseUnits = normalizedAmount(input.balanceBaseUnits, "pool balance");
  if (expected.expectedBalanceBaseUnits !== undefined && expected.expectedBalanceBaseUnits !== null && balanceBaseUnits !== expected.expectedBalanceBaseUnits) {
    throw new Error("PrizeEscrow pool balance does not match the escrow intent");
  }
  if (input.checkedAt !== undefined && (Number.isNaN(Date.parse(input.checkedAt)) || input.checkedAt.length > 64)) throw new Error("PrizeEscrow check timestamp is invalid");
  if (input.reason !== undefined && (input.reason.length === 0 || input.reason.length > MAX_REASON_LENGTH)) throw new Error("PrizeEscrow reason must be 1-512 characters");
  return {
    ...input,
    network: AGON_PRIZE_ESCROW_NETWORK,
    escrowAddress: expected.escrowAddress,
    controller: expected.controller,
    poolId: expected.poolId,
    asset: expected.expectedAsset,
    balanceBaseUnits,
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("PrizeEscrow inspection timed out")), timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

/** No RPC or PrizeEscrow call is made by this default adapter. */
export function createDisabledAgonPrizeEscrowReadAdapter(): AgonPrizeEscrowReadAdapter {
  return { enabled: false, async inspect(): Promise<AgonPrizeEscrowReadResult> { throw new Error("PrizeEscrow inspection is disabled by policy"); } };
}

/** Read-only viem adapter. It never exposes a write method and is disabled by default. */
export function createViemAgonPrizeEscrowReadAdapter(options: {
  enabled: boolean;
  client?: AgonPrizeEscrowReadClient;
  escrowAddress: `0x${string}`;
  expectedAsset?: `0x${string}`;
  timeoutMs?: number;
  failureThreshold?: number;
  cooldownMs?: number;
}): AgonPrizeEscrowReadAdapter {
  const escrowAddress = normalizedAddress(options.escrowAddress);
  const expectedAsset = normalizedAddress(options.expectedAsset ?? AGON_ESCROW_USDC);
  const timeoutMs = Math.max(250, Math.min(options.timeoutMs ?? 5_000, 15_000));
  const failureThreshold = Math.max(1, Math.min(options.failureThreshold ?? 3, 10));
  const cooldownMs = Math.max(1_000, Math.min(options.cooldownMs ?? 30_000, 300_000));
  let failures = 0;
  let openedUntil = 0;
  return {
    enabled: options.enabled === true && options.client !== undefined,
    async inspect(input): Promise<AgonPrizeEscrowReadResult> {
      if (options.enabled !== true || !options.client) throw new Error("PrizeEscrow inspection is disabled by policy");
      const request = validateRequest(input);
      if (request.escrowAddress !== escrowAddress) throw new Error("PrizeEscrow request is not pinned to the configured contract");
      if (request.expectedAsset !== expectedAsset) throw new Error("PrizeEscrow request is not pinned to the configured USDC asset");
      if (Date.now() < openedUntil) throw new Error("PrizeEscrow inspection circuit is open");
      try {
        const [asset, balance] = await withTimeout(Promise.all([
          options.client.readContract({ address: escrowAddress, abi: PRIZE_ESCROW_VIEW_ABI, functionName: "usdc", args: [] }),
          options.client.readContract({ address: escrowAddress, abi: PRIZE_ESCROW_VIEW_ABI, functionName: "poolBalance", args: [request.controller, BigInt(request.poolId)] }),
        ]), timeoutMs);
        const result = validateAgonPrizeEscrowReadResult({
          network: AGON_PRIZE_ESCROW_NETWORK,
          escrowAddress,
          asset: normalizedAddress(String(asset)),
          controller: request.controller,
          poolId: request.poolId,
          balanceBaseUnits: normalizedAmount(balance, "pool balance"),
          checkedAt: new Date().toISOString(),
          reason: "PrizeEscrow view read",
        }, request);
        failures = 0;
        openedUntil = 0;
        return result;
      } catch (error) {
        failures += 1;
        if (failures >= failureThreshold) openedUntil = Date.now() + cooldownMs;
        throw new Error(error instanceof Error ? error.message : "PrizeEscrow inspection failed");
      }
    },
  };
}
