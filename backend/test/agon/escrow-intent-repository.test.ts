import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PostgresAgonRepository, type AgonEscrowIntentProjection } from "../../src/agon/store/repository.ts";
import { evaluateAgonEscrowTerms, hashAgonEscrowTerms } from "../../src/agon/escrow-policy.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

const BUYER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const PROVIDER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const REGISTRY = "0xcccccccccccccccccccccccccccccccccccccccc";
const MANIFEST = `0x${"11".repeat(32)}`;
const NOW = new Date("2026-08-22T12:00:00.000Z");

let database: AgonTestDatabase;
let repository: PostgresAgonRepository;

before(async () => {
  database = await createAgonTestDatabase("escrowintents");
  repository = new PostgresAgonRepository(database.pool);
});

after(async () => {
  await database.close();
});

function input(overrides: Partial<AgonEscrowIntentProjection> = {}): AgonEscrowIntentProjection {
  const evaluated = evaluateAgonEscrowTerms({
    listing: {
      serviceRegistry: REGISTRY,
      listingId: "7",
      agentId: "42",
      version: "3",
      manifestHash: MANIFEST,
      providerSnapshot: PROVIDER,
      status: "Listed",
      verification: "Verified",
      paymentRail: "Escrow",
    },
    buyer: BUYER,
    amountBaseUnits: 1_000_000n,
    feeBps: 500,
    now: NOW,
    expiresAt: new Date("2026-08-23T12:00:00.000Z"),
  });
  assert.equal(evaluated.ok, true);
  if (!evaluated.ok) throw new Error(evaluated.error.message);
  const value = {
    intentId: "00000000-0000-4000-8000-000000000001",
    actor: BUYER,
    idempotencyKey: "escrow-db-001",
    listingReference: `5042002:${REGISTRY}:7`,
    termsHash: hashAgonEscrowTerms(evaluated.value),
    terms: evaluated.value,
    state: "prepared",
    providerReference: null,
    transaction: null,
    createdAt: NOW,
    ...overrides,
  };
  return { ...value, ...overrides };
}

test("persists one escrow intent and reuses it for an exact idempotent retry", async () => {
  const first = await repository.prepareAgonEscrowIntent(input());
  const retry = await repository.prepareAgonEscrowIntent(input({ intentId: "00000000-0000-4000-8000-000000000002" }));
  assert.equal(retry.intentId, first.intentId);
  assert.equal(retry.listingReference, first.listingReference);
  assert.equal(retry.terms.amountBaseUnits, 1_000_000n);
  const rows = await database.pool.query("select count(*)::int as count from agon_escrow_intents");
  assert.equal(rows.rows[0]?.count, 1);
});

test("rejects an escrow idempotency key reused with different terms", async () => {
  const base = input();
  const changedTerms = { ...base.terms, feeBps: 0 };
  await assert.rejects(
    () => repository.prepareAgonEscrowIntent({
      ...base,
      terms: changedTerms,
      termsHash: hashAgonEscrowTerms(changedTerms),
    }),
    /different terms/i,
  );
});

test("guards durable escrow transitions and preserves unknown outcomes", async () => {
  const created = await repository.prepareAgonEscrowIntent(input({
    intentId: "00000000-0000-4000-8000-000000000003",
    idempotencyKey: "escrow-db-003",
  }));
  const funding = await repository.advanceAgonEscrowIntent({ intentId: created.intentId, state: "funding" });
  assert.equal(funding.state, "funding");
  const unknown = await repository.advanceAgonEscrowIntent({ intentId: created.intentId, state: "unknown" });
  assert.equal(unknown.state, "unknown");
  await assert.rejects(
    () => repository.advanceAgonEscrowIntent({ intentId: created.intentId, state: "funding" }),
    /cannot transition escrow intent from unknown to funding/i,
  );
});
