import type { StoredAgonJobEscrowIntent } from "../store/repository.ts";
import type {
  AgonJobEscrowTransactionWriter,
  AgonJobEscrowTransactionWriterInput,
  AgonJobEscrowTransactionWriteResult,
} from "./agon-job-escrow-writer.ts";

export type AgonJobEscrowIntentStore = {
  getAgonJobEscrowIntent(intentId: string): Promise<StoredAgonJobEscrowIntent | null>;
  markAgonJobEscrowSubmitted(input: { intentId: string; transactionHash: `0x${string}` }): Promise<StoredAgonJobEscrowIntent>;
  recordAgonJobEscrowAction?(input: {
    intentId: string;
    action: AgonJobEscrowTransactionWriterInput["action"];
    transactionHash: `0x${string}`;
    jobId?: string | null;
    deliverableHash?: string | null;
    reasonHash?: string | null;
  }): Promise<StoredAgonJobEscrowIntent>;
};

export type AgonJobEscrowAdapterInput = Omit<AgonJobEscrowTransactionWriterInput, "intent"> & { intentId: string };

/**
 * Bridges durable intent state to the deployed-contract writer. It records a
 * transaction only after a receipt proves the expected event; unknown writes
 * stay unresolved so a reconciler can inspect the chain before retrying.
 */
export type AgonJobEscrowTransactionAdapter = {
  readonly enabled: boolean;
  submit(input: AgonJobEscrowAdapterInput): Promise<AgonJobEscrowTransactionWriteResult>;
};

export function createAgonJobEscrowTransactionAdapter(options: {
  enabled: boolean;
  repository: AgonJobEscrowIntentStore;
  writer: AgonJobEscrowTransactionWriter;
}): AgonJobEscrowTransactionAdapter {
  const enabled = options.enabled === true && options.writer.enabled;
  return {
    enabled,
    async submit(input) {
      if (!enabled) return { ok: false, error: { code: "transaction_disabled", message: "AgonJobEscrow transaction adapter is disabled by policy" } };
      const intent = await options.repository.getAgonJobEscrowIntent(input.intentId);
      if (!intent) return { ok: false, error: { code: "transaction_not_ready", message: "AgonJobEscrow intent not found" } };
      if (intent.actor !== input.actor.toLowerCase() && intent.buyer !== input.actor.toLowerCase() && intent.provider !== input.actor.toLowerCase()) {
        return { ok: false, error: { code: "transaction_not_ready", message: "actor is not a party to the escrow intent" } };
      }
      const result = await options.writer.submit({ ...input, intent });
      if (!result.ok) return result;
      try {
        if (options.repository.recordAgonJobEscrowAction) {
          await options.repository.recordAgonJobEscrowAction({
            intentId: intent.intentId,
            action: input.action,
            transactionHash: result.value.transaction,
            jobId: input.jobId ? String(input.jobId) : null,
            deliverableHash: input.deliverableHash ?? null,
            reasonHash: input.reasonHash ?? null,
          });
        } else {
          if (input.action !== "create") return { ok: false, error: { code: "transaction_unknown", message: "transaction succeeded but lifecycle evidence store is not configured; reconcile before retrying" } };
          await options.repository.markAgonJobEscrowSubmitted({ intentId: intent.intentId, transactionHash: result.value.transaction });
        }
      } catch {
        return { ok: false, error: { code: "transaction_unknown", message: "transaction succeeded but durable intent update failed; reconcile before retrying" } };
      }
      return result;
    },
  };
}
