import assert from "node:assert/strict";
import test from "node:test";
import {
  AGON_X402_AGENT_POLICY_NETWORK,
  X402AgentWalletPolicyLedger,
  createDisabledX402AgentWalletAdapter,
  type X402AgentWalletPolicy,
} from "../../src/agon/execution/x402-agent-policy.ts";
import { X402AgentSpendExecutor } from "../../src/agon/execution/x402-agent-executor.ts";

const AGENT = "agent-alpha";
const WALLET = "0x1111111111111111111111111111111111111111" as const;
const RECIPIENT = "0x2222222222222222222222222222222222222222" as const;
const OTHER_RECIPIENT = "0x3333333333333333333333333333333333333333" as const;
const DAY_ONE = new Date("2026-08-22T12:00:00.000Z");

function policy(overrides: Partial<X402AgentWalletPolicy> = {}): X402AgentWalletPolicy {
  return {
    agentId: AGENT,
    walletId: "circle-wallet-alpha",
    walletAddress: WALLET,
    network: AGON_X402_AGENT_POLICY_NETWORK,
    enabled: true,
    perCallCapBaseUnits: 100n,
    dailyCapBaseUnits: 150n,
    allowedRecipients: [RECIPIENT],
    ...overrides,
  };
}

function reserve(ledger: X402AgentWalletPolicyLedger, idempotencyKey: string, amountBaseUnits: string | bigint, now = DAY_ONE) {
  return ledger.reserve({ agentId: AGENT, idempotencyKey, amountBaseUnits, recipient: RECIPIENT, now });
}

test("fails closed when the policy is disabled or the wallet is not provisioned", () => {
  const disabled = new X402AgentWalletPolicyLedger([policy({ enabled: false })]);
  assert.deepEqual(reserve(disabled, "spend-001", 1n), {
    ok: false,
    error: { code: "wallet_policy_disabled", message: "agent wallet spending policy is disabled" },
  });

  const unprovisioned = new X402AgentWalletPolicyLedger([policy({ walletId: null, walletAddress: null })]);
  assert.deepEqual(reserve(unprovisioned, "spend-002", 1n), {
    ok: false,
    error: { code: "wallet_not_ready", message: "agent Circle wallet is not provisioned" },
  });
});

test("enforces per-call and daily caps, including all non-failed outcomes", () => {
  const ledger = new X402AgentWalletPolicyLedger([policy()]);
  const first = reserve(ledger, "spend-101", 100n);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.remainingDailyBaseUnits, 50n);

  const second = reserve(ledger, "spend-102", 50n);
  assert.equal(second.ok, true);
  assert.deepEqual(reserve(ledger, "spend-103", 1n), {
    ok: false,
    error: { code: "wallet_cap_exceeded", message: "spend exceeds the agent daily cap" },
  });
  assert.deepEqual(reserve(ledger, "spend-104", 101n), {
    ok: false,
    error: { code: "wallet_cap_exceeded", message: "spend exceeds the agent per-call cap" },
  });

  const failed = ledger.transition({ agentId: AGENT, idempotencyKey: "spend-101", state: "failed" });
  assert.equal(failed.ok, true);
  const released = reserve(ledger, "spend-105", 100n);
  assert.equal(released.ok, true);
});

test("binds economics to an idempotency key and replays exact requests", () => {
  const ledger = new X402AgentWalletPolicyLedger([policy()]);
  const first = reserve(ledger, "spend-replay", 25n);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const replay = reserve(ledger, "spend-replay", 25n);
  assert.equal(replay.ok, true);
  if (!replay.ok) return;
  assert.equal(replay.decision, "idempotent_replay");
  assert.equal(replay.record.createdAt, first.record.createdAt);
  assert.deepEqual(reserve(ledger, "spend-replay", 26n), {
    ok: false,
    error: { code: "idempotency_conflict", message: "spend idempotency key is already bound to different economics" },
  });
});

test("does not alias agent and idempotency identifiers that contain separators", () => {
  const ledger = new X402AgentWalletPolicyLedger([
    policy({ agentId: "agent-a", allowedRecipients: [RECIPIENT] }),
    policy({ agentId: "agent-a:123456789", allowedRecipients: [RECIPIENT] }),
  ]);
  const first = ledger.reserve({ agentId: "agent-a", idempotencyKey: "123456789abcdefgh", amountBaseUnits: 10n, recipient: RECIPIENT, now: DAY_ONE });
  const second = ledger.reserve({ agentId: "agent-a:123456789", idempotencyKey: "abcdefgh", amountBaseUnits: 20n, recipient: RECIPIENT, now: DAY_ONE });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (first.ok && second.ok) assert.notEqual(first.record.amountBaseUnits, second.record.amountBaseUnits);
});

