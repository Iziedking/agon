import { getAddress } from "viem";

/**
 * Arc Testnet is deliberately pinned for the first machine-to-machine rail.
 * Circle's native wallet spending-policy API is mainnet-only, so this module
 * is the local, deterministic safety boundary used before any future wallet
 * provider adapter is allowed to execute a payment.
 */
export const AGON_X402_AGENT_POLICY_NETWORK = "eip155:5042002" as const;

const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type X402AgentWalletPolicy = {
  agentId: string;
  walletId: string | null;
  walletAddress: `0x${string}` | null;
  network: typeof AGON_X402_AGENT_POLICY_NETWORK;
  enabled: boolean;
  perCallCapBaseUnits: bigint;
  dailyCapBaseUnits: bigint;
  allowedRecipients?: readonly `0x${string}`[];
};

export type X402AgentSpendState = "reserved" | "submitted" | "unknown" | "confirmed" | "failed";

export type X402AgentSpendRecord = {
  agentId: string;
  idempotencyKey: string;
  day: string;
  amountBaseUnits: bigint;
  recipient: `0x${string}`;
  state: X402AgentSpendState;
  createdAt: Date;
  updatedAt: Date;
  providerTransferId?: string | null;
  transaction?: `0x${string}` | null;
};

export type X402AgentPolicyErrorCode =
  | "wallet_policy_disabled"
  | "wallet_not_ready"
  | "invalid_spend"
  | "idempotency_conflict"
  | "wallet_cap_exceeded"
  | "recipient_not_allowed"
  | "policy_invalid";

export type X402AgentPolicyError = {
  code: X402AgentPolicyErrorCode;
  message: string;
};

export type X402AgentReserveInput = {
  agentId: string;
  idempotencyKey: string;
  amountBaseUnits: string | bigint;
  recipient: string;
  now?: Date;
};

export type X402AgentReserveResult =
  | {
      ok: true;
      decision: "reserved" | "idempotent_replay";
      record: X402AgentSpendRecord;
      remainingDailyBaseUnits: bigint;
    }
  | { ok: false; error: X402AgentPolicyError };

export type X402AgentSpendTransitionInput = {
  agentId: string;
  idempotencyKey: string;
  state: Exclude<X402AgentSpendState, "reserved">;
  now?: Date;
  providerTransferId?: string | null;
  transaction?: `0x${string}` | null;
};

type MaybePromise<T> = T | Promise<T>;

/** The executor depends on this contract, not on an in-memory implementation. */
export type X402AgentWalletPolicyStore = {
  setPolicy(policy: X402AgentWalletPolicy): MaybePromise<void>;
  getPolicy(agentId: string): MaybePromise<X402AgentWalletPolicy | null>;
  getSpend(agentId: string, idempotencyKey: string): MaybePromise<X402AgentSpendRecord | null>;
  reserve(input: X402AgentReserveInput): MaybePromise<X402AgentReserveResult>;
  transition(input: X402AgentSpendTransitionInput): MaybePromise<{ ok: true; record: X402AgentSpendRecord } | { ok: false; error: X402AgentPolicyError }>;
};

function parseAmount(value: string | bigint): bigint | null {
  try {
    const parsed = typeof value === "bigint" ? value : /^\d+$/.test(value) ? BigInt(value) : null;
    return parsed !== null && parsed > 0n ? parsed : null;
  } catch {
    return null;
  }
}

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function normalizeAddress(value: string): `0x${string}` | null {
  try {
    return getAddress(value) as `0x${string}`;
  } catch {
    return null;
  }
}

function policyError(code: X402AgentPolicyErrorCode, message: string): { ok: false; error: X402AgentPolicyError } {
  return { ok: false, error: { code, message } };
}

