import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { transitionX402Receipt, type X402ReceiptEvent, type X402ReceiptState } from "../execution/x402-receipt.ts";

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

export type StoredVerificationEvidence = {
  listingId: bigint;
  agentId: bigint;
  passed: boolean;
  evidenceHash: string;
  evidence: unknown;
  createdAt: Date;
  attempts: number;
  passedAttempts: number;
};

export type X402CallIntentProjection = {
  intentId: string;
  actor: string;
  idempotencyKey: string;
  listingReference: string;
  chainId: bigint;
  serviceRegistry: string;
  listingId: bigint;
  agentId: bigint;
  version: bigint;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  input: unknown;
  inputHash: string;
  maxAmountUSDC: string;
  targetUrl?: string | null;
  state: "prepared";
  createdAt?: Date;
};

export type StoredX402CallIntent = X402CallIntentProjection & {
  createdAt: Date;
  updatedAt: Date;
};

export type X402CallReceiptProjection = {
  receiptId: string;
  intentId: string;
  state: X402ReceiptState;
  approvedAmountUSDC?: string | null;
  quoteHash: string | null;
  quoteSnapshot?: unknown | null;
  authorizationPayloadHash?: string | null;
  authorizationPayload?: unknown | null;
  authorizationHash: string | null;
  settlementRef: string | null;
  serviceStatus: number | null;
  paymentResponseHash: string | null;
  chargedAmountUSDC: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt?: Date;
};

export type StoredX402CallReceipt = X402CallReceiptProjection & {
  createdAt: Date;
  updatedAt: Date;
};

export type X402ExecutionApprovalProjection = {
  approvalHash: string;
  intentId: string;
  actor: string;
  planHash: string;
  authorizationHash: string;
  approvalIdempotencyKey: string;
  approvedAt: Date;
  expiresAt: Date;
};

