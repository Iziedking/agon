import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { InMemoryPlaygroundRunStore } from "../../src/agon/playground-store.ts";
import type { PlaygroundRunStart } from "../../src/agon/playground-store.ts";

test("in-memory store preserves a failed idempotent run as terminal", async () => {
  const store = new InMemoryPlaygroundRunStore();
  const input: PlaygroundRunStart = {
    runId: randomUUID(),
    requestId: randomUUID(),
    actorAddress: "0x0000000000000000000000000000000000000002",
    idempotencyKey: "evaluation-failed",
    category: "verification",
    taskId: "manifest-anchor",
    inputHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    input: { manifest: null },
    scope: null,
  };
  const started = await store.beginRun(input);
  await store.failRun(started.run.runId, "execution_failed");
  const replay = await store.beginRun({ ...input, runId: randomUUID(), requestId: randomUUID() });
  assert.equal(replay.replayed, true);
  assert.equal(replay.run.state, "failed");
});

test("in-memory store fails a stale running idempotent run closed", async () => {
  const store = new InMemoryPlaygroundRunStore(1);
  const input: PlaygroundRunStart = {
    runId: randomUUID(),
    requestId: randomUUID(),
    actorAddress: "0x0000000000000000000000000000000000000003",
    idempotencyKey: "evaluation-stale",
    category: "verification",
    taskId: "manifest-anchor",
    inputHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    input: { manifest: null },
    scope: null,
  };
  await store.beginRun(input);
  await new Promise((resolve) => setTimeout(resolve, 1_050));
  const replay = await store.beginRun({ ...input, runId: randomUUID(), requestId: randomUUID() });
  assert.equal(replay.replayed, true);
  assert.equal(replay.run.state, "failed");
  assert.equal(replay.run.errorCode, "worker_timeout");
});
