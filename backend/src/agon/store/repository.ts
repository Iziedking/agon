import type { Pool, PoolClient, QueryResultRow } from "pg";

export type ProfileStatus = "Active" | "Suspended" | "Archived";
export type ListingStatus = "Listed" | "Suspended" | "Delisted";
export type VerificationStatus =
  | "Unverified"
  | "Pending"
  | "Verified"
  | "Expired"
  | "Suspended"
  | "Revoked";
export type PaymentRail = "X402" | "Escrow";
export type ListingEventType =
  | "published"
  | "version_published"
  | "status_changed"
  | "verification_changed"
  | "quarantined";

export type ProfileKey = {
  chainId: bigint;
  profileRegistry: string;
  agentId: bigint;
};

export type ProfileProjection = ProfileKey & {
  identityRegistry: string;
  ownerSnapshot: string;
  metadataUri: string;
  status: ProfileStatus;
  suspensionReason: string | null;
  sourceBlockNumber: bigint;
  sourceTxHash: string;
  sourceLogIndex: number;
  observedAt: Date;
};

export type StoredProfile = ProfileProjection & {
  createdAt: Date;
  updatedAt: Date;
};

export type ListingKey = {
  chainId: bigint;
  serviceRegistry: string;
  listingId: bigint;
};

export type ListingProjection = ListingKey & {
  agentId: bigint;
  serviceKey: string;
  category: bigint;
  currentVersion: bigint;
  manifestHash: string;
  manifestUri: string;
  paymentRail: PaymentRail;
  providerSnapshot: string;
  chainStatus?: ListingStatus;
  status: ListingStatus;
  verification: VerificationStatus;
  quarantineReason: string | null;
  sourceBlockNumber: bigint;
  sourceTxHash: string;
  sourceLogIndex: number;
  observedAt: Date;
};

export type StoredListing = Omit<ListingProjection, "chainStatus"> & {
  chainStatus: ListingStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type ListingCursor = {
  updatedAt: Date;
  chainId: bigint;
  serviceRegistry: string;
  listingId: bigint;
};

export type ListingSearch = {
  limit: number;
  cursor: ListingCursor | null;
  category: bigint | null;
  agentId: bigint | null;
};

export type ValidatedListingVersion = ListingKey & {
  version: bigint;
  manifestHash: string;
  manifestUri: string;
  paymentRail: PaymentRail;
  providerSnapshot: string;
  validatedAt: Date;
};

export type ListingAudit = ListingKey & {
  version: bigint | null;
  eventType: ListingEventType;
  payload: Record<string, unknown>;
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  blockHash: string;
  observedAt: Date;
};

export type ChainEventRecord = {
  chainId: bigint;
  contractAddress: string;
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  blockHash: string;
  eventName: string;
  args: Record<string, unknown>;
  observedAt: Date;
};

export type IndexerCursorKey = {
  streamName: string;
  chainId: bigint;
  contractAddress: string;
};

export type IndexerCursor = IndexerCursorKey & {
  lastBlock: bigint;
  lastBlockHash: string;
  updatedAt?: Date;
};

type ProfileRow = QueryResultRow & {
  chain_id: string;
  profile_registry_address: string;
  identity_registry_address: string;
  agent_id: string;
  owner_snapshot: string;
  metadata_uri: string;
  status: ProfileStatus;
  suspension_reason: string | null;
  source_block_number: string;
  source_tx_hash: string;
  source_log_index: number;
  created_at: Date;
  updated_at: Date;
};

type ListingRow = QueryResultRow & {
  chain_id: string;
  service_registry_address: string;
  listing_id: string;
  agent_id: string;
  service_key: string;
  category: string;
  current_version: string;
  manifest_hash: string;
  manifest_uri: string;
  payment_rail: PaymentRail;
  provider_snapshot: string;
  chain_status: ListingStatus;
  status: ListingStatus;
  verification: VerificationStatus;
  quarantine_reason: string | null;
  source_block_number: string;
  source_tx_hash: string;
  source_log_index: number;
  created_at: Date;
  updated_at: Date;
};

type VersionRow = QueryResultRow & {
  chain_id: string;
  service_registry_address: string;
  listing_id: string;
  version: string;
  manifest_hash: string;
  manifest_uri: string;
  payment_rail: PaymentRail;
  provider_snapshot: string;
  validated_at: Date;
};

type CursorRow = QueryResultRow & {
  stream_name: string;
  chain_id: string;
  contract_address: string;
  last_block: string;
  last_block_hash: string;
  updated_at: Date;
};

export class AgonStoreInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgonStoreInvariantError";
  }
}

