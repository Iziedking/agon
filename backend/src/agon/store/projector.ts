import {
  type AgonTransactionRepository,
  type ListingAudit,
  type ListingKey,
  type ListingStatus,
  type PaymentRail,
  PostgresAgonRepository,
  type ProfileStatus,
  type StoredListing,
  type VerificationStatus,
} from "./repository.ts";

type ProfileBound = {
  name: "ProfileBound";
  args: { agentId: bigint; owner: string; metadataUri: string };
};

type ProfileMetadataUpdated = {
  name: "ProfileMetadataUpdated";
  args: { agentId: bigint; owner: string; metadataUri: string };
};

type ProfileStatusChanged = {
  name: "ProfileStatusChanged";
  args: { agentId: bigint; actor: string; status: ProfileStatus; reason: string };
};

type OwnershipSynced = {
  name: "OwnershipSynced";
  args: { agentId: bigint; previousOwner: string; newOwner: string };
};

type ListingPublished = {
  name: "ListingPublished";
  args: {
    listingId: bigint;
    agentId: bigint;
    serviceKey: string;
    manifestHash: string;
    manifestUri: string;
    category: bigint;
    paymentRail: PaymentRail;
    version: bigint;
    providerSnapshot: string;
    status: ListingStatus;
    verification: VerificationStatus;
  };
};

type ListingVersionPublished = {
  name: "ListingVersionPublished";
  args: {
    listingId: bigint;
    version: bigint;
    manifestHash: string;
    manifestUri: string;
    paymentRail: PaymentRail;
    providerSnapshot: string;
  };
};

type ListingStatusChanged = {
  name: "ListingStatusChanged";
  args: { listingId: bigint; providerSnapshot: string; status: ListingStatus };
};

type ListingVerificationChanged = {
  name: "ListingVerificationChanged";
  args: { listingId: bigint; verifier: string; verification: VerificationStatus };
};

export type AgonProjectableEvent =
  | ProfileBound
  | ProfileMetadataUpdated
  | ProfileStatusChanged
  | OwnershipSynced
  | ListingPublished
  | ListingVersionPublished
  | ListingStatusChanged
  | ListingVerificationChanged;

export type AgonChainEvent = {
  chainId: bigint;
  contractAddress: string;
  identityRegistry?: string;
  blockNumber: bigint;
  blockHash: string;
  blockTimestamp: Date;
  txHash: string;
  logIndex: number;
  event: AgonProjectableEvent;
};

export type AgonProjectionBatch = {
  streamName: string;
  chainId: bigint;
  contractAddress: string;
  toBlock: bigint;
  toBlockHash: string;
  events: AgonChainEvent[];
};

export type AgonProjectionResult = {
  inserted: number;
  duplicates: number;
  quarantined: number;
};

type AnchorMismatch =
  | "missing_validated_version"
  | "version_mismatch"
  | "manifest_hash_mismatch"
  | "provider_mismatch";

function sameHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function eventPayload(event: AgonProjectableEvent): Record<string, unknown> {
  return { name: event.name, ...event.args };
}

function listingAudit(
  chainEvent: AgonChainEvent,
  listingId: bigint,
  version: bigint | null,
  eventType: ListingAudit["eventType"],
  payload: Record<string, unknown>,
): ListingAudit {
  return {
    chainId: chainEvent.chainId,
    serviceRegistry: chainEvent.contractAddress,
    listingId,
    version,
    eventType,
    payload,
    txHash: chainEvent.txHash,
    logIndex: chainEvent.logIndex,
    blockNumber: chainEvent.blockNumber,
    blockHash: chainEvent.blockHash,
    observedAt: chainEvent.blockTimestamp,
  };
}

