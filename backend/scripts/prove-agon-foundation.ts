import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { canonicalManifestHash, validateManifest } from "../src/agon/core/manifest.ts";
import { evaluateAgonEscrowTerms } from "../src/agon/escrow-policy.ts";
import { PostgresAgonMarketService } from "../src/agon/http/service.ts";
import { AgonProjector, type AgonChainEvent } from "../src/agon/store/projector.ts";
import { PostgresAgonRepository } from "../src/agon/store/repository.ts";
import { createAgonTestDatabase } from "../test/agon/database-test-helper.ts";

const CHAIN_ID = 5_042_002n;
const PROFILE_REGISTRY = "0x1111111111111111111111111111111111111111";
const IDENTITY_REGISTRY = "0x2222222222222222222222222222222222222222";
const SERVICE_REGISTRY = "0x3333333333333333333333333333333333333333";
const OWNER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SERVICE_KEY = `0x${"44".repeat(32)}`;
const MANIFEST_MISMATCH = `0x${"55".repeat(32)}`;
const BLOCK_HASH = `0x${"77".repeat(32)}`;

function event(
  value: AgonChainEvent["event"],
  overrides: Partial<Omit<AgonChainEvent, "event">> = {},
): AgonChainEvent {
  return {
    chainId: CHAIN_ID,
    contractAddress: SERVICE_REGISTRY,
    blockNumber: 100n,
    blockHash: BLOCK_HASH,
    blockTimestamp: new Date("2026-08-22T00:00:00.000Z"),
    txHash: `0x${"66".repeat(32)}`,
    logIndex: 0,
    event: value,
    ...overrides,
  };
}

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const manifestText = (await readFile(join(here, "../fixtures/agon-service-manifest.json"), "utf8")).replace(/^\uFEFF/, "");
  const manifest = JSON.parse(manifestText) as Record<string, unknown>;
  const manifestValidation = validateManifest(manifest);
  assert.equal(manifestValidation.ok, true, "foundation fixture must validate");
  const manifestHash = canonicalManifestHash(manifest);
  const database = await createAgonTestDatabase("proof");

  try {
    const repository = new PostgresAgonRepository(database.pool);
    const projector = new AgonProjector(repository);
    const service = new PostgresAgonMarketService(repository);

    const profileProjection = await projector.projectBatch({
      streamName: "profiles",
      chainId: CHAIN_ID,
      contractAddress: PROFILE_REGISTRY,
      toBlock: 100n,
      toBlockHash: BLOCK_HASH,
      events: [event(
        { name: "ProfileBound", args: { agentId: 7n, owner: OWNER, metadataUri: "ipfs://agon-profile" } },
        { contractAddress: PROFILE_REGISTRY, identityRegistry: IDENTITY_REGISTRY },
      )],
    });

    await repository.withTransaction((transaction) => transaction.insertValidatedListingVersion({
      chainId: CHAIN_ID,
      serviceRegistry: SERVICE_REGISTRY,
      listingId: 1n,
      version: 1n,
      manifestHash,
      manifestUri: "ipfs://agon-manifest-v1",
      paymentRail: "X402",
      providerSnapshot: OWNER,
      validatedAt: new Date("2026-08-21T23:59:00.000Z"),
    }));

    const listingProjection = await projector.projectBatch({
      streamName: "services",
      chainId: CHAIN_ID,
      contractAddress: SERVICE_REGISTRY,
      toBlock: 101n,
      toBlockHash: `0x${"78".repeat(32)}`,
      events: [event({
        name: "ListingPublished",
        args: {
          listingId: 1n,
          agentId: 7n,
          serviceKey: SERVICE_KEY,
          manifestHash,
          manifestUri: "ipfs://agon-manifest-v1",
          category: 1n,
          paymentRail: "X402",
          version: 1n,
          providerSnapshot: OWNER,
          status: "Listed",
          verification: "Unverified",
        },
      }, { txHash: `0x${"67".repeat(32)}`, logIndex: 0 })],
    });
    assert.equal(profileProjection.inserted, 1);
    assert.equal(listingProjection.inserted, 1);

    const reference = `${CHAIN_ID}:${SERVICE_REGISTRY}:1`;
    const projected = await repository.getListing({ chainId: CHAIN_ID, serviceRegistry: SERVICE_REGISTRY, listingId: 1n });
    assert.ok(projected, "projected listing row must exist");
    const listing = await service.getListing(reference);
    if (!listing.ok) throw new Error(`projected listing was not readable: ${listing.error.code} ${listing.error.message}`);
    assert.equal(listing.value.manifest.hash, manifestHash);
    assert.equal(listing.value.payment.directX402, true);

    const unsafeEndpoint = validateManifest({ ...manifest, endpoint: "http://unsafe.example" });
    assert.equal(unsafeEndpoint.ok, false);

    let duplicateKeyRefused = false;
    try {
      await repository.withTransaction((transaction) => transaction.insertValidatedListingVersion({
        chainId: CHAIN_ID,
        serviceRegistry: SERVICE_REGISTRY,
        listingId: 1n,
        version: 1n,
        manifestHash: MANIFEST_MISMATCH,
        manifestUri: "ipfs://conflicting-manifest",
        paymentRail: "X402",
        providerSnapshot: OWNER,
        validatedAt: new Date("2026-08-22T00:00:00.000Z"),
      }));
    } catch {
      duplicateKeyRefused = true;
    }
    assert.equal(duplicateKeyRefused, true);

    await repository.withTransaction((transaction) => transaction.insertValidatedListingVersion({
      chainId: CHAIN_ID,
      serviceRegistry: SERVICE_REGISTRY,
      listingId: 2n,
      version: 1n,
      manifestHash,
      manifestUri: "ipfs://agon-manifest-v1",
      paymentRail: "X402",
      providerSnapshot: OWNER,
      validatedAt: new Date("2026-08-21T23:59:00.000Z"),
    }));
    const mismatch = await projector.projectBatch({
      streamName: "services",
      chainId: CHAIN_ID,
      contractAddress: SERVICE_REGISTRY,
      toBlock: 102n,
      toBlockHash: `0x${"79".repeat(32)}`,
      events: [event({
        name: "ListingPublished",
        args: {
          listingId: 2n,
          agentId: 7n,
          serviceKey: `0x${"45".repeat(32)}`,
          manifestHash: MANIFEST_MISMATCH,
          manifestUri: "ipfs://wrong-manifest",
          category: 1n,
          paymentRail: "X402",
          version: 1n,
          providerSnapshot: OWNER,
          status: "Listed",
          verification: "Unverified",
        },
        }, { txHash: `0x${"67".repeat(32)}`, logIndex: 1 })],
    });
    assert.equal(mismatch.quarantined, 1);

    const escrowRefusal = evaluateAgonEscrowTerms({
      listing: {
        serviceRegistry: SERVICE_REGISTRY,
        listingId: "1",
        agentId: "7",
        version: "1",
        manifestHash,
        providerSnapshot: OWNER,
        status: "Listed",
        verification: "Unverified",
        paymentRail: "X402",
      },
      buyer: OWNER,
      amountBaseUnits: "1000000",
      feeBps: 0,
      expiresAt: new Date("2026-08-23T00:00:00.000Z"),
      now: new Date("2026-08-22T00:00:00.000Z"),
    });
    assert.equal(escrowRefusal.ok, false);

    console.log(JSON.stringify({
      status: "passed",
      schema: "isolated-test-schema",
      canonicalManifestHash: manifestHash,
      projectedListing: reference,
      listingState: {
        status: listing.value.status,
        verification: listing.value.verification.status,
        directX402: listing.value.payment.directX402,
        escrowEligible: listing.value.payment.escrowEligible,
      },
      refusals: {
        duplicate_key: duplicateKeyRefused,
        unsafe_endpoint: !unsafeEndpoint.ok,
        hash_mismatch: mismatch.quarantined === 1,
        escrow_ineligible_unverified: !escrowRefusal.ok && escrowRefusal.error.code === "escrow_not_eligible",
        owner_scope: "wallet-owned writes remain disabled",
      },
      disclaimer: "Mock/database proof only; no RPC, wallet, provider, payment, or transaction was used.",
    }, null, 2));
  } finally {
    await database.close();
  }
}

main().catch((error) => {
  console.error("Agon proof failed:", error);
  process.exitCode = 1;
});
