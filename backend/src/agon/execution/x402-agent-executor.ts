import {
  type X402AgentPolicyError,
  type X402AgentReserveInput,
  type X402AgentSpendRecord,
  type X402AgentWalletPolicyStore,
  type X402AgentWalletSettlementAdapter,
} from "./x402-agent-policy.ts";

export type X402AgentExecutionErrorCode =
  | "wallet_disabled"
  | "wallet_unavailable"
  | "wallet_unknown"
  | "wallet_reconciliation_required"
  | "wallet_failed_replay";

export type X402AgentExecutionError = {
  code: X402AgentExecutionErrorCode;
  message: string;
};

export type X402AgentExecutionResult =
  | {
      ok: true;
      decision: "submitted" | "idempotent_replay";
      record: X402AgentSpendRecord;
    }
  | {
      ok: false;
      error: X402AgentPolicyError | X402AgentExecutionError;
      record?: X402AgentSpendRecord;
    };

/**
 * Deterministic reserve-before-execute orchestration for agent-to-agent x402.
 * The default adapter is disabled, and no provider client is constructed here.
 * A future adapter must return only provider correlation data; confirmation is
 * a separate step after an independent receipt/state verification.
 */
export class X402AgentSpendExecutor {
  private readonly ledger: X402AgentWalletPolicyStore;
  private readonly adapter: X402AgentWalletSettlementAdapter;

  constructor(ledger: X402AgentWalletPolicyStore, adapter: X402AgentWalletSettlementAdapter) {
    this.ledger = ledger;
    this.adapter = adapter;
  }

  async execute(input: X402AgentReserveInput): Promise<X402AgentExecutionResult> {
    const reservation = await this.ledger.reserve(input);
    if (!reservation.ok) return { ok: false, error: reservation.error };

    if (reservation.decision === "idempotent_replay") {
      if (reservation.record.state === "confirmed") {
        return { ok: true, decision: "idempotent_replay", record: reservation.record };
      }
      if (reservation.record.state === "failed") {
        return {
          ok: false,
          error: { code: "wallet_failed_replay", message: "the idempotency key already completed with a terminal failure" },
          record: reservation.record,
        };
      }
      return {
        ok: false,
        error: { code: "wallet_reconciliation_required", message: "the idempotency key has an unresolved provider outcome" },
        record: reservation.record,
      };
    }

    const policy = await this.ledger.getPolicy(input.agentId);
    if (!policy?.walletId) {
      const failed = await this.ledger.transition({ agentId: input.agentId, idempotencyKey: input.idempotencyKey, state: "failed" });
      return {
        ok: false,
        error: { code: "wallet_disabled", message: "agent wallet execution is not provisioned" },
        record: failed.ok ? failed.record : reservation.record,
      };
    }
    if (!this.adapter.enabled) {
      const failed = await this.ledger.transition({ agentId: input.agentId, idempotencyKey: input.idempotencyKey, state: "failed" });
      return {
        ok: false,
        error: { code: "wallet_disabled", message: "agent wallet execution is disabled by policy" },
        record: failed.ok ? failed.record : reservation.record,
      };
    }

    let outcome: Awaited<ReturnType<X402AgentWalletSettlementAdapter["settle"]>>;
    try {
      outcome = await this.adapter.settle({
        agentId: input.agentId,
        walletId: policy.walletId,
        recipient: reservation.record.recipient,
        amountBaseUnits: reservation.record.amountBaseUnits,
        idempotencyKey: input.idempotencyKey,
      });
    } catch {
      const unknown = await this.ledger.transition({ agentId: input.agentId, idempotencyKey: input.idempotencyKey, state: "unknown" });
      return {
        ok: false,
        error: { code: "wallet_unknown", message: "wallet provider outcome is unknown; reconcile before retrying" },
        record: unknown.ok ? unknown.record : reservation.record,
      };
    }

    if (!outcome.ok) {
      const state = outcome.error.code === "wallet_disabled" ? "failed" : "unknown";
      const transitioned = await this.ledger.transition({ agentId: input.agentId, idempotencyKey: input.idempotencyKey, state });
      return {
        ok: false,
        error: outcome.error,
        record: transitioned.ok ? transitioned.record : reservation.record,
      };
    }

    const submitted = await this.ledger.transition({
      agentId: input.agentId,
      idempotencyKey: input.idempotencyKey,
      state: "submitted",
      providerTransferId: outcome.providerTransferId,
      transaction: outcome.transaction,
    });
    if (!submitted.ok) return { ok: false, error: submitted.error, record: reservation.record };
    return { ok: true, decision: "submitted", record: submitted.record };
  }

  async confirm(input: {
    agentId: string;
    idempotencyKey: string;
    now?: Date;
    transaction?: `0x${string}` | null;
  }): Promise<X402AgentExecutionResult> {
    const result = await this.ledger.transition({ ...input, state: "confirmed" });
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, decision: "idempotent_replay", record: result.record };
  }
}
