import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { PostgresAgonRepository } from "../../src/agon/store/repository.ts";
import { AgonProjector, type AgonChainEvent } from "../../src/agon/store/projector.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

const CHAIN_ID = 50_420_02n;
const PROFILE_REGISTRY = "0x1111111111111111111111111111111111111111";
const IDENTITY_REGISTRY = "0x2222222222222222222222222222222222222222";
const SERVICE_REGISTRY = "0x3333333333333333333333333333333333333333";
const PROVIDER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const NEW_OWNER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const SERVICE_KEY = `0x${"44".repeat(32)}`;
const MANIFEST_HASH = `0x${"55".repeat(32)}`;
const BLOCK_HASH = `0x${"77".repeat(32)}`;

let database: AgonTestDatabase;
let pool: pg.Pool;
let repository: PostgresAgonRepository;
let projector: AgonProjector;

before(async () => {
  database = await createAgonTestDatabase("projector");
  pool = database.pool;
  repository = new PostgresAgonRepository(pool);
  projector = new AgonProjector(repository);
});

after(async () => {
  await database.close();
});

function chainEvent(
  event: AgonChainEvent["event"],
  overrides: Partial<Omit<AgonChainEvent, "event">> = {},
): AgonChainEvent {
  return {
    chainId: CHAIN_ID,
    contractAddress: SERVICE_REGISTRY,
    identityRegistry: IDENTITY_REGISTRY,
    blockNumber: 100n,
    blockHash: BLOCK_HASH,
    blockTimestamp: new Date("2026-08-17T11:00:00.000Z"),
    txHash: `0x${"66".repeat(32)}`,
    logIndex: 0,
    event,
    ...overrides,
  };
}

function publishedEvent(overrides: Record<string, unknown> = {}): AgonChainEvent["event"] {
  return {
    name: "ListingPublished",
    args: {
      listingId: 1n,
      agentId: 42n,
      serviceKey: SERVICE_KEY,
      manifestHash: MANIFEST_HASH,
      manifestUri: "ipfs://manifest-v1",
      category: 1n,
      paymentRail: "X402",
      version: 1n,
      providerSnapshot: PROVIDER,
      status: "Listed",
      verification: "Unverified",
      ...overrides,
    },
  } as AgonChainEvent["event"];
}

async function registerValidatedVersion(
  listingId: bigint,
  version: bigint,
  overrides: { manifestHash?: string; providerSnapshot?: string } = {},
) {
  await repository.withTransaction((tx) =>
    tx.insertValidatedListingVersion({
      chainId: CHAIN_ID,
      serviceRegistry: SERVICE_REGISTRY,
      listingId,
      version,
      manifestHash: overrides.manifestHash ?? MANIFEST_HASH,
      manifestUri: `ipfs://manifest-v${version}`,
      paymentRail: "X402",
      providerSnapshot: overrides.providerSnapshot ?? PROVIDER,
      validatedAt: new Date("2026-08-17T10:59:00.000Z"),
    }),
  );
}

test("projects profile ownership snapshots", async () => {
  const bound = chainEvent(
    {
      name: "ProfileBound",
      args: { agentId: 42n, owner: PROVIDER, metadataUri: "ipfs://profile" },
    },
    { contractAddress: PROFILE_REGISTRY, logIndex: 2 },
  );
  const synced = chainEvent(
    {
      name: "OwnershipSynced",
      args: { agentId: 42n, previousOwner: PROVIDER, newOwner: NEW_OWNER },
    },
    {
      contractAddress: PROFILE_REGISTRY,
      blockNumber: 101n,
      txHash: `0x${"67".repeat(32)}`,
      logIndex: 0,
    },
  );

  await projector.projectBatch({
    streamName: "profiles",
    chainId: CHAIN_ID,
    contractAddress: PROFILE_REGISTRY,
    toBlock: 101n,
    toBlockHash: BLOCK_HASH,
    events: [bound, synced],
  });

  const profile = await repository.getProfile({
    chainId: CHAIN_ID,
    profileRegistry: PROFILE_REGISTRY,
    agentId: 42n,
  });
  assert.equal(profile?.ownerSnapshot, NEW_OWNER);
  assert.equal(profile?.metadataUri, "ipfs://profile");
});

