import type { StoredX402CallReceipt } from "../store/repository.ts";
import { evaluateX402ExecutionPolicy, type X402ExecutionPolicy } from "./x402-policy.ts";
import {
  validateX402SettlementRequest,
  type X402SettlementRequest,
  type X402SettlementResult,
} from "./x402-settlement.ts";
import type { X402ReceiptEvent } from "./x402-receipt.ts";

export type X402SettlementStore = {
  getX402CallReceipt(intentId: string): Promise<StoredX402CallReceipt | null>;
  advanceX402CallReceipt(intentId: string, event: X402ReceiptEvent): Promise<StoredX402CallReceipt>;
};

export type X402SettlementAdapter = {
  settle(input: X402SettlementRequest): Promise<X402SettlementResult>;
};

export type X402ReceiptVerification = {
  status: "confirmed" | "pending" | "failed";
  network: string;
  transaction?: string | null;
  providerTransferId?: string | null;
};

export type X402OrchestrationErrorCode =
  | "execution_disabled"
  | "execution_not_ready"
  | "reconciliation_required"
  | "settlement_unknown";

export type X402OrchestrationResult =
  | {
      ok: true;
      state: "settlement_submitted";
      receipt: StoredX402CallReceipt;
      transaction: `0x${string}` | null;
      serviceDeliveryPending: true;
      delivery?: NonNullable<Extract<X402SettlementResult, { ok: true }>["value"]["delivery"]>;
    }
  | {
      ok: false;
      error: { code: X402OrchestrationErrorCode; message: string };
      receipt: StoredX402CallReceipt | null;
    };

export type X402ReconciliationResult =
  | { ok: true; state: "settlement_submitted" | "service_delivered" | "reconciled" | "unknown" | "failed"; receipt: StoredX402CallReceipt }
  | { ok: false; error: { code: X402OrchestrationErrorCode; message: string }; receipt: StoredX402CallReceipt | null };

function failure(
  code: X402OrchestrationErrorCode,
  message: string,
  receipt: StoredX402CallReceipt | null,
): X402OrchestrationResult {
  return { ok: false, error: { code, message }, receipt };
}

