import { getAddress } from "viem";
import { AGON_ESCROW_USDC } from "../escrow-policy.ts";
import {
  PRIZE_ESCROW_WRITE_ABI,
  buildAgonPrizeEscrowWriteIntent,
  type AgonPrizeEscrowWritePreflightResult,
} from "./escrow-write-preflight.ts";
import {
  validateAgonEscrowTransactionApproval,
  type AgonEscrowTransactionApproval,
} from "./escrow-transaction-approval.ts";

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const RECEIPT_TIMEOUT_MS = 30_000;

export type AgonEscrowTransactionWriteClient = {
  writeContract(input: {
    address: `0x${string}`;
    abi: typeof PRIZE_ESCROW_WRITE_ABI;
    functionName: "depositPrizePool" | "payout";
    args: readonly unknown[];
    account: `0x${string}`;
  }): Promise<`0x${string}`>;
  waitForTransactionReceipt(input: {
    hash: `0x${string}`;
    timeout?: number;
  }): Promise<{
    status?: "success" | "reverted" | 1 | 0;
    transactionHash?: string;
    to?: string | null;
  }>;
};

export type AgonEscrowTransactionWriterInput = {
  intentId: string;
  actor: string;
  preflight: AgonPrizeEscrowWritePreflightResult;
  approval: AgonEscrowTransactionApproval;
  /** Test clock only; production callers should omit this. */
  nowSeconds?: number;
};

export type AgonEscrowTransactionWriteErrorCode =
  | "transaction_disabled"
  | "transaction_not_ready"
  | "transaction_unknown"
  | "transaction_reverted";

export type AgonEscrowTransactionWriteResult =
  | { ok: true; value: { providerReference: null; transaction: `0x${string}` } }
  | { ok: false; error: { code: AgonEscrowTransactionWriteErrorCode; message: string } };

export type AgonEscrowTransactionWriter = {
  readonly enabled: boolean;
  submit(input: AgonEscrowTransactionWriterInput): Promise<AgonEscrowTransactionWriteResult>;
};

function failure(code: AgonEscrowTransactionWriteErrorCode, message: string): AgonEscrowTransactionWriteResult {
  return { ok: false, error: { code, message } };
}

function address(value: unknown): `0x${string}` | null {
  if (typeof value !== "string" || !ADDRESS.test(value)) return null;
  try {
    return getAddress(value).toLowerCase() as `0x${string}`;
  } catch {
    return null;
  }
}

function hash(value: unknown): `0x${string}` | null {
  return typeof value === "string" && HASH.test(value) ? value.toLowerCase() as `0x${string}` : null;
}

function sameArgs(left: readonly unknown[], right: readonly unknown[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => {
    const expected = right[index];
    if (typeof value === "bigint" && typeof expected === "bigint") return value === expected;
    return value === expected;
  });
}

function verifyIntent(input: AgonEscrowTransactionWriterInput): boolean {
  const intent = input.preflight.intent;
  if (intent.execution !== "disabled" || intent.network !== "eip155:5042002") return false;
  if (intent.asset.toLowerCase() !== AGON_ESCROW_USDC.toLowerCase()) return false;
  const escrowAddress = address(intent.escrowAddress);
  const controller = address(intent.controller);
  const participant = address(intent.participant);
  if (!escrowAddress || !controller || !participant) return false;
  try {
    const rebuilt = buildAgonPrizeEscrowWriteIntent({
      network: intent.network,
      escrowAddress,
      controller,
      operation: intent.operation,
      poolId: intent.poolId,
      amountBaseUnits: intent.amountBaseUnits,
      participant,
      expectedAsset: intent.asset,
    });
    return rebuilt.functionName === intent.functionName
      && rebuilt.poolId === intent.poolId
      && rebuilt.amountBaseUnits === intent.amountBaseUnits
      && rebuilt.data.toLowerCase() === intent.data.toLowerCase()
      && sameArgs(rebuilt.args, intent.args);
  } catch {
    return false;
  }
}

function receiptStatus(value: unknown): "success" | "reverted" | "unknown" {
  if (value === "success" || value === 1) return "success";
  if (value === "reverted" || value === 0) return "reverted";
  return "unknown";
}

/**
 * Injected viem writer seam. It is disabled unless both an explicit enable
 * flag and a client are supplied. Every write is bound to a fresh preflight,
 * an unexpired approval, the configured contract, and a successful receipt.
 */
export function createViemAgonEscrowTransactionWriter(options: {
  enabled: boolean;
  client?: AgonEscrowTransactionWriteClient;
  escrowAddress: string;
  receiptTimeoutMs?: number;
}): AgonEscrowTransactionWriter {
  const configuredContract = address(options.escrowAddress);
  const timeoutMs = Math.max(500, Math.min(options.receiptTimeoutMs ?? RECEIPT_TIMEOUT_MS, 120_000));
  const enabled = options.enabled === true && options.client !== undefined && configuredContract !== null;

  return {
    enabled,
    async submit(input): Promise<AgonEscrowTransactionWriteResult> {
      if (!enabled || !options.client || !configuredContract) return failure("transaction_disabled", "Agon escrow transaction writing is disabled by policy");
      if (input.preflight.status !== "preflight_passed" || !input.preflight.codePresent || !input.preflight.controllerAuthorized || !verifyIntent(input)) {
        return failure("transaction_not_ready", "a valid read-only PrizeEscrow preflight is required");
      }
      const checked = validateAgonEscrowTransactionApproval({
        approval: input.approval,
        preflight: input.preflight,
        intentId: input.intentId,
        actor: input.actor,
        nowSeconds: input.nowSeconds,
      });
      if (!checked.ok) return failure("transaction_not_ready", checked.error.message);

      const intent = input.preflight.intent;
      const controller = address(intent.controller);
      if (!controller) return failure("transaction_not_ready", "the preflighted PrizeEscrow controller is invalid");
      if (address(intent.escrowAddress) !== configuredContract) return failure("transaction_not_ready", "transaction intent is not pinned to the configured PrizeEscrow contract");

      let transactionHash: `0x${string}`;
      try {
        const sent = await options.client.writeContract({
          address: configuredContract,
          abi: PRIZE_ESCROW_WRITE_ABI,
          functionName: intent.functionName,
          args: intent.args,
          account: controller,
        });
        const normalized = hash(sent);
        if (!normalized) return failure("transaction_unknown", "the transaction provider returned no valid hash");
        transactionHash = normalized;
      } catch {
        return failure("transaction_unknown", "the transaction submission outcome is ambiguous; reconcile before retrying");
      }

      let receipt: Awaited<ReturnType<AgonEscrowTransactionWriteClient["waitForTransactionReceipt"]>>;
      try {
        receipt = await options.client.waitForTransactionReceipt({ hash: transactionHash, timeout: timeoutMs });
      } catch {
        return failure("transaction_unknown", "the transaction receipt outcome is unavailable; reconcile before retrying");
      }
      if (receipt.transactionHash && hash(receipt.transactionHash) !== transactionHash) return failure("transaction_unknown", "receipt hash does not match the submitted transaction");
      if (!receipt.to || address(receipt.to) !== configuredContract) return failure("transaction_unknown", "receipt is not for the configured PrizeEscrow contract");
      const status = receiptStatus(receipt.status);
      if (status === "reverted") return failure("transaction_reverted", "PrizeEscrow transaction reverted");
      if (status !== "success") return failure("transaction_unknown", "receipt did not prove a successful transaction");
      return { ok: true, value: { providerReference: null, transaction: transactionHash } };
    },
  };
}
