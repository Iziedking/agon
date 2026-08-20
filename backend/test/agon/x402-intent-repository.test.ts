import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PostgresAgonRepository, type X402CallIntentProjection } from "../../src/agon/store/repository.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

let database: AgonTestDatabase;
let repository: PostgresAgonRepository;

before(async () => {
  database = await createAgonTestDatabase("x402intents");
  repository = new PostgresAgonRepository(database.pool);
});

after(async () => {
  if (database) await database.close();
});

function input(overrides: Partial<X402CallIntentProjection> = {}): X402CallIntentProjection {
  return {
    intentId: "00000000-0000-4000-8000-000000000001",
    actor: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    idempotencyKey: "audit-001",
    listingReference: "5042002:0x3333333333333333333333333333333333333333:1",
    chainId: 5042002n,
    serviceRegistry: "0x3333333333333333333333333333333333333333",
    listingId: 1n,
    agentId: 42n,
    version: 1n,
    method: "POST",
    input: { prompt: "audit" },
    inputHash: `0x${"11".repeat(32)}`,
    maxAmountUSDC: "0.01",
    state: "prepared",
    ...overrides,
  };
}

test("reuses the same prepared x402 intent for an idempotent retry", async () => {
  const first = await repository.prepareX402CallIntent(input());
  const retry = await repository.prepareX402CallIntent(input({ intentId: "00000000-0000-4000-8000-000000000002" }));
  assert.equal(retry.intentId, first.intentId);
  assert.equal(retry.inputHash, first.inputHash);
  const rows = await database.pool.query("select count(*)::int as count from agon_x402_call_intents");
  assert.equal(rows.rows[0]?.count, 1);
});

test("rejects an idempotency key reused with different call economics", async () => {
  await assert.rejects(
    () => repository.prepareX402CallIntent(input({ maxAmountUSDC: "0.02", intentId: "00000000-0000-4000-8000-000000000003" })),
    /idempotency key already used/,
  );
});
