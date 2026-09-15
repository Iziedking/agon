import { getAddress } from "viem";
import {
  AGON_JOB_ESCROW_ABI,
  AGON_JOB_ESCROW_CHAIN_ID,
  buildAgonJobEscrowWritePlan,
  validateAgonJobEscrowReceipt,
  type AgonJobEscrowAction,
  type AgonJobEscrowContractVersion,
  type AgonJobEscrowReceipt,
  type AgonJobEscrowWritePlan,
} from "./agon-job-escrow.ts";
import type { AgonJobEscrowIntent } from "./job-escrow-state.ts";

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const RECEIPT_TIMEOUT_MS = 30_000;

export type AgonJobEscrowTransactionWriteClient = {
  writeContract(input: {
    address: `0x${string}`;
    abi: typeof AGON_JOB_ESCROW_ABI;
    functionName: string;
    args: readonly unknown[];
    account: `0x${string}`;
  }): Promise<`0x${string}`>;
  waitForTransactionReceipt(input: {
    hash: `0x${string}`;
    timeout?: number;
  }): Promise<AgonJobEscrowReceipt>;
};

export type AgonJobEscrowTransactionWriterInput = {
  intent: AgonJobEscrowIntent;
  action: AgonJobEscrowAction;
  actor: string;
  /** Optional lifecycle arguments. Create values come from the durable intent. */
  jobId?: string | bigint;
  deliverableHash?: string;
  reasonHash?: string;
  /** Resolver decision; required for resolve_pay/resolve_refund. */
  nowSeconds?: number;
};

export type AgonJobEscrowTransactionWriteErrorCode =
  | "transaction_disabled"
  | "transaction_not_ready"
  | "transaction_unknown"
  | "transaction_reverted";

export type AgonJobEscrowTransactionWriteResult =
  | { ok: true; value: { transaction: `0x${string}`; action: AgonJobEscrowAction; event: string } }
  | { ok: false; error: { code: AgonJobEscrowTransactionWriteErrorCode; message: string } };

export type AgonJobEscrowTransactionWriter = {
  readonly enabled: boolean;
  submit(input: AgonJobEscrowTransactionWriterInput): Promise<AgonJobEscrowTransactionWriteResult>;
};

function fail(code: AgonJobEscrowTransactionWriteErrorCode, message: string): AgonJobEscrowTransactionWriteResult {
  return { ok: false, error: { code, message } };
}

function address(value: unknown): `0x${string}` | null {
  if (typeof value !== "string" || !ADDRESS.test(value)) return null;
  try { return getAddress(value).toLowerCase() as `0x${string}`; } catch { return null; }
}

function hash(value: unknown): `0x${string}` | null {
  return typeof value === "string" && HASH.test(value) ? value.toLowerCase() as `0x${string}` : null;
}

function planFor(input: AgonJobEscrowTransactionWriterInput): AgonJobEscrowWritePlan {
  const intent = input.intent;
  return buildAgonJobEscrowWritePlan({
    contractAddress: intent.escrowContract,
    action: input.action,
    clientReference: intent.clientReference,
    listingId: intent.listingId,
    termsHash: intent.termsHash,
    amountBaseUnits: intent.amountBaseUnits,
    feeBps: intent.feeBps,
    reviewHours: intent.reviewHours,
    jobId: input.jobId ?? intent.onchainJobId ?? undefined,
    deliverableHash: input.deliverableHash ?? intent.deliverableHash ?? undefined,
    reasonHash: input.reasonHash ?? intent.reasonHash ?? undefined,
  });
}

/**
 * A signer-injected, fail-closed writer for the deployed AgonJobEscrow ABI.
 * The server never creates a signer. Production remains disabled until an
 * explicitly configured client and enable flag are supplied by the operator.
 */
