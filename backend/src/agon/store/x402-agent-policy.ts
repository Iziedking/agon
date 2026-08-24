import type { Pool, QueryResultRow } from "pg";
import { getAddress } from "viem";
import {
  AGON_X402_AGENT_POLICY_NETWORK,
  validateX402AgentWalletPolicy,
  type X402AgentPolicyError,
  type X402AgentReserveInput,
  type X402AgentReserveResult,
  type X402AgentSpendRecord,
  type X402AgentSpendState,
  type X402AgentSpendTransitionInput,
  type X402AgentWalletPolicy,
  type X402AgentWalletPolicyStore,
} from "../execution/x402-agent-policy.ts";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/i;

type PolicyRow = QueryResultRow & {
  agent_id: string;
  wallet_id: string | null;
  wallet_address: string | null;
  network: typeof AGON_X402_AGENT_POLICY_NETWORK;
  enabled: boolean;
  per_call_cap_base_units: string;
  daily_cap_base_units: string;
  allowed_recipients: unknown;
};

type SpendRow = QueryResultRow & {
  agent_id: string;
  idempotency_key: string;
  spend_day: string;
  amount_base_units: string;
  recipient_address: string;
  state: X402AgentSpendState;
  provider_transfer_id: string | null;
  transaction_hash: `0x${string}` | null;
  created_at: Date;
  updated_at: Date;
};

function policyError(code: X402AgentPolicyError["code"], message: string): { ok: false; error: X402AgentPolicyError } {
  return { ok: false, error: { code, message } };
}

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
  if (!ADDRESS.test(value)) return null;
  try {
    return getAddress(value) as `0x${string}`;
  } catch {
    return null;
  }
}

function mapPolicy(row: PolicyRow): X402AgentWalletPolicy {
  const allowed = Array.isArray(row.allowed_recipients)
    ? row.allowed_recipients
      .filter((value): value is string => typeof value === "string" && ADDRESS.test(value))
      .map((value) => value as `0x${string}`)
    : undefined;
  return {
    agentId: row.agent_id,
    walletId: row.wallet_id,
    walletAddress: row.wallet_address as `0x${string}` | null,
    network: row.network,
    enabled: row.enabled,
    perCallCapBaseUnits: BigInt(row.per_call_cap_base_units),
    dailyCapBaseUnits: BigInt(row.daily_cap_base_units),
    allowedRecipients: allowed,
  };
}

function mapSpend(row: SpendRow): X402AgentSpendRecord {
  return {
    agentId: row.agent_id,
    idempotencyKey: row.idempotency_key,
    day: row.spend_day,
    amountBaseUnits: BigInt(row.amount_base_units),
    recipient: row.recipient_address as `0x${string}`,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    providerTransferId: row.provider_transfer_id,
    transaction: row.transaction_hash,
  };
}

const POLICY_COLUMNS = `agent_id, wallet_id, wallet_address, network, enabled,
  per_call_cap_base_units, daily_cap_base_units, allowed_recipients`;
const SPEND_COLUMNS = `agent_id, idempotency_key, spend_day::text as spend_day, amount_base_units,
  recipient_address, state, provider_transfer_id, transaction_hash, created_at, updated_at`;

/**
 * Postgres-backed policy store. Reservation locks the policy row, so two
 * concurrent spends cannot both observe the same remaining daily allowance.
 */