export function validateX402AgentWalletPolicy(policy: X402AgentWalletPolicy): X402AgentPolicyError | null {
  if (!AGENT_ID.test(policy.agentId)) return { code: "policy_invalid", message: "agent policy id is invalid" };
  if (policy.network !== AGON_X402_AGENT_POLICY_NETWORK) return { code: "policy_invalid", message: "agent wallet policy is restricted to Arc Testnet" };
  if (policy.perCallCapBaseUnits <= 0n || policy.dailyCapBaseUnits <= 0n || policy.perCallCapBaseUnits > policy.dailyCapBaseUnits) {
    return { code: "policy_invalid", message: "agent wallet caps must be positive and per-call must not exceed daily" };
  }
  if (policy.walletId === null || !policy.walletAddress) {
    return { code: "wallet_not_ready", message: "agent Circle wallet is not provisioned" };
  }
  if (!normalizeAddress(policy.walletAddress)) return { code: "policy_invalid", message: "agent wallet address is invalid" };
  if (policy.allowedRecipients?.some((recipient) => !normalizeAddress(recipient))) {
    return { code: "policy_invalid", message: "agent recipient policy contains an invalid address" };
  }
  return null;
}

function activeSpend(record: X402AgentSpendRecord): boolean {
  // Unknown outcomes stay reserved. Releasing that amount would make a retry
  // capable of exceeding the cap or paying twice.
  return record.state !== "failed";
}

function spendKey(agentId: string, idempotencyKey: string): string {
  // Both identifiers deliberately allow ':'; length-prefixing prevents
  // ambiguous map keys such as (agent=a, key=b:c) and (agent=a:b, key=c).
  return `${agentId.length}:${agentId}:${idempotencyKey}`;
}

/**
 * In-memory implementation used by local orchestration and adversarial tests.
 * Production persistence must provide the same atomic reserve semantics before
 * wiring a Circle wallet adapter; this class intentionally performs no I/O.
 */
export class X402AgentWalletPolicyLedger {
  private readonly policies = new Map<string, X402AgentWalletPolicy>();
  private readonly spends = new Map<string, X402AgentSpendRecord>();

  constructor(policies: readonly X402AgentWalletPolicy[] = []) {
    for (const policy of policies) this.setPolicy(policy);
  }

  setPolicy(policy: X402AgentWalletPolicy): void {
    this.policies.set(policy.agentId, {
      ...policy,
      // Preserve invalid values until validation so a malformed policy fails
      // closed instead of being silently widened into a different policy.
      walletAddress: policy.walletAddress ?? null,
      allowedRecipients: policy.allowedRecipients ? [...policy.allowedRecipients] : undefined,
    });
  }

  getPolicy(agentId: string): X402AgentWalletPolicy | null {
    return this.policies.get(agentId) ?? null;
  }

  getSpend(agentId: string, idempotencyKey: string): X402AgentSpendRecord | null {
    return this.spends.get(spendKey(agentId, idempotencyKey)) ?? null;
  }

  listSpends(agentId: string, day: string): X402AgentSpendRecord[] {
    return [...this.spends.values()].filter((record) => record.agentId === agentId && record.day === day);
  }

