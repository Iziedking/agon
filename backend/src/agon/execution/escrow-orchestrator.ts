import type { StoredAgonEscrowIntent } from "../store/repository.ts";
import type { AgonEscrowAdapter, AgonEscrowIntentState } from "../escrow-policy.ts";

export type AgonEscrowLifecycleStore = {
  getAgonEscrowIntent(intentId: string): Promise<StoredAgonEscrowIntent | null>;
  advanceAgonEscrowIntent(input: {
    intentId: string;
    state: Exclude<AgonEscrowIntentState, "prepared">;
    providerReference?: string | null;
    transaction?: `0x${string}` | null;
  }): Promise<StoredAgonEscrowIntent>;
};

export type AgonEscrowLifecycleAction = "fund" | "release" | "refund";

export type AgonEscrowLifecycleErrorCode =
  | "escrow_disabled"
  | "escrow_not_ready"
  | "escrow_unknown";

export type AgonEscrowLifecycleResult =
  | {
      ok: true;
      action: AgonEscrowLifecycleAction;
      state: "funded" | "released" | "refunded";
      intent: StoredAgonEscrowIntent;
    }
  | {
      ok: false;
      action: AgonEscrowLifecycleAction;
      error: { code: AgonEscrowLifecycleErrorCode; message: string };
      intent: StoredAgonEscrowIntent | null;
    };

function failure(
  action: AgonEscrowLifecycleAction,
  code: AgonEscrowLifecycleErrorCode,
  message: string,
  intent: StoredAgonEscrowIntent | null,
): AgonEscrowLifecycleResult {
  return { ok: false, action, error: { code, message }, intent };
}

function validTransaction(value: string | null | undefined): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function hasProviderEvidence(value: { providerReference?: string | null; transaction?: string | null }): boolean {
  return (typeof value.providerReference === "string" && value.providerReference.length > 0)
    || validTransaction(value.transaction);
}

function markerState(action: AgonEscrowLifecycleAction): "funding" | "release_pending" | "refund_pending" {
  if (action === "fund") return "funding";
  if (action === "release") return "release_pending";
  return "refund_pending";
}

function terminalState(action: AgonEscrowLifecycleAction): "funded" | "released" | "refunded" {
  if (action === "fund") return "funded";
  if (action === "release") return "released";
  return "refunded";
}

function readyState(action: AgonEscrowLifecycleAction): AgonEscrowIntentState {
  return action === "fund" ? "prepared" : "funded";
}

/**
 * Durable escrow lifecycle coordinator. It writes a pending marker before an
 * adapter call and converts every untrusted adapter outcome to `unknown`.
 * The default runtime never constructs or calls a provider adapter.
 */
export function createAgonEscrowLifecycleOrchestrator(options: {
  store: AgonEscrowLifecycleStore;
  adapter: AgonEscrowAdapter;
  enabled: boolean;
}) {
  async function execute(action: AgonEscrowLifecycleAction, intentId: string): Promise<AgonEscrowLifecycleResult> {
    let current = await options.store.getAgonEscrowIntent(intentId);
    if (!current) return failure(action, "escrow_not_ready", "escrow intent does not exist", null);
    if (current.state === terminalState(action)) {
      return { ok: true, action, state: terminalState(action), intent: current };
    }
    if (current.state === "unknown") {
      return failure(action, "escrow_unknown", "the previous escrow outcome is ambiguous; reconcile it before retrying", current);
    }
    if (current.state !== readyState(action)) {
      return failure(action, "escrow_not_ready", `escrow intent is ${current.state}; ${action} is not ready`, current);
    }
    if (!options.enabled || !options.adapter.enabled) {
      return failure(action, "escrow_disabled", "Agon escrow execution is disabled by policy", current);
    }

    let marked: StoredAgonEscrowIntent;
    try {
      marked = await options.store.advanceAgonEscrowIntent({ intentId, state: markerState(action) });
    } catch {
      const raced = await options.store.getAgonEscrowIntent(intentId);
      if (raced?.state === terminalState(action)) {
        return { ok: true, action, state: terminalState(action), intent: raced };
      }
      return failure(action, "escrow_not_ready", "could not durably mark the escrow attempt", raced);
    }

    let result: Awaited<ReturnType<AgonEscrowAdapter["fund"]>>;
    try {
      if (action === "fund") result = await options.adapter.fund({ intentId, terms: current.terms });
      else if (action === "release") result = await options.adapter.release({ intentId, beneficiary: current.terms.beneficiary, amountBaseUnits: current.terms.amountBaseUnits });
      else result = await options.adapter.refund({ intentId, buyer: current.terms.buyer, amountBaseUnits: current.terms.amountBaseUnits });
    } catch {
      result = { ok: false, error: { code: "escrow_unavailable", message: "escrow adapter call failed" } };
    }

    if (!result.ok || !hasProviderEvidence(result.value)) {
      let unknown = marked;
      try {
        unknown = await options.store.advanceAgonEscrowIntent({
          intentId,
          state: "unknown",
          providerReference: result.ok ? result.value.providerReference : null,
          transaction: result.ok && validTransaction(result.value.transaction) ? result.value.transaction : null,
        });
      } catch {
        // Preserve the pending marker. A caller must reconcile rather than
        // risk replaying an operation whose external outcome is not trusted.
      }
      return failure(action, "escrow_unknown", "escrow outcome is ambiguous; reconcile before retrying", unknown);
    }

    try {
      const completed = await options.store.advanceAgonEscrowIntent({
        intentId,
        state: terminalState(action),
        providerReference: result.value.providerReference,
        transaction: validTransaction(result.value.transaction) ? result.value.transaction : null,
      });
      current = completed;
      return { ok: true, action, state: terminalState(action), intent: completed };
    } catch {
      return failure(action, "escrow_unknown", "escrow completed but its result could not be durably recorded", marked);
    }
  }

  return {
    fund: (intentId: string) => execute("fund", intentId),
    release: (intentId: string) => execute("release", intentId),
    refund: (intentId: string) => execute("refund", intentId),
  };
}