export class PostgresX402AgentWalletPolicyStore implements X402AgentWalletPolicyStore {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async setPolicy(policy: X402AgentWalletPolicy): Promise<void> {
    const issue = validateX402AgentWalletPolicy(policy);
    if (issue && issue.code !== "wallet_not_ready") throw new Error(issue.message);
    if (!AGENT_ID.test(policy.agentId)) throw new Error("agent policy id is invalid");
    const walletAddress = policy.walletAddress === null ? null : normalizeAddress(policy.walletAddress);
    if (policy.walletAddress !== null && !walletAddress) throw new Error("agent wallet address is invalid");
    const recipients = policy.allowedRecipients?.map((recipient) => {
      const normalized = normalizeAddress(recipient);
      if (!normalized) throw new Error("agent recipient policy contains an invalid address");
      return normalized.toLowerCase();
    }) ?? null;
    await this.pool.query(
      `insert into agon_x402_agent_wallet_policies (
         agent_id, wallet_id, wallet_address, network, enabled,
         per_call_cap_base_units, daily_cap_base_units, allowed_recipients
       ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       on conflict (agent_id) do update set
         wallet_id = excluded.wallet_id,
         wallet_address = excluded.wallet_address,
         network = excluded.network,
         enabled = excluded.enabled,
         per_call_cap_base_units = excluded.per_call_cap_base_units,
         daily_cap_base_units = excluded.daily_cap_base_units,
         allowed_recipients = excluded.allowed_recipients,
         updated_at = now()`,
      [policy.agentId, policy.walletId, walletAddress?.toLowerCase() ?? null, policy.network, policy.enabled, policy.perCallCapBaseUnits.toString(), policy.dailyCapBaseUnits.toString(), recipients ? JSON.stringify(recipients) : null],
    );
  }

  async getPolicy(agentId: string): Promise<X402AgentWalletPolicy | null> {
    const result = await this.pool.query<PolicyRow>(
      `select ${POLICY_COLUMNS} from agon_x402_agent_wallet_policies where agent_id = $1`,
      [agentId],
    );
    return result.rows[0] ? mapPolicy(result.rows[0]) : null;
  }

  async getSpend(agentId: string, idempotencyKey: string): Promise<X402AgentSpendRecord | null> {
    const result = await this.pool.query<SpendRow>(
      `select ${SPEND_COLUMNS}
       from agon_x402_agent_spends
       where agent_id = $1 and idempotency_key = $2`,
      [agentId, idempotencyKey],
    );
    return result.rows[0] ? mapSpend(result.rows[0]) : null;
  }

