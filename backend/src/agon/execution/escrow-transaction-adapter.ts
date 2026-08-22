import type { StoredAgonEscrowIntent, StoredAgonEscrowTransactionApproval } from "../store/repository.ts";
import type { AgonEscrowAdapter, AgonEscrowResult } from "../escrow-policy.ts";
import type { AgonEscrowLifecycleAction } from "./escrow-orchestrator.ts";
import type { AgonEscrowTransactionApproval } from "./escrow-transaction-approval.ts";
import type { AgonEscrowTransactionWriter } from "./escrow-transaction-writer.ts";
import type { AgonPrizeEscrowWritePreflightAdapter, AgonPrizeEscrowWritePreflightResult } from "./escrow-write-preflight.ts";

type EscrowTransactionStore = {
  getAgonEscrowIntent(intentId: string): Promise<StoredAgonEscrowIntent | null>;
  getAgonEscrowTransactionApproval(intentId: string): Promise<StoredAgonEscrowTransactionApproval | null>;
};

const disabledResult = (): AgonEscrowResult<{ providerReference: null; transaction: null }> => ({
  ok: false,
  error: { code: "escrow_disabled", message: "Agon escrow transaction writing is disabled by policy" },
});

function approvalFromRow(row: StoredAgonEscrowTransactionApproval): AgonEscrowTransactionApproval {
  return {
    approvalHash: row.approvalHash as `0x${string}`,
    intentId: row.intentId,
    actor: row.actor as `0x${string}`,
    operation: row.operation,
    intentHash: row.intentHash as `0x${string}`,
    approvalIdempotencyKey: row.approvalIdempotencyKey,
    testnetOnly: true,
    approvedAt: row.approvedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    executionEnabled: false,
    nextAction: "transaction_adapter_not_enabled",
  };
}

function operationParticipant(intent: StoredAgonEscrowIntent, operation: AgonEscrowLifecycleAction): `0x${string}` {
  return operation === "release" ? intent.terms.beneficiary : intent.terms.buyer;
}

function unavailable(message: string, code: "escrow_reverted" | "escrow_unavailable" = "escrow_unavailable"): AgonEscrowResult<{ providerReference: null; transaction: null }> {
  return { ok: false, error: { code, message } };
}

/**
 * Bridges the durable lifecycle orchestrator to the separately approved
 * transaction writer. It performs no writes itself; the orchestrator owns the
 * pending marker and converts ambiguous writer outcomes to `unknown`.
 */
export function createApprovalBoundAgonEscrowTransactionAdapter(options: {
  store: EscrowTransactionStore;
  preflight: AgonPrizeEscrowWritePreflightAdapter;
  writer: AgonEscrowTransactionWriter;
  enabled: boolean;
}): AgonEscrowAdapter {
  const enabled = options.enabled === true && options.preflight.enabled && options.writer.enabled;

  async function execute(intentId: string, operation: AgonEscrowLifecycleAction): Promise<AgonEscrowResult<{ providerReference: string | null; transaction: `0x${string}` | null }>> {
    if (!enabled) return disabledResult();
    const intent = await options.store.getAgonEscrowIntent(intentId);
    if (!intent || !intent.poolBinding) return unavailable("a bound PrizeEscrow intent is required before transaction writing");
    const row = await options.store.getAgonEscrowTransactionApproval(intentId);
    if (!row) return unavailable("a durable transaction approval is required before transaction writing");
    if (row.operation !== operation) return unavailable("the durable approval operation does not match the requested lifecycle action");
    if (row.expiresAt.getTime() <= Date.now()) return unavailable("the durable transaction approval is expired");

    let checked: AgonPrizeEscrowWritePreflightResult;
    try {
      checked = await options.preflight.preflight({
        network: intent.terms.network,
        escrowAddress: intent.poolBinding.contractAddress,
        controller: intent.poolBinding.controller,
        operation,
        poolId: intent.poolBinding.poolId,
        amountBaseUnits: intent.terms.amountBaseUnits,
        participant: operationParticipant(intent, operation),
        expectedAsset: intent.terms.asset,
      });
    } catch (error) {
      return unavailable(error instanceof Error ? error.message : "PrizeEscrow write preflight failed");
    }

    const result = await options.writer.submit({
      intentId,
      actor: row.actor,
      preflight: checked,
      approval: approvalFromRow(row),
    });
    if (!result.ok) return unavailable(result.error.message, result.error.code === "transaction_reverted" ? "escrow_reverted" : "escrow_unavailable");
    return { ok: true, value: result.value };
  }

  return {
    enabled,
    fund: ({ intentId }) => execute(intentId, "fund"),
    release: ({ intentId }) => execute(intentId, "release"),
    refund: ({ intentId }) => execute(intentId, "refund"),
  };
}