test("rejects non-allowlisted recipients and malformed spend inputs", () => {
  const ledger = new X402AgentWalletPolicyLedger([policy()]);
  assert.deepEqual(ledger.reserve({ agentId: AGENT, idempotencyKey: "spend-bad1", amountBaseUnits: 1n, recipient: OTHER_RECIPIENT, now: DAY_ONE }), {
    ok: false,
    error: { code: "recipient_not_allowed", message: "spend recipient is not approved by the agent policy" },
  });
  assert.deepEqual(ledger.reserve({ agentId: AGENT, idempotencyKey: "short", amountBaseUnits: 1n, recipient: RECIPIENT, now: DAY_ONE }), {
    ok: false,
    error: { code: "invalid_spend", message: "spend idempotency key must be 8-128 safe characters" },
  });
  assert.deepEqual(ledger.reserve({ agentId: AGENT, idempotencyKey: "spend-bad2", amountBaseUnits: "1.2", recipient: RECIPIENT, now: DAY_ONE }), {
    ok: false,
    error: { code: "invalid_spend", message: "spend amount must be a positive integer base-unit value" },
  });
});

test("keeps unknown provider outcomes reserved until independently reconciled", () => {
  const ledger = new X402AgentWalletPolicyLedger([policy({ perCallCapBaseUnits: 150n, dailyCapBaseUnits: 150n })]);
  assert.equal(reserve(ledger, "spend-unknown", 100n).ok, true);
  const unknown = ledger.transition({ agentId: AGENT, idempotencyKey: "spend-unknown", state: "unknown" });
  assert.equal(unknown.ok, true);
  assert.deepEqual(reserve(ledger, "spend-newer", 51n), {
    ok: false,
    error: { code: "wallet_cap_exceeded", message: "spend exceeds the agent daily cap" },
  });
  assert.equal(ledger.transition({ agentId: AGENT, idempotencyKey: "spend-unknown", state: "confirmed" }).ok, true);
  assert.deepEqual(ledger.transition({ agentId: AGENT, idempotencyKey: "spend-unknown", state: "reserved" as never }), {
    ok: false,
    error: { code: "invalid_spend", message: "confirmed spend reservations are terminal" },
  });
});

test("disabled adapter never reaches a provider and marks the reservation failed", async () => {
  const ledger = new X402AgentWalletPolicyLedger([policy()]);
  const executor = new X402AgentSpendExecutor(ledger, createDisabledX402AgentWalletAdapter());
  const result = await executor.execute({ agentId: AGENT, idempotencyKey: "spend-disabled", amountBaseUnits: 10n, recipient: RECIPIENT, now: DAY_ONE });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "wallet_disabled");
  assert.equal(result.record?.state, "failed");
});

test("executor reserves before execution, exposes submitted state, and requires confirmation for replay", async () => {
  let calls = 0;
  const ledger = new X402AgentWalletPolicyLedger([policy()]);
  const executor = new X402AgentSpendExecutor(ledger, {
    enabled: true,
    async settle() {
      calls += 1;
      return { ok: true, providerTransferId: "transfer-001", transaction: null };
    },
  });
  const submitted = await executor.execute({ agentId: AGENT, idempotencyKey: "spend-live", amountBaseUnits: 10n, recipient: RECIPIENT, now: DAY_ONE });
  assert.equal(submitted.ok, true);
  if (!submitted.ok) return;
  assert.equal(submitted.decision, "submitted");
  assert.equal(submitted.record.state, "submitted");
  assert.equal(calls, 1);

  const replayBeforeConfirm = await executor.execute({ agentId: AGENT, idempotencyKey: "spend-live", amountBaseUnits: 10n, recipient: RECIPIENT, now: DAY_ONE });
  assert.equal(replayBeforeConfirm.ok, false);
  if (replayBeforeConfirm.ok) return;
  assert.equal(replayBeforeConfirm.error.code, "wallet_reconciliation_required");
  assert.equal(calls, 1);

  const confirmed = await executor.confirm({ agentId: AGENT, idempotencyKey: "spend-live", transaction: `0x${"ab".repeat(32)}` });
  assert.equal(confirmed.ok, true);
  const replayAfterConfirm = await executor.execute({ agentId: AGENT, idempotencyKey: "spend-live", amountBaseUnits: 10n, recipient: RECIPIENT, now: DAY_ONE });
  assert.equal(replayAfterConfirm.ok, true);
  if (replayAfterConfirm.ok) assert.equal(replayAfterConfirm.decision, "idempotent_replay");
  assert.equal(calls, 1);
});

test("provider exceptions become unknown, never an automatic retry", async () => {
  const ledger = new X402AgentWalletPolicyLedger([policy()]);
  const executor = new X402AgentSpendExecutor(ledger, {
    enabled: true,
    async settle() {
      throw new Error("timeout");
    },
  });
  const result = await executor.execute({ agentId: AGENT, idempotencyKey: "spend-timeout", amountBaseUnits: 10n, recipient: RECIPIENT, now: DAY_ONE });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "wallet_unknown");
    assert.equal(result.record?.state, "unknown");
  }
});
