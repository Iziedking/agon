import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  PostgresAgonOperationStore,
  type PrepareAgonOperation,
} from "../../src/agon/write/repository.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

let database: AgonTestDatabase;
let store: PostgresAgonOperationStore;

const prepared: PrepareAgonOperation = {
  actor: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  kind: "bind_profile",
  payloadHash: `0x${"11".repeat(32)}`,
  request: { chainId: "5042002", agentId: "42", metadataUri: "ipfs://profile" },
  transaction: {
    chainId: "5042002",
    to: "0x1111111111111111111111111111111111111111",
    data: "0x1234",
    functionName: "bindProfile",
    args: ["42", "ipfs://profile"],
  },
};

before(async () => {
  database = await createAgonTestDatabase("write_repository");
  store = new PostgresAgonOperationStore(database.pool);
});

after(async () => database.close());

test("returns the same prepared operation for an identical actor payload", async () => {
  const first = await store.prepare(prepared);
  const second = await store.prepare(prepared);
  assert.equal(first.operationId, second.operationId);
  assert.equal(first.state, "prepared");
  assert.deepEqual(second.transaction, prepared.transaction);
});

test("confirms once and returns the same proof on an identical retry", async () => {
  const operation = await store.prepare({ ...prepared, payloadHash: `0x${"22".repeat(32)}` });
  const proof = {
    operationId: operation.operationId,
    actor: prepared.actor,
    txHash: `0x${"33".repeat(32)}` as `0x${string}`,
    resultReference: null,
    blockNumber: 100n,
    logIndex: 2,
  };
  const confirmed = await store.confirm(proof);
  const retried = await store.confirm(proof);
  assert.equal(confirmed.state, "confirmed");
  assert.equal(retried.txHash, proof.txHash);
  await assert.rejects(
    store.confirm({ ...proof, txHash: `0x${"44".repeat(32)}` }),
    /different transaction/,
  );
});
