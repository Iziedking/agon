import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PostgresAgonRepository, type AgonPrizeClaimProjection, type AgonSyndicateContributionProjection } from "../../src/agon/store/repository.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

const ACTOR = `0x${"11".repeat(20)}` as `0x${string}`;
const REGISTRY = `0x${"22".repeat(20)}` as `0x${string}`;
const VAULT = `0x${"33".repeat(20)}` as `0x${string}`;
const BENEFICIARY = ACTOR;
const hash = (byte: string) => `0x${byte.repeat(64)}` as `0x${string}`;

let database: AgonTestDatabase;
let repository: PostgresAgonRepository;

before(async () => { database = await createAgonTestDatabase("syndicateprize"); repository = new PostgresAgonRepository(database.pool); });
after(async () => { await database.close(); });

function contribution(overrides: Partial<AgonSyndicateContributionProjection> = {}): AgonSyndicateContributionProjection {
  return {
    intentId: "00000000-0000-4000-8000-000000000201", actor: ACTOR, idempotencyKey: "syndicate-db-001",
    registryContract: REGISTRY, syndicateId: "7", agentId: "42", contributionKey: hash("1"), score: "900", evidenceHash: hash("2"),
    state: "prepared", transactionHash: null, ...overrides,
  };
}

function claim(overrides: Partial<AgonPrizeClaimProjection> = {}): AgonPrizeClaimProjection {
  return {
    intentId: "00000000-0000-4000-8000-000000000202", actor: ACTOR, idempotencyKey: "prize-claim-db-001",
    vaultContract: VAULT, poolKey: hash("3"), index: "0", beneficiary: BENEFICIARY, amount: "1000", proof: [hash("4")], leaf: hash("5"),
    state: "prepared", transactionHash: null, ...overrides,
  };
}

test("syndicate contribution intent is idempotent and rejects marker replacement", async () => {
  const created = await repository.prepareAgonSyndicateContribution(contribution());
  const replay = await repository.prepareAgonSyndicateContribution(contribution({ intentId: "00000000-0000-4000-8000-000000000203" }));
  assert.equal(replay.intentId, created.intentId);
  const tx = hash("6");
  assert.equal((await repository.markAgonSyndicateContributionSubmitted({ intentId: created.intentId, transactionHash: tx })).state, "submitted");
  assert.equal((await repository.markAgonSyndicateContributionSubmitted({ intentId: created.intentId, transactionHash: tx })).transactionHash, tx);
  assert.equal((await repository.confirmAgonSyndicateContribution(created.intentId)).state, "confirmed");
  assert.equal((await repository.markAgonSyndicateContributionSubmitted({ intentId: created.intentId, transactionHash: tx })).state, "confirmed");
  await assert.rejects(() => repository.markAgonSyndicateContributionSubmitted({ intentId: created.intentId, transactionHash: hash("7") }), /submitted/);
});

test("prize claim intent pins proof, beneficiary, and index zero", async () => {
  const created = await repository.prepareAgonPrizeClaim(claim());
  const replay = await repository.prepareAgonPrizeClaim(claim({ intentId: "00000000-0000-4000-8000-000000000204" }));
  assert.equal(replay.intentId, created.intentId);
  assert.equal(created.index, "0");
  assert.deepEqual(created.proof, [hash("4")]);
  const tx = hash("8");
  await repository.markAgonPrizeClaimSubmitted({ intentId: created.intentId, transactionHash: tx });
  assert.equal((await repository.confirmAgonPrizeClaim(created.intentId)).state, "confirmed");
  await assert.rejects(() => repository.prepareAgonPrizeClaim(claim({ intentId: "00000000-0000-4000-8000-000000000205", leaf: hash("9") })), /different claim/);
});