async function anchorMismatch(
  repository: AgonTransactionRepository,
  key: ListingKey,
  version: bigint,
  manifestHash: string,
  providerSnapshot: string,
): Promise<AnchorMismatch | null> {
  const validated = await repository.getValidatedListingVersion({ ...key, version });
  if (!validated) {
    return (await repository.hasValidatedListingVersion(key))
      ? "version_mismatch"
      : "missing_validated_version";
  }
  if (!sameHex(validated.manifestHash, manifestHash)) return "manifest_hash_mismatch";
  if (!sameHex(validated.providerSnapshot, providerSnapshot)) return "provider_mismatch";
  return null;
}

async function requireProfile(
  repository: AgonTransactionRepository,
  chainEvent: AgonChainEvent,
  agentId: bigint,
) {
  const profile = await repository.getProfile({
    chainId: chainEvent.chainId,
    profileRegistry: chainEvent.contractAddress,
    agentId,
  });
  if (!profile) {
    throw new Error(`profile ${agentId} must be projected before ${chainEvent.event.name}`);
  }
  return profile;
}

async function requireListing(
  repository: AgonTransactionRepository,
  chainEvent: AgonChainEvent,
  listingId: bigint,
): Promise<StoredListing> {
  const listing = await repository.getListing({
    chainId: chainEvent.chainId,
    serviceRegistry: chainEvent.contractAddress,
    listingId,
  });
  if (!listing) {
    throw new Error(`listing ${listingId} must be projected before ${chainEvent.event.name}`);
  }
  return listing;
}

async function projectProfileEvent(
  repository: AgonTransactionRepository,
  chainEvent: AgonChainEvent,
): Promise<void> {
  const event = chainEvent.event;
  if (event.name === "ProfileBound") {
    if (!chainEvent.identityRegistry) {
      throw new Error("identity registry is required for ProfileBound projection");
    }
    await repository.upsertProfile({
      chainId: chainEvent.chainId,
      profileRegistry: chainEvent.contractAddress,
      identityRegistry: chainEvent.identityRegistry,
      agentId: event.args.agentId,
      ownerSnapshot: event.args.owner,
      metadataUri: event.args.metadataUri,
      status: "Active",
      suspensionReason: null,
      sourceBlockNumber: chainEvent.blockNumber,
      sourceTxHash: chainEvent.txHash,
      sourceLogIndex: chainEvent.logIndex,
      observedAt: chainEvent.blockTimestamp,
    });
    return;
  }

  if (event.name === "ProfileMetadataUpdated") {
    const current = await requireProfile(repository, chainEvent, event.args.agentId);
    await repository.upsertProfile({
      ...current,
      ownerSnapshot: event.args.owner,
      metadataUri: event.args.metadataUri,
      sourceBlockNumber: chainEvent.blockNumber,
      sourceTxHash: chainEvent.txHash,
      sourceLogIndex: chainEvent.logIndex,
      observedAt: chainEvent.blockTimestamp,
    });
    return;
  }

  if (event.name === "ProfileStatusChanged") {
    const current = await requireProfile(repository, chainEvent, event.args.agentId);
    await repository.upsertProfile({
      ...current,
      status: event.args.status,
      suspensionReason: event.args.status === "Suspended" ? event.args.reason : null,
      sourceBlockNumber: chainEvent.blockNumber,
      sourceTxHash: chainEvent.txHash,
      sourceLogIndex: chainEvent.logIndex,
      observedAt: chainEvent.blockTimestamp,
    });
    return;
  }

  if (event.name === "OwnershipSynced") {
    const current = await requireProfile(repository, chainEvent, event.args.agentId);
    if (!sameHex(current.ownerSnapshot, event.args.previousOwner)) {
      throw new Error(`profile ${event.args.agentId} ownership history does not match the projected snapshot`);
    }
    await repository.upsertProfile({
      ...current,
      ownerSnapshot: event.args.newOwner,
      sourceBlockNumber: chainEvent.blockNumber,
      sourceTxHash: chainEvent.txHash,
      sourceLogIndex: chainEvent.logIndex,
      observedAt: chainEvent.blockTimestamp,
    });
  }
}

