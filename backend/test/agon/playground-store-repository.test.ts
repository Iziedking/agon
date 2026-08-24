import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";

import { runPlaygroundTask } from "../../src/agon/playground.ts";
import { PostgresPlaygroundRunStore } from "../../src/agon/playground-store.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

let database: AgonTestDatabase;
let store: PostgresPlaygroundRunStore;

before(async () => {
  database = await createAgonTestDatabase("playground_runs");
  store = new PostgresPlaygroundRunStore(database.pool);
});

after(async () => database.close());

test("persists a completed run and rejects a changed idempotent payload", async () => {
  const options = {
    actorAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    idempotencyKey: "playground-repository-1",
    scope: { listingReference: "5042002:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:7", listingVersion: "1" },
    store,
  };
  const first = await runPlaygroundTask({ category: "development", taskId: "selector-guard" }, options);
  const retry = await runPlaygroundTask({ category: "development", taskId: "selector-guard" }, options);
  assert.equal(retry.replayed, true);
  assert.equal(retry.runId, first.runId);

  await assert.rejects(
    () => runPlaygroundTask({ category: "development", taskId: "selector-guard", input: { to: "0x0000000000000000000000000000000000000009" } }, options),
    /different evaluation inputs/,
  );

  const row = await database.pool.query<{ state: string; result_present: boolean }>(
    "select state, result is not null as result_present from agon_playground_runs where run_id = $1",
    [first.runId],
  );
  assert.deepEqual(row.rows[0], { state: "completed", result_present: true });
});

test("closes a stale running row before replaying it", async () => {
  const actorAddress = "0xcccccccccccccccccccccccccccccccccccccccc";
  const idempotencyKey = "playground-repository-stale";
  const first = await store.beginRun({
    runId: randomUUID(),
    requestId: randomUUID(),
    actorAddress,
    idempotencyKey,
    category: "development",
    taskId: "selector-guard",
    inputHash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    input: { to: "0x0000000000000000000000000000000000001234" },
    scope: null,
  });
  await database.pool.query("update agon_playground_runs set lease_expires_at = now() - interval '1 second' where run_id = $1", [first.run.runId]);
  const retry = await store.beginRun({
    runId: randomUUID(),
    requestId: randomUUID(),
    actorAddress,
    idempotencyKey,
    category: "development",
    taskId: "selector-guard",
    inputHash: first.run.inputHash,
    input: first.run.input,
    scope: null,
  });
  assert.equal(retry.replayed, true);
  assert.equal(retry.run.state, "failed");
  assert.equal(retry.run.errorCode, "worker_timeout");
});