  async reserve(input: X402AgentReserveInput): Promise<X402AgentReserveResult> {
    const now = input.now ?? new Date();
    if (!Number.isFinite(now.getTime())) return policyError("invalid_spend", "spend timestamp is invalid");
    const amount = parseAmount(input.amountBaseUnits);
    if (amount === null) return policyError("invalid_spend", "spend amount must be a positive integer base-unit value");
    if (!IDEMPOTENCY_KEY.test(input.idempotencyKey)) return policyError("invalid_spend", "spend idempotency key must be 8-128 safe characters");
    const recipient = normalizeAddress(input.recipient);
    if (!recipient) return policyError("invalid_spend", "spend recipient must be a valid EVM address");
    const day = utcDay(now);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const policyResult = await client.query<PolicyRow>(
        `select ${POLICY_COLUMNS}
         from agon_x402_agent_wallet_policies where agent_id = $1 for update`,
        [input.agentId],
      );
      const row = policyResult.rows[0];
      if (!row || !row.enabled) {
        await client.query("commit");
        return policyError("wallet_policy_disabled", "agent wallet spending policy is disabled");
      }
      const policy = mapPolicy(row);
      const issue = validateX402AgentWalletPolicy(policy);
      if (issue) {
        await client.query("commit");
        return { ok: false, error: issue };
      }
      const existingResult = await client.query<SpendRow>(
        `select ${SPEND_COLUMNS}
         from agon_x402_agent_spends
         where agent_id = $1 and idempotency_key = $2 for update`,
        [input.agentId, input.idempotencyKey],
      );
      const existing = existingResult.rows[0];
      const usedResult = await client.query<{ used: string }>(
        `select coalesce(sum(amount_base_units), 0)::text as used
         from agon_x402_agent_spends
         where agent_id = $1 and spend_day = $2 and state <> 'failed'`,
        [input.agentId, day],
      );
      const used = BigInt(usedResult.rows[0]?.used ?? "0");
      const remaining = policy.dailyCapBaseUnits > used ? policy.dailyCapBaseUnits - used : 0n;
      if (existing) {
        const mapped = mapSpend(existing);
        if (mapped.amountBaseUnits !== amount || mapped.recipient.toLowerCase() !== recipient.toLowerCase() || mapped.day !== day) {
          await client.query("rollback");
          return policyError("idempotency_conflict", "spend idempotency key is already bound to different economics");
        }
        await client.query("commit");
        return { ok: true, decision: "idempotent_replay", record: mapped, remainingDailyBaseUnits: remaining };
      }
      if (amount > policy.perCallCapBaseUnits) {
        await client.query("commit");
        return policyError("wallet_cap_exceeded", "spend exceeds the agent per-call cap");
      }
      if (policy.allowedRecipients?.length && !policy.allowedRecipients.some((allowed) => allowed.toLowerCase() === recipient.toLowerCase())) {
        await client.query("commit");
        return policyError("recipient_not_allowed", "spend recipient is not approved by the agent policy");
      }
      if (amount > remaining) {
        await client.query("commit");
        return policyError("wallet_cap_exceeded", "spend exceeds the agent daily cap");
      }
      const inserted = await client.query<SpendRow>(
        `insert into agon_x402_agent_spends (
           agent_id, idempotency_key, spend_day, amount_base_units,
           recipient_address, state, provider_transfer_id, transaction_hash,
           created_at, updated_at
         ) values ($1, $2, $3, $4, $5, 'reserved', null, null, $6, $6)
         returning ${SPEND_COLUMNS}`,
        [input.agentId, input.idempotencyKey, day, amount.toString(), recipient.toLowerCase(), now],
      );
      await client.query("commit");
      return { ok: true, decision: "reserved", record: mapSpend(inserted.rows[0]!), remainingDailyBaseUnits: remaining - amount };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async transition(input: X402AgentSpendTransitionInput): Promise<{ ok: true; record: X402AgentSpendRecord } | { ok: false; error: X402AgentPolicyError }> {
    const now = input.now ?? new Date();
    if (!Number.isFinite(now.getTime())) return policyError("invalid_spend", "spend timestamp is invalid");
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query<SpendRow>(
        `select ${SPEND_COLUMNS}
         from agon_x402_agent_spends where agent_id = $1 and idempotency_key = $2 for update`,
        [input.agentId, input.idempotencyKey],
      );
      const row = result.rows[0];
      if (!row) {
        await client.query("rollback");
        return policyError("invalid_spend", "spend reservation does not exist");
      }
      const current = mapSpend(row);
      if (current.state === "failed" && input.state !== "failed") {
        await client.query("rollback");
        return policyError("invalid_spend", "failed spend reservations are terminal");
      }
      if (current.state === "confirmed" && input.state !== "confirmed") {
        await client.query("rollback");
        return policyError("invalid_spend", "confirmed spend reservations are terminal");
      }
      const allowed: Record<X402AgentSpendState, readonly X402AgentSpendState[]> = {
        reserved: ["submitted", "unknown", "failed"],
        submitted: ["confirmed", "unknown", "failed"],
        unknown: ["confirmed", "failed"],
        confirmed: ["confirmed"],
        failed: ["failed"],
      };
      if (!allowed[current.state].includes(input.state)) {
        await client.query("rollback");
        return policyError("invalid_spend", `cannot transition spend from ${current.state} to ${input.state}`);
      }
      const updated = await client.query<SpendRow>(
        `update agon_x402_agent_spends set
           state = $3,
           provider_transfer_id = coalesce($4, provider_transfer_id),
           transaction_hash = coalesce($5, transaction_hash),
           updated_at = $6
         where agent_id = $1 and idempotency_key = $2
         returning ${SPEND_COLUMNS}`,
        [input.agentId, input.idempotencyKey, input.state, input.providerTransferId ?? null, input.transaction ?? null, now],
      );
      await client.query("commit");
      return { ok: true, record: mapSpend(updated.rows[0]!) };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