async function projectListingPublished(
  repository: AgonTransactionRepository,
  chainEvent: AgonChainEvent,
  event: ListingPublished,
): Promise<boolean> {
  const key: ListingKey = {
    chainId: chainEvent.chainId,
    serviceRegistry: chainEvent.contractAddress,
    listingId: event.args.listingId,
  };
  const mismatch = await anchorMismatch(
    repository,
    key,
    event.args.version,
    event.args.manifestHash,
    event.args.providerSnapshot,
  );
  await repository.upsertListing({
    ...key,
    agentId: event.args.agentId,
    serviceKey: event.args.serviceKey,
    category: event.args.category,
    currentVersion: event.args.version,
    manifestHash: event.args.manifestHash,
    manifestUri: event.args.manifestUri,
    paymentRail: event.args.paymentRail,
    providerSnapshot: event.args.providerSnapshot,
    chainStatus: event.args.status,
    status: mismatch ? "Suspended" : event.args.status,
    verification: event.args.verification,
    quarantineReason: mismatch,
    sourceBlockNumber: chainEvent.blockNumber,
    sourceTxHash: chainEvent.txHash,
    sourceLogIndex: chainEvent.logIndex,
    observedAt: chainEvent.blockTimestamp,
  });
  await repository.appendListingEvent(
    listingAudit(
      chainEvent,
      event.args.listingId,
      event.args.version,
      "published",
      eventPayload(event),
    ),
  );
  if (mismatch) {
    await repository.appendListingEvent(
      listingAudit(chainEvent, event.args.listingId, event.args.version, "quarantined", {
        reason: mismatch,
        manifestHash: event.args.manifestHash,
        providerSnapshot: event.args.providerSnapshot,
      }),
    );
  }
  return mismatch !== null;
}

async function projectListingVersion(
  repository: AgonTransactionRepository,
  chainEvent: AgonChainEvent,
  event: ListingVersionPublished,
): Promise<boolean> {
  const current = await requireListing(repository, chainEvent, event.args.listingId);
  const key: ListingKey = {
    chainId: chainEvent.chainId,
    serviceRegistry: chainEvent.contractAddress,
    listingId: event.args.listingId,
  };
  const mismatch = await anchorMismatch(
    repository,
    key,
    event.args.version,
    event.args.manifestHash,
    event.args.providerSnapshot,
  );
  await repository.upsertListing({
    ...current,
    currentVersion: event.args.version,
    manifestHash: event.args.manifestHash,
    manifestUri: event.args.manifestUri,
    paymentRail: event.args.paymentRail,
    providerSnapshot: event.args.providerSnapshot,
    status: mismatch ? "Suspended" : current.chainStatus,
    quarantineReason: mismatch,
    sourceBlockNumber: chainEvent.blockNumber,
    sourceTxHash: chainEvent.txHash,
    sourceLogIndex: chainEvent.logIndex,
    observedAt: chainEvent.blockTimestamp,
  });
  await repository.appendListingEvent(
    listingAudit(
      chainEvent,
      event.args.listingId,
      event.args.version,
      "version_published",
      eventPayload(event),
    ),
  );
  if (mismatch) {
    await repository.appendListingEvent(
      listingAudit(chainEvent, event.args.listingId, event.args.version, "quarantined", {
        reason: mismatch,
        manifestHash: event.args.manifestHash,
        providerSnapshot: event.args.providerSnapshot,
      }),
    );
  }
  return mismatch !== null;
}