  reserve(input: X402AgentReserveInput): X402AgentReserveResult {
    const policy = this.policies.get(input.agentId);
    if (!policy || !policy.enabled) return policyError("wallet_policy_disabled", "agent wallet spending policy is disabled");
    const policyIssue = validateX402AgentWalletPolicy(policy);
    if (policyIssue) return { ok: false, error: policyIssue };
    if (!IDEMPOTENCY_KEY.test(input.idempotencyKey)) return policyError("invalid_spend", "spend idempotency key must be 8-128 safe characters");
    const amount = parseAmount(input.amountBaseUnits);
    if (amount === null) return policyError("invalid_spend", "spend amount must be a positive integer base-unit value");
    const recipient = normalizeAddress(input.recipient);
    if (!recipient) return policyError("invalid_spend", "spend recipient must be a valid EVM address");
    const now = input.now ?? new Date();
    if (!Number.isFinite(now.getTime())) return policyError("invalid_spend", "spend timestamp is invalid");
    const day = utcDay(now);
    const key = spendKey(input.agentId, input.idempotencyKey);
    const existing = this.spends.get(key);
    if (existing) {
      if (existing.amountBaseUnits !== amount || existing.recipient.toLowerCase() !== recipient.toLowerCase() || existing.day !== day) {
        return policyError("idempotency_conflict", "spend idempotency key is already bound to different economics");
      }
      return {
        ok: true,
        decision: "idempotent_replay",
        record: existing,
        remainingDailyBaseUnits: this.remaining(policy, input.agentId, day),
      };
    }
    if (amount > policy.perCallCapBaseUnits) return policyError("wallet_cap_exceeded", "spend exceeds the agent per-call cap");
    if (policy.allowedRecipients?.length && !policy.allowedRecipients.some((allowed) => allowed.toLowerCase() === recipient.toLowerCase())) {
      return policyError("recipient_not_allowed", "spend recipient is not approved by the agent policy");
    }
    const remaining = this.remaining(policy, input.agentId, day);
    if (amount > remaining) return policyError("wallet_cap_exceeded", "spend exceeds the agent daily cap");
    const record: X402AgentSpendRecord = {
      agentId: input.agentId,
      idempotencyKey: input.idempotencyKey,
      day,
      amountBaseUnits: amount,
      recipient,
      state: "reserved",
      createdAt: now,
      updatedAt: now,
      providerTransferId: null,
      transaction: null,
    };
    this.spends.set(key, record);
    return { ok: true, decision: "reserved", record, remainingDailyBaseUnits: remaining - amount };
  }

  transition(input: X402AgentSpendTransitionInput): { ok: true; record: X402AgentSpendRecord } | { ok: false; error: X402AgentPolicyError } {
    const record = this.spends.get(spendKey(input.agentId, input.idempotencyKey));
    if (!record) return policyError("invalid_spend", "spend reservation does not exist");
    const now = input.now ?? new Date();
    if (!Number.isFinite(now.getTime())) return policyError("invalid_spend", "spend timestamp is invalid");
    if (record.state === "failed" && input.state !== "failed") return policyError("invalid_spend", "failed spend reservations are terminal");
    if (record.state === "confirmed" && input.state !== "confirmed") return policyError("invalid_spend", "confirmed spend reservations are terminal");
    const allowedTransitions: Record<X402AgentSpendState, readonly X402AgentSpendState[]> = {
      reserved: ["submitted", "unknown", "failed"],
      submitted: ["confirmed", "unknown", "failed"],
      unknown: ["confirmed", "failed"],
      confirmed: ["confirmed"],
      failed: ["failed"],
    };
    if (!allowedTransitions[record.state].includes(input.state)) {
      return policyError("invalid_spend", `cannot transition spend from ${record.state} to ${input.state}`);
    }
    record.state = input.state;
    record.updatedAt = now;
    if (input.providerTransferId !== undefined) record.providerTransferId = input.providerTransferId;
    if (input.transaction !== undefined) record.transaction = input.transaction;
    return { ok: true, record };
  }

  private remaining(policy: X402AgentWalletPolicy, agentId: string, day: string): bigint {
    const used = this.listSpends(agentId, day).filter(activeSpend).reduce((sum, record) => sum + record.amountBaseUnits, 0n);
    return policy.dailyCapBaseUnits > used ? policy.dailyCapBaseUnits - used : 0n;
  }
}

export type X402AgentWalletSettlementAdapter = {
  enabled: boolean;
  settle(input: {
    agentId: string;
    walletId: string;
    recipient: `0x${string}`;
    amountBaseUnits: bigint;
    idempotencyKey: string;
  }): Promise<{
    ok: true;
    providerTransferId?: string | null;
    transaction?: `0x${string}` | null;
  } | { ok: false; error: { code: "wallet_disabled" | "wallet_unavailable"; message: string } }>;
};

/** No Circle SDK is constructed and no network request can escape this seam. */
export function createDisabledX402AgentWalletAdapter(): X402AgentWalletSettlementAdapter {
  return {
    enabled: false,
    async settle() {
      return { ok: false, error: { code: "wallet_disabled", message: "agent wallet execution is disabled by policy" } };
    },
  };
}
