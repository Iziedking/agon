import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PostgresAgonRepository, type AgonArenaEvaluationProjection } from "../../src/agon/store/repository.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

const ACTOR = `0x${"11".repeat(20)}` as `0x${string}`;
const ARENA = `0x${"22".repeat(20)}` as `0x${string}`;
const VALIDATION = `0x${"33".repeat(20)}` as `0x${string}`;
const REGISTRY = `0x${"44".repeat(20)}` as `0x${string}`;
const hash = (byte: string) => `0x${byte.repeat(64)}` as `0x${string}`;
const RUN_ID = "00000000-0000-4000-8000-000000000101";
const RUN_ID_2 = "00000000-0000-4000-8000-000000000102";

let database: AgonTestDatabase;
let repository: PostgresAgonRepository;

before(async () => {
  database = await createAgonTestDatabase("arenaevaluations");
  repository = new PostgresAgonRepository(database.pool);
  await database.pool.query(
    `insert into agon_playground_runs (run_id, actor_address, request_id, category, task_id, input_hash, input, scope, state, result, completed_at, lease_expires_at)
     values ($1, $2, $3, 'development', 'selector-guard', $4, '{}'::jsonb, $5::jsonb, 'completed', '{}'::jsonb, now(), now())`,
    [RUN_ID, ACTOR, "00000000-0000-4000-8000-000000000102", hash("1"), JSON.stringify({ listingReference: `5042002:${REGISTRY}:7`, listingVersion: "3" })],
  );
  await database.pool.query(
    `insert into agon_playground_runs (run_id, actor_address, request_id, category, task_id, input_hash, input, scope, state, result, completed_at, lease_expires_at)
     values ($1, $2, $3, 'development', 'selector-guard', $4, '{}'::jsonb, $5::jsonb, 'completed', '{}'::jsonb, now(), now())`,
    [RUN_ID_2, ACTOR, "00000000-0000-4000-8000-000000000106", hash("2"), JSON.stringify({ listingReference: `5042002:${REGISTRY}:7`, listingVersion: "3" })],
  );
});

after(async () => {
  await database.close();
});

function input(overrides: Partial<AgonArenaEvaluationProjection> = {}): AgonArenaEvaluationProjection {
  return {
    intentId: "00000000-0000-4000-8000-000000000103",
    actor: ACTOR,
    idempotencyKey: "arena-evaluation-db-001",
    listingReference: `5042002:${REGISTRY}:7`,
    network: "eip155:5042002",
    arenaContract: ARENA,
    validationRegistry: VALIDATION,
    participant: ACTOR,
    serviceRegistry: REGISTRY,
    listingId: "7",
    agentId: "42",
    listingVersion: "3",
    category: "1",
    manifestHash: hash("a"),
    capabilityHash: hash("b"),
    evaluatorVersionHash: hash("c"),
    taskCommitment: hash("d"),
    validationRequestHash: hash("e"),
    evidenceRoot: hash("f"),
    playgroundRunId: RUN_ID,
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    state: "prepared",
    evaluationId: null,
    requestTransactionHash: null,
    startTransactionHash: null,
    evidenceTransactionHash: null,
    ...overrides,
  };
}

test("persists exact Arena evidence once and records user submission markers idempotently", async () => {
  const created = await repository.prepareAgonArenaEvaluation(input());
  const replay = await repository.prepareAgonArenaEvaluation(input({ intentId: "00000000-0000-4000-8000-000000000104" }));
  assert.equal(replay.intentId, created.intentId);
  const tx = hash("9");
  const requested = await repository.markAgonArenaEvaluationRequested({ intentId: created.intentId, evaluationId: "7", transactionHash: tx });
  assert.equal(requested.state, "request_submitted");
  assert.equal((await repository.markAgonArenaEvaluationRequested({ intentId: created.intentId, evaluationId: "7", transactionHash: tx })).evaluationId, "7");
  const evidenceTx = hash("8");
  const submitted = await repository.markAgonArenaEvidenceSubmitted({ intentId: created.intentId, transactionHash: evidenceTx });
  assert.equal(submitted.state, "evidence_submitted");
  assert.equal((await repository.markAgonArenaEvidenceSubmitted({ intentId: created.intentId, transactionHash: evidenceTx })).evidenceTransactionHash, evidenceTx);
  assert.equal((await repository.reconcileAgonArenaEvaluation({ intentId: created.intentId, state: "verified" })).state, "verified");
  assert.equal((await repository.reconcileAgonArenaEvaluation({ intentId: created.intentId, state: "revoked" })).state, "revoked");
});

test("blocks replacing a request or evidence marker", async () => {
  const created = await repository.prepareAgonArenaEvaluation(input({ intentId: "00000000-0000-4000-8000-000000000105", idempotencyKey: "arena-evaluation-db-002", playgroundRunId: RUN_ID_2, validationRequestHash: hash("0") }));
  await repository.markAgonArenaEvaluationRequested({ intentId: created.intentId, evaluationId: "8", transactionHash: hash("a") });
  await assert.rejects(() => repository.markAgonArenaEvaluationRequested({ intentId: created.intentId, evaluationId: "9", transactionHash: hash("b") }), /request/);
});