test("deduplicates replayed and overlapping chain ranges", async () => {
  await registerValidatedVersion(1n, 1n);
  const published = chainEvent(publishedEvent());
  const first = await projector.projectBatch({
    streamName: "services",
    chainId: CHAIN_ID,
    contractAddress: SERVICE_REGISTRY,
    toBlock: 100n,
    toBlockHash: BLOCK_HASH,
    events: [published],
  });
  const replay = await projector.projectBatch({
    streamName: "services",
    chainId: CHAIN_ID,
    contractAddress: SERVICE_REGISTRY,
    toBlock: 101n,
    toBlockHash: `0x${"78".repeat(32)}`,
    events: [
      published,
      chainEvent(
        {
          name: "ListingStatusChanged",
          args: { listingId: 1n, providerSnapshot: PROVIDER, status: "Suspended" },
        },
        { blockNumber: 101n, txHash: `0x${"68".repeat(32)}`, logIndex: 1 },
      ),
    ],
  });

  assert.deepEqual(first, { inserted: 1, duplicates: 0, quarantined: 0 });
  assert.deepEqual(replay, { inserted: 1, duplicates: 1, quarantined: 0 });
  assert.equal((await repository.getListing({ chainId: CHAIN_ID, serviceRegistry: SERVICE_REGISTRY, listingId: 1n }))?.status, "Suspended");
  const counts = await pool.query<{ chain_events: string; published_audits: string }>(
    `select
       (select count(*) from agon_chain_events where contract_address = $1) as chain_events,
       (select count(*) from agon_listing_events where event_type = 'published') as published_audits`,
    [SERVICE_REGISTRY],
  );
  assert.equal(counts.rows[0]?.chain_events, "2");
  assert.equal(counts.rows[0]?.published_audits, "1");
});

test("quarantines hash, provider, and version anchor mismatches", async () => {
  const cases = [
    {
      listingId: 10n,
      serviceKey: `0x${"10".repeat(32)}`,
      expectedVersion: 1n,
      eventVersion: 1n,
      expectedHash: MANIFEST_HASH,
      eventHash: `0x${"11".repeat(32)}`,
      expectedProvider: PROVIDER,
      eventProvider: PROVIDER,
      reason: "manifest_hash_mismatch",
    },
    {
      listingId: 11n,
      serviceKey: `0x${"12".repeat(32)}`,
      expectedVersion: 1n,
      eventVersion: 1n,
      expectedHash: MANIFEST_HASH,
      eventHash: MANIFEST_HASH,
      expectedProvider: PROVIDER,
      eventProvider: NEW_OWNER,
      reason: "provider_mismatch",
    },
    {
      listingId: 12n,
      serviceKey: `0x${"13".repeat(32)}`,
      expectedVersion: 1n,
      eventVersion: 2n,
      expectedHash: MANIFEST_HASH,
      eventHash: MANIFEST_HASH,
      expectedProvider: PROVIDER,
      eventProvider: PROVIDER,
      reason: "version_mismatch",
    },
  ] as const;

  for (const [index, item] of cases.entries()) {
    await registerValidatedVersion(item.listingId, item.expectedVersion, {
      manifestHash: item.expectedHash,
      providerSnapshot: item.expectedProvider,
    });
    const result = await projector.projectBatch({
      streamName: "services",
      chainId: CHAIN_ID,
      contractAddress: SERVICE_REGISTRY,
      toBlock: BigInt(110 + index),
      toBlockHash: `0x${(80 + index).toString(16).padStart(2, "0").repeat(32)}`,
      events: [
        chainEvent(
          publishedEvent({
            listingId: item.listingId,
            serviceKey: item.serviceKey,
            manifestHash: item.eventHash,
            version: item.eventVersion,
            providerSnapshot: item.eventProvider,
          }),
          {
            blockNumber: BigInt(110 + index),
            txHash: `0x${(90 + index).toString(16).padStart(2, "0").repeat(32)}`,
            logIndex: index,
          },
        ),
      ],
    });

    assert.equal(result.quarantined, 1);
    const listing = await repository.getListing({
      chainId: CHAIN_ID,
      serviceRegistry: SERVICE_REGISTRY,
      listingId: item.listingId,
    });
    assert.equal(listing?.status, "Suspended");
    assert.equal(listing?.quarantineReason, item.reason);
  }

  const audits = await pool.query<{ count: string }>(
    "select count(*) from agon_listing_events where event_type = 'quarantined'",
  );
  assert.equal(audits.rows[0]?.count, "3");
});