export function createViemAgonJobEscrowTransactionWriter(options: {
  enabled: boolean;
  client?: AgonJobEscrowTransactionWriteClient;
  escrowAddress: string;
  escrowVersion?: AgonJobEscrowContractVersion;
  receiptTimeoutMs?: number;
  allowedActors?: readonly string[];
}): AgonJobEscrowTransactionWriter {
  const configuredContract = address(options.escrowAddress);
  const rawAllowed = options.allowedActors ?? [];
  const allowedValues = rawAllowed.map((value) => address(value));
  const allowed = new Set(allowedValues.filter((value): value is `0x${string}` => value !== null));
  const timeoutMs = Math.max(500, Math.min(options.receiptTimeoutMs ?? RECEIPT_TIMEOUT_MS, 120_000));
  const enabled = options.enabled === true && options.client !== undefined && configuredContract !== null && allowedValues.every((value) => value !== null);

  return {
    enabled,
    async submit(input): Promise<AgonJobEscrowTransactionWriteResult> {
      if (!enabled || !options.client || !configuredContract) return fail("transaction_disabled", "AgonJobEscrow transaction writing is disabled by policy");
      const actor = address(input.actor);
      if (!actor || (allowed.size > 0 && !allowed.has(actor))) return fail("transaction_not_ready", "the transaction actor is not allowlisted");
      if (input.intent.network !== "eip155:5042002" || input.intent.state === "complete" || input.intent.state === "rejected" || input.intent.state === "failed") {
        return fail("transaction_not_ready", "the intent is not eligible for a lifecycle write");
      }
      const intentContract = address(input.intent.escrowContract);
      if (!intentContract || intentContract !== configuredContract) return fail("transaction_not_ready", "intent is pinned to a different AgonJobEscrow contract");
      if (actor !== input.intent.actor.toLowerCase() && actor !== input.intent.buyer.toLowerCase() && actor !== input.intent.provider.toLowerCase()) {
        return fail("transaction_not_ready", "actor is not a party to the escrow intent");
      }
      let plan: AgonJobEscrowWritePlan;
      try { plan = planFor(input); } catch (error) { return fail("transaction_not_ready", error instanceof Error ? error.message : "invalid AgonJobEscrow lifecycle arguments"); }
      if (plan.chainId !== AGON_JOB_ESCROW_CHAIN_ID || plan.execution !== "disabled" || plan.contractAddress !== configuredContract) return fail("transaction_not_ready", "invalid AgonJobEscrow transaction plan");
      if (plan.action !== input.action || !/^0x[0-9a-f]+$/i.test(plan.data) || plan.data.length < 10) return fail("transaction_not_ready", "transaction plan integrity check failed");

      let transactionHash: `0x${string}`;
      try {
        const sent = await options.client.writeContract({ address: configuredContract, abi: AGON_JOB_ESCROW_ABI, functionName: plan.functionName, args: plan.args, account: actor });
        transactionHash = hash(sent) ?? (() => { throw new Error("invalid transaction hash"); })();
      } catch { return fail("transaction_unknown", "transaction submission outcome is ambiguous; reconcile before retrying"); }
      let receipt: AgonJobEscrowReceipt;
      try { receipt = await options.client.waitForTransactionReceipt({ hash: transactionHash, timeout: timeoutMs }); }
      catch { return fail("transaction_unknown", "transaction receipt outcome is unavailable; reconcile before retrying"); }
      const checked = validateAgonJobEscrowReceipt({ receipt, contractAddress: configuredContract, action: input.action, transactionHash, jobId: input.jobId ?? input.intent.onchainJobId ?? undefined, contractVersion: options.escrowVersion });
      if (!checked.ok) {
        if (checked.code === "receipt_reverted") return fail("transaction_reverted", checked.message);
        return fail(checked.code === "receipt_unknown" ? "transaction_unknown" : "transaction_not_ready", checked.message);
      }
      return { ok: true, value: { transaction: checked.transactionHash, action: input.action, event: checked.event } };
    },
  };
}