export type StoredX402ExecutionApproval = X402ExecutionApprovalProjection & {
  createdAt: Date;
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

type VerificationEvidenceRow = QueryResultRow & {
  listing_id: string;
  agent_id: string;
  passed: boolean;
  evidence_hash: string;
  evidence: unknown;
  created_at: Date;
  attempts: string;
  passed_attempts: string;
};

type X402CallIntentRow = QueryResultRow & {
  intent_id: string;
  actor_address: string;
  idempotency_key: string;
  listing_reference: string;
  chain_id: string;
  service_registry_address: string;
  listing_id: string;
  agent_id: string;
  listing_version: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  input: unknown;
  input_hash: string;
  max_amount_usdc: string;
  target_url: string | null;
  state: "prepared";
  created_at: Date;
  updated_at: Date;
};

type X402CallReceiptRow = QueryResultRow & {
  receipt_id: string;
  intent_id: string;
  state: X402ReceiptState;
  approved_amount_usdc: string | null;
  quote_hash: string | null;
  quote_snapshot: unknown | null;
  authorization_payload_hash: string | null;
  authorization_payload: unknown | null;
  authorization_hash: string | null;
  settlement_ref: string | null;
  service_status: number | null;
  payment_response_hash: string | null;
  charged_amount_usdc: string | null;
  failure_code: string | null;
  failure_message: string | null;
  created_at: Date;
  updated_at: Date;
};

type X402ExecutionApprovalRow = QueryResultRow & {
  approval_hash: string;
  intent_id: string;
  actor_address: string;
  plan_hash: string;
  authorization_hash: string;
  approval_idempotency_key: string;
  approved_at: Date;
  expires_at: Date;
  created_at: Date;
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

function mapX402CallIntent(row: X402CallIntentRow): StoredX402CallIntent {
  return {
    intentId: row.intent_id,
    actor: row.actor_address,
    idempotencyKey: row.idempotency_key,
    listingReference: row.listing_reference,
    chainId: BigInt(row.chain_id),
    serviceRegistry: row.service_registry_address,
    listingId: BigInt(row.listing_id),
    agentId: BigInt(row.agent_id),
    version: BigInt(row.listing_version),
    method: row.method,
    input: row.input,
    inputHash: row.input_hash,
    maxAmountUSDC: row.max_amount_usdc,
    targetUrl: row.target_url,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapX402CallReceipt(row: X402CallReceiptRow): StoredX402CallReceipt {
  return {
    receiptId: row.receipt_id,
    intentId: row.intent_id,
    state: row.state,
    approvedAmountUSDC: row.approved_amount_usdc,
    quoteHash: row.quote_hash,
    quoteSnapshot: row.quote_snapshot,
    authorizationPayloadHash: row.authorization_payload_hash,
    authorizationPayload: row.authorization_payload,
    authorizationHash: row.authorization_hash,
    settlementRef: row.settlement_ref,
    serviceStatus: row.service_status,
    paymentResponseHash: row.payment_response_hash,
    chargedAmountUSDC: row.charged_amount_usdc,
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapX402ExecutionApproval(row: X402ExecutionApprovalRow): StoredX402ExecutionApproval {
  return {
    approvalHash: row.approval_hash,
    intentId: row.intent_id,
    actor: row.actor_address,
    planHash: row.plan_hash,
    authorizationHash: row.authorization_hash,
    approvalIdempotencyKey: row.approval_idempotency_key,
    approvedAt: row.approved_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
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

const X402_INTENT_COLUMNS = `
  intent_id, actor_address, idempotency_key, listing_reference, chain_id,
  service_registry_address, listing_id, agent_id, listing_version, method,
  input, input_hash, max_amount_usdc, target_url, state, created_at, updated_at`;

const X402_RECEIPT_COLUMNS = `
  receipt_id, intent_id, state, approved_amount_usdc, quote_hash, quote_snapshot, authorization_payload_hash, authorization_payload, authorization_hash, settlement_ref,
  service_status, payment_response_hash, charged_amount_usdc, failure_code,
  failure_message, created_at, updated_at`;

const X402_EXECUTION_APPROVAL_COLUMNS = `
  approval_hash, intent_id, actor_address, plan_hash, authorization_hash,
  approval_idempotency_key, approved_at, expires_at, created_at`;

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

  async getX402CallIntent(intentId: string): Promise<StoredX402CallIntent | null> {
    const result = await this.pool.query<X402CallIntentRow>(
      `select ${X402_INTENT_COLUMNS} from agon_x402_call_intents where intent_id = $1`,
      [intentId],
    );
    return result.rows[0] ? mapX402CallIntent(result.rows[0]) : null;
  }

  async getX402CallReceipt(intentId: string): Promise<StoredX402CallReceipt | null> {
    const result = await this.pool.query<X402CallReceiptRow>(
      `select ${X402_RECEIPT_COLUMNS} from agon_x402_call_receipts where intent_id = $1`,
      [intentId],
    );
    return result.rows[0] ? mapX402CallReceipt(result.rows[0]) : null;
  }

  async prepareX402CallIntent(input: X402CallIntentProjection): Promise<StoredX402CallIntent> {
    const actor = normalizeAddress(input.actor);
    const inserted = await this.pool.query<X402CallIntentRow>(
      `insert into agon_x402_call_intents (
         intent_id, actor_address, idempotency_key, listing_reference, chain_id,
         service_registry_address, listing_id, agent_id, listing_version, method,
         input, input_hash, max_amount_usdc, target_url, state, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $16, $16)
       on conflict (actor_address, idempotency_key) do nothing
       returning ${X402_INTENT_COLUMNS}`,
      [
        input.intentId,
        actor,
        requireText(input.idempotencyKey, "idempotency key"),
        requireText(input.listingReference, "listing reference"),
        requirePositive(input.chainId, "chain id"),
        normalizeAddress(input.serviceRegistry),
        requirePositive(input.listingId, "listing id"),
        requireNonNegative(input.agentId, "agent id"),
        requirePositive(input.version, "listing version"),
        input.method,
        JSON.stringify(jsonSafe(input.input)),
        normalizeHash(input.inputHash),
        input.maxAmountUSDC,
        input.targetUrl ?? null,
        input.state,
        input.createdAt ?? new Date(),
      ],
    );
    if (inserted.rows[0]) return mapX402CallIntent(inserted.rows[0]);

    const existing = await this.pool.query<X402CallIntentRow>(
      `select ${X402_INTENT_COLUMNS}
       from agon_x402_call_intents
       where actor_address = $1 and idempotency_key = $2`,
      [actor, input.idempotencyKey],
    );
    const row = existing.rows[0];
    if (!row) throw new AgonStoreInvariantError("x402 call intent conflict could not be loaded");
    const value = mapX402CallIntent(row);
    if (
      value.listingReference !== input.listingReference ||
      value.method !== input.method ||
      value.inputHash !== input.inputHash ||
      value.maxAmountUSDC !== input.maxAmountUSDC
      || value.targetUrl !== (input.targetUrl ?? null)
    ) {
      throw new AgonStoreInvariantError("idempotency key already used for a different x402 call");
    }
    return value;
  }

  async createX402CallReceipt(input: X402CallReceiptProjection): Promise<StoredX402CallReceipt> {
    if (!/^[0-9a-f-]{36}$/i.test(input.receiptId) || !/^[0-9a-f-]{36}$/i.test(input.intentId)) {
      throw new AgonStoreInvariantError("receipt and intent ids must be UUIDs");
    }
    if (input.state !== "prepared") throw new AgonStoreInvariantError("new x402 receipts must start prepared");
    const inserted = await this.pool.query<X402CallReceiptRow>(
      `insert into agon_x402_call_receipts (
         receipt_id, intent_id, state, approved_amount_usdc, quote_hash, quote_snapshot, authorization_payload_hash, authorization_payload, authorization_hash, settlement_ref,
         service_status, payment_response_hash, charged_amount_usdc, failure_code,
         failure_message, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16)
       on conflict (intent_id) do nothing
       returning ${X402_RECEIPT_COLUMNS}`,
      [input.receiptId, input.intentId, input.state, input.approvedAmountUSDC, input.quoteHash, input.quoteSnapshot, input.authorizationPayloadHash, input.authorizationPayload, input.authorizationHash, input.settlementRef, input.serviceStatus, input.paymentResponseHash, input.chargedAmountUSDC, input.failureCode, input.failureMessage, input.createdAt ?? new Date()],
    );
    if (inserted.rows[0]) return mapX402CallReceipt(inserted.rows[0]);
    const existing = await this.pool.query<X402CallReceiptRow>(
      `select ${X402_RECEIPT_COLUMNS} from agon_x402_call_receipts where intent_id = $1`, [input.intentId],
    );
    const row = existing.rows[0];
    if (!row) throw new AgonStoreInvariantError("x402 receipt conflict could not be loaded");
    // The intent is the idempotency boundary. A retry may generate a fresh
    // candidate receipt UUID, but it must receive the original durable receipt.
    return mapX402CallReceipt(row);
  }

  async advanceX402CallReceipt(intentId: string, event: X402ReceiptEvent): Promise<StoredX402CallReceipt> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const current = await client.query<X402CallReceiptRow>(
        `select ${X402_RECEIPT_COLUMNS} from agon_x402_call_receipts where intent_id = $1 for update`, [intentId],
      );
      const row = current.rows[0];
      if (!row) throw new AgonStoreInvariantError("x402 receipt not found");
      const transition = transitionX402Receipt(row.state, event);
      const updated = await client.query<X402CallReceiptRow>(
        `update agon_x402_call_receipts set
           state = $2, approved_amount_usdc = coalesce($3, approved_amount_usdc),
           quote_hash = coalesce($4, quote_hash),
           quote_snapshot = coalesce($5, quote_snapshot),
           authorization_payload_hash = coalesce($6, authorization_payload_hash),
           authorization_payload = coalesce($7, authorization_payload),
           authorization_hash = coalesce($8, authorization_hash),
           settlement_ref = coalesce($9, settlement_ref),
           service_status = coalesce($10, service_status),
           payment_response_hash = coalesce($11, payment_response_hash),
           failure_code = coalesce($12, failure_code),
           failure_message = coalesce($13, failure_message), updated_at = now()
         where intent_id = $1 returning ${X402_RECEIPT_COLUMNS}`,
        [intentId, transition.to, transition.patch.approvedAmountUSDC ?? null, transition.patch.quoteHash ?? null, transition.patch.quoteSnapshot ?? null, transition.patch.authorizationPayloadHash ?? null, transition.patch.authorizationPayload ?? null, transition.patch.authorizationHash ?? null, transition.patch.settlementRef ?? null, transition.patch.serviceStatus ?? null, transition.patch.paymentResponseHash ?? null, transition.patch.failureCode ?? null, transition.patch.failureMessage ?? null],
      );
      await client.query("commit");
      return mapX402CallReceipt(updated.rows[0]!);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async approveX402CallReceipt(intentId: string, approvedAmountUSDC: string): Promise<StoredX402CallReceipt> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const existing = await client.query<X402CallReceiptRow>(
        `select ${X402_RECEIPT_COLUMNS} from agon_x402_call_receipts where intent_id = $1 for update`, [intentId],
      );
      let row = existing.rows[0];
      if (!row) {
        const inserted = await client.query<X402CallReceiptRow>(
          `insert into agon_x402_call_receipts (receipt_id, intent_id, state, created_at, updated_at)
           values ($1, $2, 'prepared', now(), now()) returning ${X402_RECEIPT_COLUMNS}`,
          [randomUUID(), intentId],
        );
        row = inserted.rows[0];
      }
      if (!row) throw new AgonStoreInvariantError("x402 receipt could not be created");
      const approval = transitionX402Receipt("prepared", { type: "approve", approvedAmountUSDC });
      if (row.state === "approved") {
        if (row.approved_amount_usdc !== approval.patch.approvedAmountUSDC) {
          throw new AgonStoreInvariantError("x402 approval already recorded with a different spend limit");
        }
        await client.query("commit");
        return mapX402CallReceipt(row);
      }
      const transition = transitionX402Receipt(row.state, { type: "approve", approvedAmountUSDC });
      const updated = await client.query<X402CallReceiptRow>(
        `update agon_x402_call_receipts
         set state = 'approved', approved_amount_usdc = $2, updated_at = now()
         where intent_id = $1 returning ${X402_RECEIPT_COLUMNS}`,
        [intentId, transition.patch.approvedAmountUSDC],
      );
      await client.query("commit");
      return mapX402CallReceipt(updated.rows[0]!);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async recordX402ExecutionApproval(input: X402ExecutionApprovalProjection): Promise<StoredX402ExecutionApproval> {
    const actor = normalizeAddress(input.actor);
    const planHash = normalizeHash(input.planHash);
    const authorizationHash = normalizeHash(input.authorizationHash);
    if (!/^[0-9a-f-]{36}$/i.test(input.intentId)) throw new AgonStoreInvariantError("intent id must be a UUID");
    const approvalHash = normalizeHash(input.approvalHash);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(input.approvalIdempotencyKey)) throw new AgonStoreInvariantError("approval idempotency key is invalid");
    if (!(input.expiresAt > input.approvedAt)) throw new AgonStoreInvariantError("execution approval expiry must be after approval time");
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const receipt = await client.query<{ state: X402ReceiptState }>(
        "select state from agon_x402_call_receipts where intent_id = $1 for update",
        [input.intentId],
      );
      if (receipt.rows[0]?.state !== "authorization_submitted") {
        throw new AgonStoreInvariantError("execution approval requires a submitted authorization");
      }
      const inserted = await client.query<X402ExecutionApprovalRow>(
        `insert into agon_x402_execution_approvals (
           approval_hash, intent_id, actor_address, plan_hash, authorization_hash,
           approval_idempotency_key, approved_at, expires_at, created_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, now())
         on conflict (intent_id, approval_idempotency_key) do nothing
         returning ${X402_EXECUTION_APPROVAL_COLUMNS}`,
        [approvalHash, input.intentId, actor, planHash, authorizationHash, input.approvalIdempotencyKey, input.approvedAt, input.expiresAt],
      );
      if (inserted.rows[0]) {
        await client.query("commit");
        return mapX402ExecutionApproval(inserted.rows[0]);
      }
      const existing = await client.query<X402ExecutionApprovalRow>(
        `select ${X402_EXECUTION_APPROVAL_COLUMNS}
         from agon_x402_execution_approvals
         where intent_id = $1 and approval_idempotency_key = $2`,
        [input.intentId, input.approvalIdempotencyKey],
      );
      const row = existing.rows[0];
      if (!row) throw new AgonStoreInvariantError("execution approval conflict could not be loaded");
      if (row.approval_hash !== approvalHash || row.plan_hash !== planHash || row.authorization_hash !== authorizationHash || row.actor_address !== actor) {
        throw new AgonStoreInvariantError("approval idempotency key already used for a different execution plan");
      }
      await client.query("commit");
      return mapX402ExecutionApproval(row);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getLatestX402ExecutionApproval(intentId: string): Promise<StoredX402ExecutionApproval | null> {
    const result = await this.pool.query<X402ExecutionApprovalRow>(
      `select ${X402_EXECUTION_APPROVAL_COLUMNS}
       from agon_x402_execution_approvals
       where intent_id = $1
       order by approved_at desc, created_at desc
       limit 1`,
      [intentId],
    );
    return result.rows[0] ? mapX402ExecutionApproval(result.rows[0]) : null;
  }

  async getLatestVerificationEvidence(
    keys: Array<Pick<ListingKey, "listingId"> & Pick<ListingProjection, "agentId">>,
  ): Promise<Map<string, StoredVerificationEvidence>> {
    if (keys.length === 0) return new Map();
    const params: string[] = [];
    const values = keys.map((key, index) => {
      params.push(requirePositive(key.listingId, "listing id"), requireNonNegative(key.agentId, "agent id"));
      const offset = index * 2;
      return `($${offset + 1}::numeric, $${offset + 2}::numeric)`;
    });
    const result = await this.pool.query<VerificationEvidenceRow>(
      `select distinct on (e.listing_id, e.agent_id)
         e.listing_id::text, e.agent_id::text, e.passed, e.evidence_hash, e.evidence, e.created_at,
         count(*) over (partition by e.listing_id, e.agent_id)::text as attempts,
         (count(*) filter (where e.passed) over (partition by e.listing_id, e.agent_id))::text as passed_attempts
       from agon_verification_evidence e
       join (values ${values.join(", ")}) as requested(listing_id, agent_id)
         on requested.listing_id = e.listing_id and requested.agent_id = e.agent_id
       order by e.listing_id, e.agent_id, e.created_at desc, e.id desc`,
      params,
    );
    return new Map(result.rows.map((row) => [
      `${row.listing_id}:${row.agent_id}`,
      {
        listingId: BigInt(row.listing_id),
        agentId: BigInt(row.agent_id),
        passed: row.passed,
        evidenceHash: row.evidence_hash,
        evidence: row.evidence,
        createdAt: row.created_at,
        attempts: Number(row.attempts),
        passedAttempts: Number(row.passed_attempts),
      },
    ]));
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