async function projectListingEvent(
  repository: AgonTransactionRepository,
  chainEvent: AgonChainEvent,
): Promise<boolean> {
  const event = chainEvent.event;
  if (event.name === "ListingPublished") {
    return projectListingPublished(repository, chainEvent, event);
  }
  if (event.name === "ListingVersionPublished") {
    return projectListingVersion(repository, chainEvent, event);
  }
  if (event.name === "ListingStatusChanged") {
    const current = await requireListing(repository, chainEvent, event.args.listingId);
    await repository.upsertListing({
      ...current,
      chainStatus: event.args.status,
      status: current.quarantineReason ? "Suspended" : event.args.status,
      sourceBlockNumber: chainEvent.blockNumber,
      sourceTxHash: chainEvent.txHash,
      sourceLogIndex: chainEvent.logIndex,
      observedAt: chainEvent.blockTimestamp,
    });
    await repository.appendListingEvent(
      listingAudit(
        chainEvent,
        event.args.listingId,
        current.currentVersion,
        "status_changed",
        eventPayload(event),
      ),
    );
    return false;
  }
  if (event.name === "ListingVerificationChanged") {
    const current = await requireListing(repository, chainEvent, event.args.listingId);
    await repository.upsertListing({
      ...current,
      verification: event.args.verification,
      sourceBlockNumber: chainEvent.blockNumber,
      sourceTxHash: chainEvent.txHash,
      sourceLogIndex: chainEvent.logIndex,
      observedAt: chainEvent.blockTimestamp,
    });
    await repository.appendListingEvent(
      listingAudit(
        chainEvent,
        event.args.listingId,
        current.currentVersion,
        "verification_changed",
        eventPayload(event),
      ),
    );
  }
  return false;
}

function isProfileEvent(event: AgonProjectableEvent): event is
  | ProfileBound
  | ProfileMetadataUpdated
  | ProfileStatusChanged
  | OwnershipSynced {
  return (
    event.name === "ProfileBound" ||
    event.name === "ProfileMetadataUpdated" ||
    event.name === "ProfileStatusChanged" ||
    event.name === "OwnershipSynced"
  );
}

export class AgonProjector {
  private readonly repository: PostgresAgonRepository;

  constructor(repository: PostgresAgonRepository) {
    this.repository = repository;
  }

  async projectBatch(batch: AgonProjectionBatch): Promise<AgonProjectionResult> {
    const sortedEvents = [...batch.events].sort((left, right) => {
      if (left.blockNumber !== right.blockNumber) return left.blockNumber < right.blockNumber ? -1 : 1;
      return left.logIndex - right.logIndex;
    });

    return this.repository.withTransaction(async (repository) => {
      const result: AgonProjectionResult = { inserted: 0, duplicates: 0, quarantined: 0 };
      for (const chainEvent of sortedEvents) {
        if (chainEvent.chainId !== batch.chainId) {
          throw new Error("event chain does not match projection batch");
        }
        if (!sameHex(chainEvent.contractAddress, batch.contractAddress)) {
          throw new Error("event contract does not match projection batch");
        }
        if (chainEvent.blockNumber > batch.toBlock) {
          throw new Error("event block is beyond the projection cursor");
        }

        const inserted = await repository.insertChainEvent({
          chainId: chainEvent.chainId,
          contractAddress: chainEvent.contractAddress,
          txHash: chainEvent.txHash,
          logIndex: chainEvent.logIndex,
          blockNumber: chainEvent.blockNumber,
          blockHash: chainEvent.blockHash,
          eventName: chainEvent.event.name,
          args: chainEvent.event.args,
          observedAt: chainEvent.blockTimestamp,
        });
        if (!inserted) {
          result.duplicates += 1;
          continue;
        }

        result.inserted += 1;
        if (isProfileEvent(chainEvent.event)) {
          await projectProfileEvent(repository, chainEvent);
        } else if (await projectListingEvent(repository, chainEvent)) {
          result.quarantined += 1;
        }
      }

      await repository.advanceIndexerCursor({
        streamName: batch.streamName,
        chainId: batch.chainId,
        contractAddress: batch.contractAddress,
        lastBlock: batch.toBlock,
        lastBlockHash: batch.toBlockHash,
      });
      return result;
    });
  }
}