function normalizeAddress(value: string): string {
  if (!/^0x[0-9a-f]{40}$/i.test(value)) {
    throw new AgonStoreInvariantError(`invalid EVM address: ${value}`);
  }
  return value.toLowerCase();
}

function normalizeHash(value: string): string {
  if (!/^0x[0-9a-f]{64}$/i.test(value)) {
    throw new AgonStoreInvariantError(`invalid bytes32 hash: ${value}`);
  }
  return value.toLowerCase();
}

function requirePositive(value: bigint, label: string): string {
  if (value <= 0n) throw new AgonStoreInvariantError(`${label} must be positive`);
  return value.toString();
}

function requireNonNegative(value: bigint, label: string): string {
  if (value < 0n) throw new AgonStoreInvariantError(`${label} must be non-negative`);
  return value.toString();
}

function requireLogIndex(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AgonStoreInvariantError("log index must be a non-negative safe integer");
  }
  return value;
}

function requireText(value: string, label: string): string {
  if (value.length === 0) throw new AgonStoreInvariantError(`${label} must not be empty`);
  return value;
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, jsonSafe(entry)]));
  }
  return value;
}

function mapProfile(row: ProfileRow): StoredProfile {
  return {
    chainId: BigInt(row.chain_id),
    profileRegistry: row.profile_registry_address,
    identityRegistry: row.identity_registry_address,
    agentId: BigInt(row.agent_id),
    ownerSnapshot: row.owner_snapshot,
    metadataUri: row.metadata_uri,
    status: row.status,
    suspensionReason: row.suspension_reason,
    sourceBlockNumber: BigInt(row.source_block_number),
    sourceTxHash: row.source_tx_hash,
    sourceLogIndex: row.source_log_index,
    observedAt: row.updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapListing(row: ListingRow): StoredListing {
  return {
    chainId: BigInt(row.chain_id),
    serviceRegistry: row.service_registry_address,
    listingId: BigInt(row.listing_id),
    agentId: BigInt(row.agent_id),
    serviceKey: row.service_key,
    category: BigInt(row.category),
    currentVersion: BigInt(row.current_version),
    manifestHash: row.manifest_hash,
    manifestUri: row.manifest_uri,
    paymentRail: row.payment_rail,
    providerSnapshot: row.provider_snapshot,
    chainStatus: row.chain_status,
    status: row.status,
    verification: row.verification,
    quarantineReason: row.quarantine_reason,
    sourceBlockNumber: BigInt(row.source_block_number),
    sourceTxHash: row.source_tx_hash,
    sourceLogIndex: row.source_log_index,
    observedAt: row.updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapVersion(row: VersionRow): ValidatedListingVersion {
  return {
    chainId: BigInt(row.chain_id),
    serviceRegistry: row.service_registry_address,
    listingId: BigInt(row.listing_id),
    version: BigInt(row.version),
    manifestHash: row.manifest_hash,
    manifestUri: row.manifest_uri,
    paymentRail: row.payment_rail,
    providerSnapshot: row.provider_snapshot,
    validatedAt: row.validated_at,
  };
}

function versionsMatch(left: ValidatedListingVersion, right: ValidatedListingVersion): boolean {
  return (
    left.chainId === right.chainId &&
    left.serviceRegistry === normalizeAddress(right.serviceRegistry) &&
    left.listingId === right.listingId &&
    left.version === right.version &&
    left.manifestHash === normalizeHash(right.manifestHash) &&
    left.manifestUri === right.manifestUri &&
    left.paymentRail === right.paymentRail &&
    left.providerSnapshot === normalizeAddress(right.providerSnapshot)
  );
}

const PROFILE_COLUMNS = `
  chain_id, profile_registry_address, identity_registry_address, agent_id,
  owner_snapshot, metadata_uri, status, suspension_reason, source_block_number,
  source_tx_hash, source_log_index, created_at, updated_at`;

const LISTING_COLUMNS = `
  chain_id, service_registry_address, listing_id, agent_id, service_key, category,
  current_version, manifest_hash, manifest_uri, payment_rail, provider_snapshot,
  chain_status, status, verification, quarantine_reason, source_block_number,
  source_tx_hash, source_log_index, created_at, updated_at`;

export class PostgresAgonRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async withTransaction<T>(work: (repository: AgonTransactionRepository) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await work(new AgonTransactionRepository(client));
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getProfile(key: ProfileKey): Promise<StoredProfile | null> {
    const result = await this.pool.query<ProfileRow>(
      `select ${PROFILE_COLUMNS} from agon_profiles
       where chain_id = $1 and profile_registry_address = $2 and agent_id = $3`,
      [requirePositive(key.chainId, "chain id"), normalizeAddress(key.profileRegistry), requirePositive(key.agentId, "agent id")],
    );
    return result.rows[0] ? mapProfile(result.rows[0]) : null;
  }

  async getListing(key: ListingKey): Promise<StoredListing | null> {
    const result = await this.pool.query<ListingRow>(
      `select ${LISTING_COLUMNS} from agon_listings
       where chain_id = $1 and service_registry_address = $2 and listing_id = $3`,
      [requirePositive(key.chainId, "chain id"), normalizeAddress(key.serviceRegistry), requirePositive(key.listingId, "listing id")],
    );
    return result.rows[0] ? mapListing(result.rows[0]) : null;
  }

  async listListings(search: ListingSearch): Promise<StoredListing[]> {
    if (!Number.isSafeInteger(search.limit) || search.limit < 1 || search.limit > 100) {
      throw new AgonStoreInvariantError("listing limit must be between 1 and 100");
    }
    const clauses: string[] = [];
    const params: unknown[] = [];
    const parameter = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };

    if (search.cursor) {
      const updatedAt = parameter(search.cursor.updatedAt);
      const chainId = parameter(requirePositive(search.cursor.chainId, "cursor chain id"));
      const registry = parameter(normalizeAddress(search.cursor.serviceRegistry));
      const listingId = parameter(requirePositive(search.cursor.listingId, "cursor listing id"));
      clauses.push(
        `(updated_at, chain_id, service_registry_address, listing_id) < ` +
          `(${updatedAt}::timestamptz, ${chainId}::numeric, ${registry}::text, ${listingId}::numeric)`,
      );
    }
    if (search.category !== null) {
      clauses.push(`category = ${parameter(requirePositive(search.category, "category"))}`);
    }
    if (search.agentId !== null) {
      clauses.push(`agent_id = ${parameter(requirePositive(search.agentId, "agent id"))}`);
    }

    const limit = parameter(search.limit + 1);
    const where = clauses.length > 0 ? `where ${clauses.join(" and ")}` : "";
    const result = await this.pool.query<ListingRow>(
      `select ${LISTING_COLUMNS} from agon_listings
       ${where}
       order by updated_at desc, chain_id desc, service_registry_address desc, listing_id desc
       limit ${limit}`,
      params,
    );
    return result.rows.map(mapListing);
  }

  async getIndexerCursor(key: IndexerCursorKey): Promise<IndexerCursor | null> {
    const result = await this.pool.query<CursorRow>(
      `select stream_name, chain_id, contract_address, last_block, last_block_hash, updated_at
       from agon_indexer_state
       where stream_name = $1 and chain_id = $2 and contract_address = $3`,
      [requireText(key.streamName, "stream name"), requirePositive(key.chainId, "chain id"), normalizeAddress(key.contractAddress)],
    );
    const row = result.rows[0];
    return row
      ? {
          streamName: row.stream_name,
          chainId: BigInt(row.chain_id),
          contractAddress: row.contract_address,
          lastBlock: BigInt(row.last_block),
          lastBlockHash: row.last_block_hash,
          updatedAt: row.updated_at,
        }
      : null;
  }
}

export class AgonTransactionRepository {
  private readonly client: PoolClient;

  constructor(client: PoolClient) {
    this.client = client;
  }

  async getProfile(key: ProfileKey): Promise<StoredProfile | null> {
    const result = await this.client.query<ProfileRow>(
      `select ${PROFILE_COLUMNS} from agon_profiles
       where chain_id = $1 and profile_registry_address = $2 and agent_id = $3`,
      [requirePositive(key.chainId, "chain id"), normalizeAddress(key.profileRegistry), requirePositive(key.agentId, "agent id")],
    );
    return result.rows[0] ? mapProfile(result.rows[0]) : null;
  }

  async upsertProfile(profile: ProfileProjection): Promise<void> {
    await this.client.query(
      `insert into agon_profiles (
         chain_id, profile_registry_address, identity_registry_address, agent_id,
         owner_snapshot, metadata_uri, status, suspension_reason, source_block_number,
         source_tx_hash, source_log_index, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
       on conflict (chain_id, profile_registry_address, agent_id) do update set
         owner_snapshot = excluded.owner_snapshot,
         metadata_uri = excluded.metadata_uri,
         status = excluded.status,
         suspension_reason = excluded.suspension_reason,
         source_block_number = excluded.source_block_number,
         source_tx_hash = excluded.source_tx_hash,
         source_log_index = excluded.source_log_index,
         updated_at = excluded.updated_at`,
      [
        requirePositive(profile.chainId, "chain id"),
        normalizeAddress(profile.profileRegistry),
        normalizeAddress(profile.identityRegistry),
        requirePositive(profile.agentId, "agent id"),
        normalizeAddress(profile.ownerSnapshot),
        requireText(profile.metadataUri, "metadata URI"),
        profile.status,
        profile.suspensionReason ? normalizeHash(profile.suspensionReason) : null,
        requireNonNegative(profile.sourceBlockNumber, "source block number"),
        normalizeHash(profile.sourceTxHash),
        requireLogIndex(profile.sourceLogIndex),
        profile.observedAt,
      ],
    );
  }

  async getListing(key: ListingKey): Promise<StoredListing | null> {
    const result = await this.client.query<ListingRow>(
      `select ${LISTING_COLUMNS} from agon_listings
       where chain_id = $1 and service_registry_address = $2 and listing_id = $3`,
      [requirePositive(key.chainId, "chain id"), normalizeAddress(key.serviceRegistry), requirePositive(key.listingId, "listing id")],
    );
    return result.rows[0] ? mapListing(result.rows[0]) : null;
  }

  async upsertListing(listing: ListingProjection): Promise<void> {
    await this.client.query(
      `insert into agon_listings (
         chain_id, service_registry_address, listing_id, agent_id, service_key, category,
         current_version, manifest_hash, manifest_uri, payment_rail, provider_snapshot,
         chain_status, status, verification, quarantine_reason, source_block_number,
         source_tx_hash, source_log_index, created_at, updated_at
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15, $16, $17, $18, $19, $19
       )
       on conflict (chain_id, service_registry_address, listing_id) do update set
         current_version = excluded.current_version,
         manifest_hash = excluded.manifest_hash,
         manifest_uri = excluded.manifest_uri,
         payment_rail = excluded.payment_rail,
         provider_snapshot = excluded.provider_snapshot,
         chain_status = excluded.chain_status,
         status = excluded.status,
         verification = excluded.verification,
         quarantine_reason = excluded.quarantine_reason,
         source_block_number = excluded.source_block_number,
         source_tx_hash = excluded.source_tx_hash,
         source_log_index = excluded.source_log_index,
         updated_at = excluded.updated_at`,
      [
        requirePositive(listing.chainId, "chain id"),
        normalizeAddress(listing.serviceRegistry),
        requirePositive(listing.listingId, "listing id"),
        requirePositive(listing.agentId, "agent id"),
        normalizeHash(listing.serviceKey),
        requirePositive(listing.category, "category"),
        requirePositive(listing.currentVersion, "listing version"),
        normalizeHash(listing.manifestHash),
        requireText(listing.manifestUri, "manifest URI"),
        listing.paymentRail,
        normalizeAddress(listing.providerSnapshot),
        listing.chainStatus ?? listing.status,
        listing.status,
        listing.verification,
        listing.quarantineReason,
        requireNonNegative(listing.sourceBlockNumber, "source block number"),
        normalizeHash(listing.sourceTxHash),
        requireLogIndex(listing.sourceLogIndex),
        listing.observedAt,
      ],
    );
  }

  async insertValidatedListingVersion(version: ValidatedListingVersion): Promise<void> {
    const normalized: ValidatedListingVersion = {
      ...version,
      serviceRegistry: normalizeAddress(version.serviceRegistry),
      manifestHash: normalizeHash(version.manifestHash),
      providerSnapshot: normalizeAddress(version.providerSnapshot),
    };
    const inserted = await this.client.query(
      `insert into agon_listing_versions (
         chain_id, service_registry_address, listing_id, version, manifest_hash,
         manifest_uri, payment_rail, provider_snapshot, validated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (chain_id, service_registry_address, listing_id, version) do nothing
       returning version`,
      [
        requirePositive(normalized.chainId, "chain id"),
        normalized.serviceRegistry,
        requirePositive(normalized.listingId, "listing id"),
        requirePositive(normalized.version, "listing version"),
        normalized.manifestHash,
        requireText(normalized.manifestUri, "manifest URI"),
        normalized.paymentRail,
        normalized.providerSnapshot,
        normalized.validatedAt,
      ],
    );
    if ((inserted.rowCount ?? 0) > 0) return;

    const existing = await this.getValidatedListingVersion(normalized);
    if (!existing || !versionsMatch(existing, normalized)) {
      throw new AgonStoreInvariantError("immutable listing version conflicts with existing validation");
    }
  }

  async getValidatedListingVersion(
    key: ListingKey & { version: bigint },
  ): Promise<ValidatedListingVersion | null> {
    const result = await this.client.query<VersionRow>(
      `select chain_id, service_registry_address, listing_id, version, manifest_hash,
              manifest_uri, payment_rail, provider_snapshot, validated_at
       from agon_listing_versions
       where chain_id = $1 and service_registry_address = $2 and listing_id = $3 and version = $4`,
      [
        requirePositive(key.chainId, "chain id"),
        normalizeAddress(key.serviceRegistry),
        requirePositive(key.listingId, "listing id"),
        requirePositive(key.version, "listing version"),
      ],
    );
    return result.rows[0] ? mapVersion(result.rows[0]) : null;
  }

  async hasValidatedListingVersion(key: ListingKey): Promise<boolean> {
    const result = await this.client.query(
      `select 1 from agon_listing_versions
       where chain_id = $1 and service_registry_address = $2 and listing_id = $3
       limit 1`,
      [requirePositive(key.chainId, "chain id"), normalizeAddress(key.serviceRegistry), requirePositive(key.listingId, "listing id")],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async appendListingEvent(event: ListingAudit): Promise<boolean> {
    const result = await this.client.query(
      `insert into agon_listing_events (
         chain_id, service_registry_address, listing_id, version, event_type,
         payload, tx_hash, log_index, block_number, block_hash, observed_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (chain_id, tx_hash, log_index, event_type) do nothing
       returning id`,
      [
        requirePositive(event.chainId, "chain id"),
        normalizeAddress(event.serviceRegistry),
        requirePositive(event.listingId, "listing id"),
        event.version === null ? null : requirePositive(event.version, "listing version"),
        event.eventType,
        jsonSafe(event.payload),
        normalizeHash(event.txHash),
        requireLogIndex(event.logIndex),
        requireNonNegative(event.blockNumber, "block number"),
        normalizeHash(event.blockHash),
        event.observedAt,
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async insertChainEvent(event: ChainEventRecord): Promise<boolean> {
    const result = await this.client.query(
      `insert into agon_chain_events (
         chain_id, contract_address, tx_hash, log_index, block_number,
         block_hash, event_name, args, observed_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (chain_id, tx_hash, log_index) do nothing
       returning log_index`,
      [
        requirePositive(event.chainId, "chain id"),
        normalizeAddress(event.contractAddress),
        normalizeHash(event.txHash),
        requireLogIndex(event.logIndex),
        requireNonNegative(event.blockNumber, "block number"),
        normalizeHash(event.blockHash),
        requireText(event.eventName, "event name"),
        jsonSafe(event.args),
        event.observedAt,
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async advanceIndexerCursor(cursor: IndexerCursor): Promise<void> {
    await this.client.query(
      `insert into agon_indexer_state (
         stream_name, chain_id, contract_address, last_block, last_block_hash, updated_at
       ) values ($1, $2, $3, $4, $5, now())
       on conflict (stream_name, chain_id, contract_address) do update set
         last_block = excluded.last_block,
         last_block_hash = excluded.last_block_hash,
         updated_at = now()
       where excluded.last_block >= agon_indexer_state.last_block`,
      [
        requireText(cursor.streamName, "stream name"),
        requirePositive(cursor.chainId, "chain id"),
        normalizeAddress(cursor.contractAddress),
        requireNonNegative(cursor.lastBlock, "last block"),
        normalizeHash(cursor.lastBlockHash),
      ],
    );
  }
}
