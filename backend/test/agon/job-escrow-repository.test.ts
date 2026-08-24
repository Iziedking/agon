import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PostgresAgonRepository, type AgonJobEscrowIntentProjection } from "../../src/agon/store/repository.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";
import { clientReferenceForJobEscrow, hashAgonJobEscrowTerms } from "../../src/agon/execution/job-escrow-state.ts";
import type { AgonJobEscrowJob } from "../../src/agon/execution/agon-job-escrow.ts";

const BUYER = `0x${"aa".repeat(20)}` as `0x${string}`;
const PROVIDER = `0x${"bb".repeat(20)}` as `0x${string}`;
const REGISTRY = `0x${"cc".repeat(20)}` as `0x${string}`;
const ESCROW = `0x${"dd".repeat(20)}` as `0x${string}`;
const MANIFEST = `0x${"11".repeat(32)}` as `0x${string}`;
const NOW = new Date("2026-08-22T12:00:00.000Z");

let database: AgonTestDatabase;
let repository: PostgresAgonRepository;

before(async () => {
  database = await createAgonTestDatabase("jobescrowintents");
  repository = new PostgresAgonRepository(database.pool);
});

after(async () => {
  await database.close();
});

function input(overrides: Partial<AgonJobEscrowIntentProjection> = {}): AgonJobEscrowIntentProjection {
  const expiresAt = new Date("2026-08-23T12:00:00.000Z");
  const base = {
    intentId: "00000000-0000-4000-8000-000000000001",
    idempotencyKey: "job-escrow-db-001",
    actor: BUYER,
    buyer: BUYER,
    provider: PROVIDER,
    listingReference: `5042002:${REGISTRY}:7`,
    network: "eip155:5042002" as const,
    asset: "0x3600000000000000000000000000000000000000" as `0x${string}`,
    escrowContract: ESCROW,
    serviceRegistry: REGISTRY,
    listingId: "7",
    agentId: "42",
    listingVersion: "3",
    manifestHash: MANIFEST,
    termsHash: hashAgonJobEscrowTerms({
      network: "eip155:5042002",
      asset: "0x3600000000000000000000000000000000000000",
      buyer: BUYER,
      provider: PROVIDER,
      escrowContract: ESCROW,
      serviceRegistry: REGISTRY,
      listingId: "7",
      agentId: "42",
      listingVersion: "3",
      manifestHash: MANIFEST,
      amountBaseUnits: 1_000_000n,
      feeBps: 100,
      reviewHours: 24,
      expiresAt,
    }),
    amountBaseUnits: 1_000_000n,
    feeBps: 100,
    reviewHours: 24,
    expiresAt,
    clientReference: clientReferenceForJobEscrow("job-escrow-db-001"),
    state: "prepared" as const,
    settlement: "none" as const,
    onchainJobId: null,
    transactionHash: null,
    deliverableHash: null,
    reasonHash: null,
    lastReconciledAt: null,
    createdAt: NOW,
  } satisfies AgonJobEscrowIntentProjection;
  const result = { ...base, ...overrides };
  return { ...result, clientReference: clientReferenceForJobEscrow(result.idempotencyKey) };
}

function chainJob(overrides: Partial<AgonJobEscrowJob> = {}): AgonJobEscrowJob {
  return {
    jobId: "7",
    buyer: BUYER,
    provider: PROVIDER,
    listingId: "7",
    agentId: "42",
    listingVersion: "3",
    manifestHash: MANIFEST,
    termsHash: input().termsHash,
    deliverableHash: `0x${"00".repeat(32)}`,
    amount: "1000000",
    fee: "10000",
    reviewHours: 24,
    acceptanceDeadline: new Date("2026-08-22T13:00:00.000Z"),
    reviewDeadline: null,
    createdAt: NOW,
    submittedAt: null,
    status: 0,
    settlement: 0,
    ...overrides,
  };
}

test("persists and replays an exact job intent without duplicating it", async () => {
  const first = await repository.prepareAgonJobEscrowIntent(input());
  const retry = await repository.prepareAgonJobEscrowIntent(input({
    intentId: "00000000-0000-4000-8000-000000000002",
  }));
  assert.equal(retry.intentId, first.intentId);
  assert.equal(retry.clientReference, clientReferenceForJobEscrow("job-escrow-db-001"));
  const rows = await database.pool.query("select count(*)::int as count from agon_job_escrow_intents");
  assert.equal(rows.rows[0]?.count, 1);
});

test("rejects an idempotency retry whose pinned economics differ", async () => {
  const base = input({ intentId: "00000000-0000-4000-8000-000000000003", idempotencyKey: "job-escrow-db-003" });
  await repository.prepareAgonJobEscrowIntent(base);
  await assert.rejects(
    () => repository.prepareAgonJobEscrowIntent({ ...base, intentId: "00000000-0000-4000-8000-000000000004", feeBps: 200, termsHash: `0x${"44".repeat(32)}` }),
    /different terms/i,
  );
});

test("reconciles a matching chain job under a row lock and preserves terminal state", async () => {
  const created = await repository.prepareAgonJobEscrowIntent(input({ intentId: "00000000-0000-4000-8000-000000000005", idempotencyKey: "job-escrow-db-005" }));
  const onchain = await repository.reconcileAgonJobEscrowIntent({ intentId: created.intentId, job: chainJob() });
  assert.equal(onchain.state, "created");
  assert.equal(onchain.onchainJobId, "7");
  const completed = await repository.reconcileAgonJobEscrowIntent({ intentId: created.intentId, job: chainJob({ status: 3, settlement: 1, deliverableHash: `0x${"33".repeat(32)}` }) });
  assert.equal(completed.state, "complete");
  assert.equal(completed.settlement, "provider_paid");
  const replay = await repository.reconcileAgonJobEscrowIntent({ intentId: created.intentId, job: chainJob({ status: 3, settlement: 1, deliverableHash: `0x${"33".repeat(32)}` }) });
  assert.equal(replay.state, "complete");
});

test("records a user-submitted transaction once and blocks replacement retries", async () => {
  const created = await repository.prepareAgonJobEscrowIntent(input({ intentId: "00000000-0000-4000-8000-000000000007", idempotencyKey: "job-escrow-db-007" }));
  const tx = `0x${"55".repeat(32)}` as `0x${string}`;
  const submitted = await repository.markAgonJobEscrowSubmitted({ intentId: created.intentId, transactionHash: tx });
  assert.equal(submitted.state, "submitted");
  assert.equal((await repository.markAgonJobEscrowSubmitted({ intentId: created.intentId, transactionHash: tx })).transactionHash, tx);
  await assert.rejects(
    () => repository.markAgonJobEscrowSubmitted({ intentId: created.intentId, transactionHash: `0x${"66".repeat(32)}` }),
    /cannot mark job escrow intent submitted/i,
  );
});

test("rejects mismatched chain evidence without mutating the intent", async () => {
  const created = await repository.prepareAgonJobEscrowIntent(input({ intentId: "00000000-0000-4000-8000-000000000006", idempotencyKey: "job-escrow-db-006" }));
  await assert.rejects(
    () => repository.reconcileAgonJobEscrowIntent({ intentId: created.intentId, job: chainJob({ provider: BUYER }) }),
    /provider does not match/i,
  );
  const unchanged = await repository.getAgonJobEscrowIntent(created.intentId);
  assert.equal(unchanged?.state, "prepared");
  assert.equal(unchanged?.onchainJobId, null);
});
