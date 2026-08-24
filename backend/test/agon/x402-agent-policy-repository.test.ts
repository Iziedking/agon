import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { AGON_X402_AGENT_POLICY_NETWORK, type X402AgentWalletPolicy } from "../../src/agon/execution/x402-agent-policy.ts";
import { PostgresX402AgentWalletPolicyStore } from "../../src/agon/store/x402-agent-policy.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

let database: AgonTestDatabase;
let store: PostgresX402AgentWalletPolicyStore;
const policy: X402AgentWalletPolicy = {
  agentId: "agent-db-001",
  walletId: "circle-wallet-db-001",
  walletAddress: "0x1111111111111111111111111111111111111111",
  network: AGON_X402_AGENT_POLICY_NETWORK,
  enabled: true,
  perCallCapBaseUnits: 100n,
  dailyCapBaseUnits: 100n,
  allowedRecipients: ["0x2222222222222222222222222222222222222222"],
};

before(async () => {
  database = await createAgonTestDatabase("x402agentpolicy");
  store = new PostgresX402AgentWalletPolicyStore(database.pool);
  await store.setPolicy(policy);
});

after(async () => {
  if (database) await database.close();
});

test("persists policy and enforces atomic daily reservations across concurrent callers", async () => {
  assert.equal((await store.getPolicy(policy.agentId))?.walletId, policy.walletId);
  const now = new Date("2026-08-24T11:00:00.000Z");
  const keys = ["db-spend-001", "db-spend-002"] as const;
  const results = await Promise.all([
    store.reserve({ agentId: policy.agentId, idempotencyKey: keys[0], amountBaseUnits: 60n, recipient: policy.allowedRecipients![0]!, now }),
    store.reserve({ agentId: policy.agentId, idempotencyKey: keys[1], amountBaseUnits: 60n, recipient: policy.allowedRecipients![0]!, now }),
  ]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => !result.ok && result.error.code === "wallet_cap_exceeded").length, 1);
  const successfulKey = results[0]?.ok ? keys[0] : keys[1];
  const replay = await store.reserve({ agentId: policy.agentId, idempotencyKey: successfulKey, amountBaseUnits: 60n, recipient: policy.allowedRecipients![0]!, now });
  assert.equal(replay.ok, true, replay.ok ? undefined : replay.error.message);
  if (replay.ok) assert.equal(replay.decision, "idempotent_replay");
});

test("keeps unknown spend reservations cap-consuming until independently confirmed", async () => {
  const now = new Date("2026-08-25T11:00:00.000Z");
  const reserved = await store.reserve({ agentId: policy.agentId, idempotencyKey: "db-spend-003", amountBaseUnits: 90n, recipient: policy.allowedRecipients![0]!, now });
  assert.equal(reserved.ok, true);
  const unknown = await store.transition({ agentId: policy.agentId, idempotencyKey: "db-spend-003", state: "unknown", now });
  assert.equal(unknown.ok, true);
  const blocked = await store.reserve({ agentId: policy.agentId, idempotencyKey: "db-spend-004", amountBaseUnits: 11n, recipient: policy.allowedRecipients![0]!, now });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.error.code, "wallet_cap_exceeded");
  const confirmed = await store.transition({ agentId: policy.agentId, idempotencyKey: "db-spend-003", state: "confirmed", now });
  assert.equal(confirmed.ok, true);
  assert.equal((await store.getSpend(policy.agentId, "db-spend-003"))?.state, "confirmed");
});
