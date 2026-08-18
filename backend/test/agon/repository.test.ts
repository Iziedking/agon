import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import {
  PostgresAgonRepository,
  type ListingProjection,
  type ValidatedListingVersion,
} from "../../src/agon/store/repository.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

const CHAIN_ID = 50_420_02n;
const PROFILE_REGISTRY = "0x1111111111111111111111111111111111111111";
const IDENTITY_REGISTRY = "0x2222222222222222222222222222222222222222";
const SERVICE_REGISTRY = "0x3333333333333333333333333333333333333333";
const PROVIDER = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const SERVICE_KEY = `0x${"44".repeat(32)}`;
const MANIFEST_HASH = `0x${"55".repeat(32)}`;
const TX_HASH = `0x${"66".repeat(32)}`;
const BLOCK_HASH = `0x${"77".repeat(32)}`;

let database: AgonTestDatabase;
let pool: pg.Pool;
let repository: PostgresAgonRepository;

before(async () => {
  database = await createAgonTestDatabase("repository");
  pool = database.pool;
  repository = new PostgresAgonRepository(pool);
});

after(async () => {
  await database.close();
});

function validatedVersion(overrides: Partial<ValidatedListingVersion> = {}): ValidatedListingVersion {
  return {
    chainId: CHAIN_ID,
    serviceRegistry: SERVICE_REGISTRY,
    listingId: 1n,
    version: 1n,
    manifestHash: MANIFEST_HASH,
    manifestUri: "ipfs://manifest-v1",
    paymentRail: "X402",
    providerSnapshot: PROVIDER,
    validatedAt: new Date("2026-08-17T10:00:00.000Z"),
    ...overrides,
  };
}

function listing(overrides: Partial<ListingProjection> = {}): ListingProjection {
  return {
    chainId: CHAIN_ID,
    serviceRegistry: SERVICE_REGISTRY,
    listingId: 1n,
    agentId: 42n,
    serviceKey: SERVICE_KEY,
    category: 1n,
    currentVersion: 1n,
    manifestHash: MANIFEST_HASH,
    manifestUri: "ipfs://manifest-v1",
    paymentRail: "X402",
    providerSnapshot: PROVIDER,
    status: "Listed",
    verification: "Unverified",
    quarantineReason: null,
    sourceBlockNumber: 100n,
    sourceTxHash: TX_HASH,
    sourceLogIndex: 0,
    observedAt: new Date("2026-08-17T10:01:00.000Z"),
    ...overrides,
  };
}

test("stores lowercase profile ownership snapshots", async () => {
  await repository.withTransaction(async (tx) => {
    await tx.upsertProfile({
      chainId: CHAIN_ID,
      profileRegistry: PROFILE_REGISTRY.toUpperCase().replace("0X", "0x"),
      identityRegistry: IDENTITY_REGISTRY,
      agentId: 42n,
      ownerSnapshot: PROVIDER,
      metadataUri: "ipfs://profile",
      status: "Active",
      suspensionReason: null,
      sourceBlockNumber: 10n,
      sourceTxHash: TX_HASH,
      sourceLogIndex: 0,
      observedAt: new Date("2026-08-17T10:00:00.000Z"),
    });
  });

  const profile = await repository.getProfile({
    chainId: CHAIN_ID,
    profileRegistry: PROFILE_REGISTRY,
    agentId: 42n,
  });
  assert.equal(profile?.ownerSnapshot, PROVIDER.toLowerCase());
  assert.equal(profile?.profileRegistry, PROFILE_REGISTRY);
});

test("keeps listing versions immutable and service keys unique per agent", async () => {
  await repository.withTransaction(async (tx) => {
    await tx.insertValidatedListingVersion(validatedVersion());
    await tx.upsertListing(listing());
  });

  await assert.rejects(
    repository.withTransaction((tx) =>
      tx.insertValidatedListingVersion(validatedVersion({ manifestHash: `0x${"88".repeat(32)}` })),
    ),
    /immutable listing version/i,
  );

  await assert.rejects(
    repository.withTransaction((tx) =>
      tx.upsertListing(listing({ listingId: 2n, sourceLogIndex: 1 })),
    ),
    /agon_listings_service_key_unique|duplicate key/i,
  );
});

test("enforces append-only listing audits", async () => {
  await repository.withTransaction(async (tx) => {
    await tx.appendListingEvent({
      chainId: CHAIN_ID,
      serviceRegistry: SERVICE_REGISTRY,
      listingId: 1n,
      version: 1n,
      eventType: "published",
      payload: { manifestHash: MANIFEST_HASH },
      txHash: TX_HASH,
      logIndex: 0,
      blockNumber: 100n,
      blockHash: BLOCK_HASH,
      observedAt: new Date("2026-08-17T10:01:00.000Z"),
    });
  });

  await assert.rejects(
    pool.query("update agon_listing_events set event_type = 'quarantined'"),
    /append-only/i,
  );
  await assert.rejects(pool.query("delete from agon_listing_events"), /append-only/i);
});

test("rolls back projections, audits, and cursor changes together", async () => {
  await assert.rejects(
    repository.withTransaction(async (tx) => {
      await tx.upsertProfile({
        chainId: CHAIN_ID,
        profileRegistry: PROFILE_REGISTRY,
        identityRegistry: IDENTITY_REGISTRY,
        agentId: 99n,
        ownerSnapshot: PROVIDER,
        metadataUri: "ipfs://rollback",
        status: "Active",
        suspensionReason: null,
        sourceBlockNumber: 20n,
        sourceTxHash: `0x${"99".repeat(32)}`,
        sourceLogIndex: 0,
        observedAt: new Date("2026-08-17T10:02:00.000Z"),
      });
      await tx.advanceIndexerCursor({
        streamName: "profiles",
        chainId: CHAIN_ID,
        contractAddress: PROFILE_REGISTRY,
        lastBlock: 20n,
        lastBlockHash: BLOCK_HASH,
      });
      throw new Error("force rollback");
    }),
    /force rollback/,
  );

  assert.equal(
    await repository.getProfile({ chainId: CHAIN_ID, profileRegistry: PROFILE_REGISTRY, agentId: 99n }),
    null,
  );
  assert.equal(
    await repository.getIndexerCursor({
      streamName: "profiles",
      chainId: CHAIN_ID,
      contractAddress: PROFILE_REGISTRY,
    }),
    null,
  );
});

test("keeps projector cursors independent", async () => {
  await repository.withTransaction(async (tx) => {
    await tx.advanceIndexerCursor({
      streamName: "profiles",
      chainId: CHAIN_ID,
      contractAddress: PROFILE_REGISTRY,
      lastBlock: 40n,
      lastBlockHash: BLOCK_HASH,
    });
    await tx.advanceIndexerCursor({
      streamName: "services",
      chainId: CHAIN_ID,
      contractAddress: SERVICE_REGISTRY,
      lastBlock: 80n,
      lastBlockHash: `0x${"aa".repeat(32)}`,
    });
  });

  const profileCursor = await repository.getIndexerCursor({
    streamName: "profiles",
    chainId: CHAIN_ID,
    contractAddress: PROFILE_REGISTRY,
  });
  const serviceCursor = await repository.getIndexerCursor({
    streamName: "services",
    chainId: CHAIN_ID,
    contractAddress: SERVICE_REGISTRY,
  });
  assert.equal(profileCursor?.lastBlock, 40n);
  assert.equal(serviceCursor?.lastBlock, 80n);
});
