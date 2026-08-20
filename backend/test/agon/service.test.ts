import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  PostgresAgonRepository,
  type ListingProjection,
} from "../../src/agon/store/repository.ts";
import { PostgresAgonMarketService } from "../../src/agon/http/service.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

const CHAIN_ID = 50_420_02n;
const SERVICE_REGISTRY = "0x3333333333333333333333333333333333333333";
const PROVIDER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OBSERVED_AT = new Date("2026-08-17T12:00:00.000Z");

let database: AgonTestDatabase;
let repository: PostgresAgonRepository;
let service: PostgresAgonMarketService;

before(async () => {
  database = await createAgonTestDatabase("service");
  repository = new PostgresAgonRepository(database.pool);
  service = new PostgresAgonMarketService(repository);

  await repository.withTransaction(async (tx) => {
    for (const listingId of [1n, 2n, 3n]) {
      const byte = Number(listingId).toString(16).padStart(2, "0");
      const listing: ListingProjection = {
        chainId: CHAIN_ID,
        serviceRegistry: SERVICE_REGISTRY,
        listingId,
        agentId: listingId === 3n ? 77n : 42n,
        serviceKey: `0x${byte.repeat(32)}`,
        category: listingId === 1n ? 9n : 7n,
        currentVersion: 1n,
        manifestHash: `0x${(20 + Number(listingId)).toString(16).repeat(64)}`.slice(0, 66),
        manifestUri: `ipfs://manifest-${listingId}`,
        paymentRail: "X402",
        providerSnapshot: PROVIDER,
        status: "Listed",
        verification: "Unverified",
        quarantineReason: null,
        sourceBlockNumber: 100n + listingId,
        sourceTxHash: `0x${(30 + Number(listingId)).toString(16).repeat(64)}`.slice(0, 66),
        sourceLogIndex: Number(listingId),
        observedAt: OBSERVED_AT,
      };
      await tx.upsertListing(listing);
    }
  });

  await database.pool.query(
    `insert into agon_verification_evidence
      (listing_id, agent_id, passed, evidence_hash, evidence)
     values ($1, $2, $3, $4, $5::jsonb)`,
    [
      "1",
      "42",
      true,
      `0x${"ab".repeat(32)}`,
      JSON.stringify({
        listingId: "1",
        agentId: "42",
        checkedAt: "2026-08-20T08:00:00.000Z",
        passed: true,
        endpointStatus: 402,
        checks: { x402_payment: { passed: true, detail: "endpoint HTTP 402" } },
      }),
    ],
  );
});

after(async () => {
  await database.close();
});

test("paginates deterministically across identical timestamps", async () => {
  const first = await service.listListings({ limit: 2, cursor: null, category: null, agentId: null });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.deepEqual(first.value.items.map((item) => item.listingId), ["3", "2"]);
  assert(first.value.nextCursor);

  const second = await service.listListings({
    limit: 2,
    cursor: first.value.nextCursor,
    category: null,
    agentId: null,
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.deepEqual(second.value.items.map((item) => item.listingId), ["1"]);
  assert.equal(second.value.nextCursor, null);
});

test("maps filters and explicit unverified risk from stored listings", async () => {
  const result = await service.listListings({ limit: 20, cursor: null, category: "9", agentId: "42" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.items.map((item) => item.listingId), ["1"]);
  assert.equal(result.value.items[0]?.risk.unverified, true);
  assert.equal(result.value.items[0]?.payment.directX402, true);
  assert.equal(result.value.items[0]?.payment.escrowEligible, false);
  assert.deepEqual(result.value.items[0]?.endpointQa, {
    status: "passed",
    checkedAt: "2026-08-20T08:00:00.000Z",
    endpointStatus: 402,
    evidenceHash: `0x${"ab".repeat(32)}`,
    reason: "Agon observed the service endpoint returning HTTP 402.",
  });
});

test("keeps direct x402 declared when no endpoint evidence exists", async () => {
  const result = await service.getListing(`${CHAIN_ID}:${SERVICE_REGISTRY}:2`);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.payment.directX402, true);
  assert.equal(result.value.endpointQa.status, "not_checked");
  assert.equal(result.value.endpointQa.endpointStatus, null);
});