function isTransaction(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

function attemptReference(input: X402SettlementRequest): string {
  return `agon-x402:${input.approval.intentId}:${input.approval.approvalHash.toLowerCase()}`;
}

/**
 * Durable settlement coordinator. It deliberately stops at
 * `settlement_submitted`: a facilitator receipt proves payment submission, not
 * successful service delivery. A later, separately authenticated service call
 * must record `service_delivered` before the receipt can be reconciled.
 */
export function createX402SettlementOrchestrator(options: {
  store: X402SettlementStore;
  adapter: X402SettlementAdapter;
  policy: X402ExecutionPolicy;
}) {
  async function settle(input: X402SettlementRequest): Promise<X402OrchestrationResult> {
    const current = await options.store.getX402CallReceipt(input.approval.intentId);
    if (!current) return failure("execution_not_ready", "x402 receipt does not exist", null);
    if (current.state === "settlement_submitted") {
      return { ok: true, state: "settlement_submitted", receipt: current, transaction: isTransaction(current.settlementRef ?? "") ? current.settlementRef as `0x${string}` : null, serviceDeliveryPending: true };
    }
    if (current.state === "unknown") {
      return failure("reconciliation_required", "the previous settlement attempt is ambiguous; reconcile it before retrying", current);
    }
    if (current.state !== "authorization_submitted") {
      return failure("execution_not_ready", `x402 receipt is ${current.state}; authorization must be submitted first`, current);
    }

    const checked = validateX402SettlementRequest(input);
    if (!checked.ok) return failure("execution_not_ready", checked.error.message, current);
    const policy = evaluateX402ExecutionPolicy(options.policy, input.plan);
    if (!policy.ok) return failure(policy.code, policy.message, current);

    const marker = attemptReference(input);
    let marked: StoredX402CallReceipt;
    try {
      marked = await options.store.advanceX402CallReceipt(input.approval.intentId, {
        type: "settlement_submitted",
        settlementRef: marker,
      });
    } catch {
      const raced = await options.store.getX402CallReceipt(input.approval.intentId);
      if (raced?.state === "settlement_submitted") {
        return { ok: true, state: "settlement_submitted", receipt: raced, transaction: isTransaction(raced.settlementRef ?? "") ? raced.settlementRef as `0x${string}` : null, serviceDeliveryPending: true };
      }
      return failure("execution_not_ready", "could not durably mark the settlement attempt", raced);
    }

    let result: X402SettlementResult;
    try {
      result = await options.adapter.settle(input);
    } catch {
      result = { ok: false, error: { code: "facilitator_unavailable", message: "facilitator call failed" } };
    }
    if (!result.ok) {
      let unknown = marked;
      try {
        unknown = await options.store.advanceX402CallReceipt(input.approval.intentId, {
          type: "mark_unknown",
          failureCode: result.error.code,
          failureMessage: "facilitator outcome is not trusted; reconciliation is required",
        });
      } catch {
        // Keep the durable submitted marker. A caller must reconcile rather
        // than risk a duplicate payment when the database is unavailable.
      }
      return failure("settlement_unknown", "facilitator outcome is ambiguous; reconcile before retrying", unknown);
    }

    if ((!isTransaction(result.value.transaction ?? "") && !result.value.providerTransferId) || result.value.network !== options.policy.network) {
      let unknown = marked;
      try {
        unknown = await options.store.advanceX402CallReceipt(input.approval.intentId, {
          type: "mark_unknown",
          failureCode: "invalid_facilitator_receipt",
          failureMessage: "facilitator returned an invalid or wrong-network receipt",
        });
      } catch {
        // Preserve the pre-call marker and require manual reconciliation.
      }
      return failure("settlement_unknown", "facilitator returned an invalid receipt; reconciliation is required", unknown);
    }

    try {
      const receipt = await options.store.advanceX402CallReceipt(input.approval.intentId, {
        type: "settlement_receipt",
        ...(result.value.transaction ? { settlementRef: result.value.transaction } : {}),
        ...(result.value.providerTransferId ? { providerTransferId: result.value.providerTransferId } : {}),
      });
      return { ok: true, state: "settlement_submitted", receipt, transaction: result.value.transaction, serviceDeliveryPending: true, ...(result.value.delivery ? { delivery: result.value.delivery } : {}) };
    } catch {
      return failure("settlement_unknown", "payment was submitted but its receipt could not be durably recorded", marked);
    }
  }

  async function reconcile(intentId: string, verification: X402ReceiptVerification): Promise<X402ReconciliationResult> {
    const current = await options.store.getX402CallReceipt(intentId);
    if (!current) return { ok: false, error: { code: "execution_not_ready", message: "x402 receipt does not exist" }, receipt: null };
    if (current.state === "reconciled" || current.state === "failed") return { ok: true, state: current.state, receipt: current };
    if (current.state !== "unknown" && current.state !== "settlement_submitted" && current.state !== "service_delivered") {
      return { ok: false, error: { code: "execution_not_ready", message: `x402 receipt is ${current.state}; settlement reconciliation is not applicable` }, receipt: current };
    }
    if (verification.network !== options.policy.network || (!isTransaction(verification.transaction ?? "") && !verification.providerTransferId)) {
      return { ok: false, error: { code: "execution_not_ready", message: "reconciliation receipt is not valid Arc Testnet evidence" }, receipt: current };
    }
    if (current.settlementRef && isTransaction(current.settlementRef) && (!verification.transaction || current.settlementRef.toLowerCase() !== verification.transaction.toLowerCase())) {
      return { ok: false, error: { code: "execution_not_ready", message: "reconciliation transaction does not match the recorded settlement" }, receipt: current };
    }
    if (current.providerTransferId && current.providerTransferId.toLowerCase() !== (verification.providerTransferId ?? "").toLowerCase()) {
      return { ok: false, error: { code: "execution_not_ready", message: "reconciliation provider transfer does not match the recorded settlement" }, receipt: current };
    }
    try {
      if (verification.status === "pending") return { ok: true, state: current.state, receipt: current };
      if (verification.status === "failed") {
        if (current.state === "service_delivered") {
          return { ok: false, error: { code: "reconciliation_required", message: "payment failure evidence conflicts with recorded service delivery" }, receipt: current };
        }
        const failed = await options.store.advanceX402CallReceipt(intentId, { type: "fail", failureCode: "settlement_failed", failureMessage: "Arc Testnet reconciliation confirmed settlement failure" });
        return { ok: true, state: "failed", receipt: failed };
      }
      if (current.state === "service_delivered") {
        const reconciled = await options.store.advanceX402CallReceipt(intentId, {
          type: "reconcile",
          ...(verification.transaction ? { settlementRef: verification.transaction } : {}),
          ...(verification.providerTransferId ? { providerTransferId: verification.providerTransferId } : {}),
        });
        return { ok: true, state: "reconciled", receipt: reconciled };
      }
      const confirmed = await options.store.advanceX402CallReceipt(intentId, {
        type: "settlement_receipt",
        ...(verification.transaction ? { settlementRef: verification.transaction } : {}),
        ...(verification.providerTransferId ? { providerTransferId: verification.providerTransferId } : {}),
      });
      return { ok: true, state: "settlement_submitted", receipt: confirmed };
    } catch {
      return { ok: false, error: { code: "reconciliation_required", message: "reconciliation evidence could not be recorded; retry safely" }, receipt: current };
    }
  }

  return { settle, reconcile };
}
