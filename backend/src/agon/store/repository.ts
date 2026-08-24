import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { transitionX402Receipt, type X402ReceiptEvent, type X402ReceiptState } from "../execution/x402-receipt.ts";
import { validateX402DeliveryEvidence, type X402DeliveryEvidence, type X402DeliveryEvidenceInput } from "../execution/x402-delivery.ts";
import { hashAgonEscrowTerms, isAgonEscrowTransitionAllowed, type AgonEscrowIntentState, type AgonEscrowTerms } from "../escrow-policy.ts";
import type { AgonPrizeEscrowPoolBinding } from "../execution/escrow-reconciliation.ts";
import type { AgonEscrowWriteOperation } from "../execution/escrow-write-preflight.ts";
import {
  isAgonJobEscrowTransitionAllowed,
  settlementForAgonJobStatus,
  stateForAgonJobStatus,
  validateAgonJobEscrowJobMatch,
  type AgonJobEscrowIntent,
  type AgonJobEscrowIntentState,
  type AgonJobEscrowSettlement,
} from "../execution/job-escrow-state.ts";
import type { AgonJobEscrowJob } from "../execution/agon-job-escrow.ts";

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
  providerTransferId?: string | null;
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

export type X402FacilitatorVerificationProjection = {
  verificationId?: string;
  receiptId: string;
  intentId: string;
  approvalHash: string;
  network: "eip155:5042002";
  payer: string | null;
  evidenceHash: string;
  verifiedAt: Date;
};

export type StoredX402FacilitatorVerification = X402FacilitatorVerificationProjection & {
  verificationId: string;
  createdAt: Date;
};

export type X402DeliveryEvidenceProjection = X402DeliveryEvidenceInput;
export type StoredX402DeliveryEvidence = X402DeliveryEvidence;

export type AgonEscrowIntentProjection = {
  intentId: string;
  actor: string;
  idempotencyKey: string;
  listingReference: string;
  termsHash: string;
  terms: AgonEscrowTerms;
  state: AgonEscrowIntentState;
  providerReference: string | null;
  transaction: `0x${string}` | null;
  poolBinding?: AgonPrizeEscrowPoolBinding | null;
  createdAt?: Date;
};

export type StoredAgonEscrowIntent = AgonEscrowIntentProjection & {
  createdAt: Date;
  updatedAt: Date;
};

export type AgonJobEscrowIntentProjection = Omit<AgonJobEscrowIntent, "createdAt" | "updatedAt"> & {
  createdAt?: Date;
};

export type StoredAgonJobEscrowIntent = AgonJobEscrowIntent;

export type AgonEscrowTransactionApprovalProjection = {
  approvalHash: string;
  intentId: string;
  actor: string;
  operation: AgonEscrowWriteOperation;
  intentHash: string;
  approvalIdempotencyKey: string;
  approvedAt: Date;
  expiresAt: Date;
};

export type StoredAgonEscrowTransactionApproval = AgonEscrowTransactionApprovalProjection & {
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
  provider_transfer_id: string | null;
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

type X402FacilitatorVerificationRow = QueryResultRow & {
  verification_id: string;
  receipt_id: string;
  intent_id: string;
  approval_hash: string;
  network: "eip155:5042002";
  payer_address: string | null;
  evidence_hash: string;
  verified_at: Date;
  created_at: Date;
};

type X402DeliveryEvidenceRow = QueryResultRow & {
  delivery_id: string;
  intent_id: string;
  receipt_id: string;
  provider_address: string;
  listing_reference: string;
  service_status: number;
  latency_ms: number;
  response_hash: string;
  result_attestation_hash: string | null;
  charged_amount_usdc: string | null;
  evidence_hash: string;
  delivered_at: Date;
  created_at: Date;
};

type AgonEscrowIntentRow = QueryResultRow & {
  intent_id: string;
  actor_address: string;
  idempotency_key: string;
  listing_reference: string;
  terms_hash: string;
  network: "eip155:5042002";
  asset: "0x3600000000000000000000000000000000000000";
  buyer_address: string;
  beneficiary_address: string;
  service_registry_address: string;
  listing_id: string;
  agent_id: string;
  listing_version: string;
  manifest_hash: string;
  amount_base_units: string;
  fee_bps: number;
  expires_at: Date;
  state: AgonEscrowIntentState;
  provider_reference: string | null;
  transaction_hash: `0x${string}` | null;
  pool_contract_address: string | null;
  pool_controller_address: string | null;
  pool_id: string | null;
  created_at: Date;
  updated_at: Date;
};

type AgonJobEscrowIntentRow = QueryResultRow & {
  intent_id: string;
  actor_address: string;
  idempotency_key: string;
  listing_reference: string;
  network: "eip155:5042002";
  asset: "0x3600000000000000000000000000000000000000";
  escrow_contract_address: string;
  buyer_address: string;
  provider_address: string;
  service_registry_address: string;
  listing_id: string;
  agent_id: string;
  listing_version: string;
  manifest_hash: string;
  terms_hash: string;
  amount_base_units: string;
  fee_bps: number;
  review_hours: number;
  expires_at: Date;
  client_reference: string;
  state: AgonJobEscrowIntentState;
  settlement: AgonJobEscrowSettlement;
  onchain_job_id: string | null;
  transaction_hash: `0x${string}` | null;
  deliverable_hash: `0x${string}` | null;
  reason_hash: `0x${string}` | null;
  last_reconciled_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type AgonEscrowTransactionApprovalRow = QueryResultRow & {
  approval_hash: string;
  intent_id: string;
  actor_address: string;
  operation: AgonEscrowWriteOperation;
  intent_hash: string;
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
    providerTransferId: row.provider_transfer_id,
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

function mapX402FacilitatorVerification(row: X402FacilitatorVerificationRow): StoredX402FacilitatorVerification {
  return {
    verificationId: row.verification_id,
    receiptId: row.receipt_id,
    intentId: row.intent_id,
    approvalHash: row.approval_hash,
    network: row.network,
    payer: row.payer_address,
    evidenceHash: row.evidence_hash,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
  };
}

function mapX402DeliveryEvidence(row: X402DeliveryEvidenceRow): StoredX402DeliveryEvidence {
  return {
    deliveryId: row.delivery_id,
    intentId: row.intent_id,
    receiptId: row.receipt_id,
    provider: row.provider_address as `0x${string}`,
    listingReference: row.listing_reference,
    serviceStatus: row.service_status,
    latencyMs: row.latency_ms,
    responseHash: row.response_hash as `0x${string}`,
    resultAttestationHash: row.result_attestation_hash as `0x${string}` | null,
    chargedAmountUSDC: row.charged_amount_usdc,
    evidenceHash: row.evidence_hash as `0x${string}`,
    deliveredAt: row.delivered_at,
    createdAt: row.created_at,
  };
}

function mapAgonEscrowIntent(row: AgonEscrowIntentRow): StoredAgonEscrowIntent {
  return {
    intentId: row.intent_id,
    actor: row.actor_address,
    idempotencyKey: row.idempotency_key,
    listingReference: row.listing_reference,
    termsHash: row.terms_hash,
    terms: {
      network: row.network,
      asset: row.asset,
      buyer: row.buyer_address as `0x${string}`,
      beneficiary: row.beneficiary_address as `0x${string}`,
      listing: {
        serviceRegistry: row.service_registry_address as `0x${string}`,
        listingId: row.listing_id,
        agentId: row.agent_id,
        version: row.listing_version,
        manifestHash: row.manifest_hash as `0x${string}`,
      },
      amountBaseUnits: BigInt(row.amount_base_units),
      feeBps: row.fee_bps,
      expiresAt: row.expires_at,
    },
    state: row.state,
    providerReference: row.provider_reference,
    transaction: row.transaction_hash,
    poolBinding: row.pool_contract_address && row.pool_controller_address && row.pool_id !== null
      ? {
          contractAddress: row.pool_contract_address as `0x${string}`,
          controller: row.pool_controller_address as `0x${string}`,
          poolId: row.pool_id,
        }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAgonJobEscrowIntent(row: AgonJobEscrowIntentRow): StoredAgonJobEscrowIntent {
  return {
    intentId: row.intent_id,
    idempotencyKey: row.idempotency_key,
    actor: row.actor_address as `0x${string}`,
    buyer: row.buyer_address as `0x${string}`,
    provider: row.provider_address as `0x${string}`,
    listingReference: row.listing_reference,
    network: row.network,
    asset: row.asset as `0x${string}`,
    escrowContract: row.escrow_contract_address as `0x${string}`,
    serviceRegistry: row.service_registry_address as `0x${string}`,
    listingId: row.listing_id,
    agentId: row.agent_id,
    listingVersion: row.listing_version,
    manifestHash: row.manifest_hash as `0x${string}`,
    termsHash: row.terms_hash as `0x${string}`,
    amountBaseUnits: BigInt(row.amount_base_units),
    feeBps: row.fee_bps,
    reviewHours: row.review_hours,
    expiresAt: row.expires_at,
    clientReference: row.client_reference as `0x${string}`,
    state: row.state,
    settlement: row.settlement,
    onchainJobId: row.onchain_job_id,
    transactionHash: row.transaction_hash,
    deliverableHash: row.deliverable_hash,
    reasonHash: row.reason_hash,
    lastReconciledAt: row.last_reconciled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAgonEscrowTransactionApproval(row: AgonEscrowTransactionApprovalRow): StoredAgonEscrowTransactionApproval {
  return {
    approvalHash: row.approval_hash,
    intentId: row.intent_id,
    actor: row.actor_address,
    operation: row.operation,
    intentHash: row.intent_hash,
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
  receipt_id, intent_id, state, approved_amount_usdc, quote_hash, quote_snapshot, authorization_payload_hash, authorization_payload, authorization_hash, settlement_ref, provider_transfer_id,
  service_status, payment_response_hash, charged_amount_usdc, failure_code,
  failure_message, created_at, updated_at`;

const X402_EXECUTION_APPROVAL_COLUMNS = `
  approval_hash, intent_id, actor_address, plan_hash, authorization_hash,
  approval_idempotency_key, approved_at, expires_at, created_at`;

const X402_FACILITATOR_VERIFICATION_COLUMNS = `
  verification_id, receipt_id, intent_id, approval_hash, network, payer_address,
  evidence_hash, verified_at, created_at`;

const X402_DELIVERY_EVIDENCE_COLUMNS = `
  delivery_id, intent_id, receipt_id, provider_address, listing_reference,
  service_status, latency_ms, response_hash, result_attestation_hash,
  charged_amount_usdc, evidence_hash, delivered_at, created_at`;

const AGON_ESCROW_INTENT_COLUMNS = `
  intent_id, actor_address, idempotency_key, listing_reference, terms_hash, network, asset,
  buyer_address, beneficiary_address, service_registry_address, listing_id,
  agent_id, listing_version, manifest_hash, amount_base_units, fee_bps,
  expires_at, state, provider_reference, transaction_hash, pool_contract_address,
  pool_controller_address, pool_id, created_at, updated_at`;

const AGON_JOB_ESCROW_INTENT_COLUMNS = `
  intent_id, actor_address, idempotency_key, listing_reference, network, asset,
  escrow_contract_address, buyer_address, provider_address, service_registry_address,
  listing_id, agent_id, listing_version, manifest_hash, terms_hash, amount_base_units,
  fee_bps, review_hours, expires_at, client_reference, state, settlement, onchain_job_id,
  transaction_hash, deliverable_hash, reason_hash, last_reconciled_at, created_at, updated_at`;

const AGON_ESCROW_TRANSACTION_APPROVAL_COLUMNS = `
  approval_hash, intent_id, actor_address, operation, intent_hash,
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

  async getAgonEscrowIntent(intentId: string): Promise<StoredAgonEscrowIntent | null> {
    if (!/^[0-9a-f-]{36}$/i.test(intentId)) return null;
    const result = await this.pool.query<AgonEscrowIntentRow>(
      `select ${AGON_ESCROW_INTENT_COLUMNS} from agon_escrow_intents where intent_id = $1`,
      [intentId],
    );
    return result.rows[0] ? mapAgonEscrowIntent(result.rows[0]) : null;
  }

  async getAgonJobEscrowIntent(intentId: string): Promise<StoredAgonJobEscrowIntent | null> {
    if (!/^[0-9a-f-]{36}$/i.test(intentId)) return null;
    const result = await this.pool.query<AgonJobEscrowIntentRow>(
      `select ${AGON_JOB_ESCROW_INTENT_COLUMNS} from agon_job_escrow_intents where intent_id = $1`,
      [intentId],
    );
    return result.rows[0] ? mapAgonJobEscrowIntent(result.rows[0]) : null;
  }

  async prepareAgonJobEscrowIntent(input: AgonJobEscrowIntentProjection): Promise<StoredAgonJobEscrowIntent> {
    const actor = normalizeAddress(input.actor);
    if (!/^[0-9a-f-]{36}$/i.test(input.intentId)) throw new AgonStoreInvariantError("job escrow intent id must be a UUID");
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(input.idempotencyKey)) throw new AgonStoreInvariantError("job escrow idempotency key is invalid");
    if (input.state !== "prepared" || input.settlement !== "none" || input.onchainJobId !== null) {
      throw new AgonStoreInvariantError("job escrow intent must start prepared with no settlement");
    }
    const inserted = await this.pool.query<AgonJobEscrowIntentRow>(
      `insert into agon_job_escrow_intents (
         intent_id, actor_address, idempotency_key, listing_reference, network, asset,
         escrow_contract_address, buyer_address, provider_address, service_registry_address,
         listing_id, agent_id, listing_version, manifest_hash, terms_hash, amount_base_units,
         fee_bps, review_hours, expires_at, client_reference, state, settlement, onchain_job_id,
         transaction_hash, deliverable_hash, reason_hash, last_reconciled_at, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $28)
       on conflict (actor_address, idempotency_key) do nothing
       returning ${AGON_JOB_ESCROW_INTENT_COLUMNS}`,
      [
        input.intentId,
        actor,
        input.idempotencyKey,
        input.listingReference,
        input.network,
        input.asset.toLowerCase(),
        normalizeAddress(input.escrowContract),
        normalizeAddress(input.buyer),
        normalizeAddress(input.provider),
        normalizeAddress(input.serviceRegistry),
        requirePositive(BigInt(input.listingId), "listing id"),
        requirePositive(BigInt(input.agentId), "agent id"),
        requirePositive(BigInt(input.listingVersion), "listing version"),
        normalizeHash(input.manifestHash),
        normalizeHash(input.termsHash),
        requirePositive(input.amountBaseUnits, "job escrow amount"),
        input.feeBps,
        input.reviewHours,
        input.expiresAt,
        normalizeHash(input.clientReference),
        input.state,
        input.settlement,
        input.onchainJobId,
        input.transactionHash,
        input.deliverableHash,
        input.reasonHash,
        input.lastReconciledAt,
        input.createdAt ?? new Date(),
      ],
    );
    if (inserted.rows[0]) return mapAgonJobEscrowIntent(inserted.rows[0]);

    const existing = await this.pool.query<AgonJobEscrowIntentRow>(
      `select ${AGON_JOB_ESCROW_INTENT_COLUMNS}
       from agon_job_escrow_intents where actor_address = $1 and idempotency_key = $2`,
      [actor, input.idempotencyKey],
    );
    const row = existing.rows[0];
    if (!row) throw new AgonStoreInvariantError("job escrow idempotency conflict could not be loaded");
    const value = mapAgonJobEscrowIntent(row);
    const same = value.termsHash === input.termsHash.toLowerCase()
      && value.clientReference === input.clientReference.toLowerCase()
      && value.listingReference === input.listingReference
      && value.escrowContract === input.escrowContract.toLowerCase()
      && value.buyer === input.buyer.toLowerCase()
      && value.provider === input.provider.toLowerCase()
      && value.listingId === input.listingId
      && value.agentId === input.agentId
      && value.listingVersion === input.listingVersion
      && value.manifestHash === input.manifestHash.toLowerCase()
      && value.amountBaseUnits === input.amountBaseUnits
      && value.feeBps === input.feeBps
      && value.reviewHours === input.reviewHours
      && value.expiresAt.getTime() === input.expiresAt.getTime();
    if (!same) throw new AgonStoreInvariantError("job escrow idempotency key already used for different terms");
    return value;
  }

  async reconcileAgonJobEscrowIntent(input: {
    intentId: string;
    job: AgonJobEscrowJob;
    transactionHash?: `0x${string}` | null;
  }): Promise<StoredAgonJobEscrowIntent> {
    if (!/^[0-9a-f-]{36}$/i.test(input.intentId)) throw new AgonStoreInvariantError("job escrow intent id must be a UUID");
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const current = await client.query<AgonJobEscrowIntentRow>(
        `select ${AGON_JOB_ESCROW_INTENT_COLUMNS} from agon_job_escrow_intents where intent_id = $1 for update`,
        [input.intentId],
      );
      const row = current.rows[0];
      if (!row) throw new AgonStoreInvariantError("job escrow intent not found");
      const intent = mapAgonJobEscrowIntent(row);
      const match = validateAgonJobEscrowJobMatch(intent, input.job);
      if (!match.ok) throw new AgonStoreInvariantError(match.message);
      if (intent.onchainJobId !== null && intent.onchainJobId !== input.job.jobId) {
        throw new AgonStoreInvariantError("job escrow intent is already bound to a different on-chain job");
      }
      const nextState = stateForAgonJobStatus(input.job.status);
      if (!isAgonJobEscrowTransitionAllowed(intent.state, nextState)) {
        throw new AgonStoreInvariantError(`cannot reconcile job escrow intent from ${intent.state} to ${nextState}`);
      }
      const settlement = settlementForAgonJobStatus(input.job.settlement);
      const deliverableHash = /^0x0{64}$/i.test(input.job.deliverableHash) ? null : input.job.deliverableHash;
      const updated = await client.query<AgonJobEscrowIntentRow>(
        `update agon_job_escrow_intents set
           state = $2,
           settlement = $3,
           onchain_job_id = $4,
           transaction_hash = coalesce($5, transaction_hash),
           deliverable_hash = coalesce($6, deliverable_hash),
           last_reconciled_at = now(),
           updated_at = now()
         where intent_id = $1
         returning ${AGON_JOB_ESCROW_INTENT_COLUMNS}`,
        [input.intentId, nextState, settlement, input.job.jobId, input.transactionHash ?? null, deliverableHash],
      );
      await client.query("commit");
      return mapAgonJobEscrowIntent(updated.rows[0]!);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async markAgonJobEscrowSubmitted(input: {
    intentId: string;
    transactionHash: `0x${string}`;
  }): Promise<StoredAgonJobEscrowIntent> {
    if (!/^[0-9a-f-]{36}$/i.test(input.intentId)) throw new AgonStoreInvariantError("job escrow intent id must be a UUID");
    const transactionHash = normalizeHash(input.transactionHash);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const current = await client.query<AgonJobEscrowIntentRow>(
        `select ${AGON_JOB_ESCROW_INTENT_COLUMNS} from agon_job_escrow_intents where intent_id = $1 for update`,
        [input.intentId],
      );
      const row = current.rows[0];
      if (!row) throw new AgonStoreInvariantError("job escrow intent not found");
      if (row.state === "submitted" && row.transaction_hash === transactionHash) {
        await client.query("commit");
        return mapAgonJobEscrowIntent(row);
      }
      if (row.state !== "prepared") throw new AgonStoreInvariantError(`cannot mark job escrow intent ${row.state} as submitted`);
      const updated = await client.query<AgonJobEscrowIntentRow>(
        `update agon_job_escrow_intents set state = 'submitted', transaction_hash = $2, updated_at = now()
         where intent_id = $1 returning ${AGON_JOB_ESCROW_INTENT_COLUMNS}`,
        [input.intentId, transactionHash],
      );
      await client.query("commit");
      return mapAgonJobEscrowIntent(updated.rows[0]!);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getAgonEscrowTransactionApproval(intentId: string, approvalIdempotencyKey?: string): Promise<StoredAgonEscrowTransactionApproval | null> {
    if (!/^[0-9a-f-]{36}$/i.test(intentId)) return null;
    const result = approvalIdempotencyKey
      ? await this.pool.query<AgonEscrowTransactionApprovalRow>(
        `select ${AGON_ESCROW_TRANSACTION_APPROVAL_COLUMNS}
         from agon_escrow_transaction_approvals
         where intent_id = $1 and approval_idempotency_key = $2`,
        [intentId, approvalIdempotencyKey],
      )
      : await this.pool.query<AgonEscrowTransactionApprovalRow>(
        `select ${AGON_ESCROW_TRANSACTION_APPROVAL_COLUMNS}
         from agon_escrow_transaction_approvals
         where intent_id = $1 order by approved_at desc limit 1`,
        [intentId],
      );
    return result.rows[0] ? mapAgonEscrowTransactionApproval(result.rows[0]) : null;
  }

  async prepareAgonEscrowTransactionApproval(input: AgonEscrowTransactionApprovalProjection): Promise<StoredAgonEscrowTransactionApproval> {
    const actor = normalizeAddress(input.actor);
    if (!/^[0-9a-f-]{36}$/i.test(input.intentId)) throw new AgonStoreInvariantError("escrow intent id must be a UUID");
    if (!/^(fund|release|refund)$/.test(input.operation)) throw new AgonStoreInvariantError("escrow approval operation is invalid");
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(input.approvalIdempotencyKey)) throw new AgonStoreInvariantError("escrow approval idempotency key is invalid");
    const approvalHash = normalizeHash(input.approvalHash);
    const intentHash = normalizeHash(input.intentHash);
    if (!(input.expiresAt > input.approvedAt)) throw new AgonStoreInvariantError("escrow approval expiry must be after approval time");
    const inserted = await this.pool.query<AgonEscrowTransactionApprovalRow>(
      `insert into agon_escrow_transaction_approvals (
         approval_hash, intent_id, actor_address, operation, intent_hash,
         approval_idempotency_key, approved_at, expires_at, created_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $7)
       on conflict (intent_id, approval_idempotency_key) do nothing
       returning ${AGON_ESCROW_TRANSACTION_APPROVAL_COLUMNS}`,
      [approvalHash, input.intentId, actor, input.operation, intentHash, input.approvalIdempotencyKey, input.approvedAt, input.expiresAt],
    );
    if (inserted.rows[0]) return mapAgonEscrowTransactionApproval(inserted.rows[0]);
    const existing = await this.pool.query<AgonEscrowTransactionApprovalRow>(
      `select ${AGON_ESCROW_TRANSACTION_APPROVAL_COLUMNS}
       from agon_escrow_transaction_approvals
       where intent_id = $1 and approval_idempotency_key = $2`,
      [input.intentId, input.approvalIdempotencyKey],
    );
    const row = existing.rows[0];
    if (!row) throw new AgonStoreInvariantError("escrow approval idempotency conflict could not be loaded");
    const value = mapAgonEscrowTransactionApproval(row);
    if (value.approvalHash !== approvalHash || value.actor !== actor || value.operation !== input.operation || value.intentHash !== intentHash) {
      throw new AgonStoreInvariantError("escrow approval idempotency key already used for different transaction intent");
    }
    return value;
  }

  async prepareAgonEscrowIntent(input: AgonEscrowIntentProjection): Promise<StoredAgonEscrowIntent> {
    const actor = normalizeAddress(input.actor);
    if (!/^[0-9a-f-]{36}$/i.test(input.intentId)) throw new AgonStoreInvariantError("escrow intent id must be a UUID");
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(input.idempotencyKey)) throw new AgonStoreInvariantError("escrow idempotency key is invalid");
    const terms = input.terms;
    if (hashAgonEscrowTerms(terms).toLowerCase() !== input.termsHash.toLowerCase()) throw new AgonStoreInvariantError("escrow terms hash does not match the stored terms");
    const inserted = await this.pool.query<AgonEscrowIntentRow>(
      `insert into agon_escrow_intents (
         intent_id, actor_address, idempotency_key, listing_reference, terms_hash, network, asset,
         buyer_address, beneficiary_address, service_registry_address, listing_id,
         agent_id, listing_version, manifest_hash, amount_base_units, fee_bps,
         expires_at, state, provider_reference, transaction_hash, pool_contract_address,
         pool_controller_address, pool_id, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $24)
       on conflict (actor_address, idempotency_key) do nothing
       returning ${AGON_ESCROW_INTENT_COLUMNS}`,
      [
        input.intentId,
        actor,
        input.idempotencyKey,
        input.listingReference,
        normalizeHash(input.termsHash),
        terms.network,
        terms.asset.toLowerCase(),
        normalizeAddress(terms.buyer),
        normalizeAddress(terms.beneficiary),
        normalizeAddress(terms.listing.serviceRegistry),
        requirePositive(BigInt(terms.listing.listingId), "listing id"),
        requirePositive(BigInt(terms.listing.agentId), "agent id"),
        requirePositive(BigInt(terms.listing.version), "listing version"),
        normalizeHash(terms.listing.manifestHash),
        requirePositive(terms.amountBaseUnits, "escrow amount"),
        terms.feeBps,
        terms.expiresAt,
        input.state,
        input.providerReference,
        input.transaction,
        input.poolBinding?.contractAddress ?? null,
        input.poolBinding?.controller ?? null,
        input.poolBinding?.poolId ?? null,
        input.createdAt ?? new Date(),
      ],
    );
    if (inserted.rows[0]) return mapAgonEscrowIntent(inserted.rows[0]);

    const existing = await this.pool.query<AgonEscrowIntentRow>(
      `select ${AGON_ESCROW_INTENT_COLUMNS}
       from agon_escrow_intents where actor_address = $1 and idempotency_key = $2`,
      [actor, input.idempotencyKey],
    );
    const row = existing.rows[0];
    if (!row) throw new AgonStoreInvariantError("escrow idempotency conflict could not be loaded");
    const value = mapAgonEscrowIntent(row);
    if (value.termsHash !== input.termsHash.toLowerCase()) {
      throw new AgonStoreInvariantError("escrow idempotency key already used for different terms");
    }
    const existingBinding = value.poolBinding;
    const requestedBinding = input.poolBinding ?? null;
    if (JSON.stringify(existingBinding) !== JSON.stringify(requestedBinding)) {
      throw new AgonStoreInvariantError("escrow idempotency key already used for different pool binding");
    }
    return value;
  }

  async advanceAgonEscrowIntent(input: {
    intentId: string;
    state: Exclude<AgonEscrowIntentState, "prepared">;
    providerReference?: string | null;
    transaction?: `0x${string}` | null;
  }): Promise<StoredAgonEscrowIntent> {
    if (!/^[0-9a-f-]{36}$/i.test(input.intentId)) throw new AgonStoreInvariantError("escrow intent id must be a UUID");
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const current = await client.query<AgonEscrowIntentRow>(
        `select ${AGON_ESCROW_INTENT_COLUMNS} from agon_escrow_intents where intent_id = $1 for update`,
        [input.intentId],
      );
      const row = current.rows[0];
      if (!row) throw new AgonStoreInvariantError("escrow intent not found");
      if (!isAgonEscrowTransitionAllowed(row.state, input.state)) {
        throw new AgonStoreInvariantError(`cannot transition escrow intent from ${row.state} to ${input.state}`);
      }
      const updated = await client.query<AgonEscrowIntentRow>(
        `update agon_escrow_intents set
           state = $2,
           provider_reference = case when $3::text is null then provider_reference else $3 end,
           transaction_hash = case when $4::text is null then transaction_hash else $4 end,
           updated_at = now()
         where intent_id = $1 returning ${AGON_ESCROW_INTENT_COLUMNS}`,
        [input.intentId, input.state, input.providerReference ?? null, input.transaction ?? null],
      );
      await client.query("commit");
      return mapAgonEscrowIntent(updated.rows[0]!);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
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

  async recordX402DeliveryEvidence(input: X402DeliveryEvidenceProjection): Promise<StoredX402DeliveryEvidence> {
    const evidence = validateX402DeliveryEvidence(input);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const receiptResult = await client.query<X402CallReceiptRow>(
        `select ${X402_RECEIPT_COLUMNS} from agon_x402_call_receipts where intent_id = $1 for update`,
        [evidence.intentId],
      );
      const receipt = receiptResult.rows[0];
      if (!receipt) throw new AgonStoreInvariantError("x402 receipt not found");
      if (receipt.receipt_id !== evidence.receiptId) throw new AgonStoreInvariantError("delivery evidence does not match the x402 receipt");

      const existing = await client.query<X402DeliveryEvidenceRow>(
        `select ${X402_DELIVERY_EVIDENCE_COLUMNS}
         from agon_x402_delivery_evidence
         where intent_id = $1 and evidence_hash = $2`,
        [evidence.intentId, evidence.evidenceHash],
      );
      if (existing.rows[0]) {
        await client.query("commit");
        return mapX402DeliveryEvidence(existing.rows[0]);
      }

      const transition = transitionX402Receipt(receipt.state, {
        type: "service_delivered",
        serviceStatus: evidence.serviceStatus,
        paymentResponseHash: evidence.responseHash,
        chargedAmountUSDC: evidence.chargedAmountUSDC,
      });
      const inserted = await client.query<X402DeliveryEvidenceRow>(
        `insert into agon_x402_delivery_evidence (
           delivery_id, intent_id, receipt_id, provider_address, listing_reference,
           service_status, latency_ms, response_hash, result_attestation_hash,
           charged_amount_usdc, evidence_hash, delivered_at, created_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         returning ${X402_DELIVERY_EVIDENCE_COLUMNS}`,
        [
          evidence.deliveryId,
          evidence.intentId,
          evidence.receiptId,
          evidence.provider.toLowerCase(),
          evidence.listingReference,
          evidence.serviceStatus,
          evidence.latencyMs,
          evidence.responseHash,
          evidence.resultAttestationHash,
          evidence.chargedAmountUSDC,
          evidence.evidenceHash,
          evidence.deliveredAt,
          evidence.createdAt,
        ],
      );
      await client.query(
        `update agon_x402_call_receipts set
           state = $2, service_status = $3, payment_response_hash = $4,
           charged_amount_usdc = coalesce($5, charged_amount_usdc), updated_at = now()
         where intent_id = $1`,
        [evidence.intentId, transition.to, evidence.serviceStatus, evidence.responseHash, transition.patch.chargedAmountUSDC ?? null],
      );
      await client.query("commit");
      return mapX402DeliveryEvidence(inserted.rows[0]!);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getLatestX402DeliveryEvidence(intentId: string): Promise<StoredX402DeliveryEvidence | null> {
    const result = await this.pool.query<X402DeliveryEvidenceRow>(
      `select ${X402_DELIVERY_EVIDENCE_COLUMNS}
       from agon_x402_delivery_evidence
       where intent_id = $1
       order by delivered_at desc, created_at desc
       limit 1`,
      [intentId],
    );
    return result.rows[0] ? mapX402DeliveryEvidence(result.rows[0]) : null;
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
         receipt_id, intent_id, state, approved_amount_usdc, quote_hash, quote_snapshot, authorization_payload_hash, authorization_payload, authorization_hash, settlement_ref, provider_transfer_id,
         service_status, payment_response_hash, charged_amount_usdc, failure_code,
         failure_message, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17)
       on conflict (intent_id) do nothing
       returning ${X402_RECEIPT_COLUMNS}`,
      [input.receiptId, input.intentId, input.state, input.approvedAmountUSDC, input.quoteHash, input.quoteSnapshot, input.authorizationPayloadHash, input.authorizationPayload, input.authorizationHash, input.settlementRef, input.providerTransferId, input.serviceStatus, input.paymentResponseHash, input.chargedAmountUSDC, input.failureCode, input.failureMessage, input.createdAt ?? new Date()],
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
           provider_transfer_id = coalesce($10, provider_transfer_id),
           service_status = coalesce($11, service_status),
           payment_response_hash = coalesce($12, payment_response_hash),
           failure_code = coalesce($13, failure_code),
           failure_message = coalesce($14, failure_message), updated_at = now()
         where intent_id = $1 returning ${X402_RECEIPT_COLUMNS}`,
        [intentId, transition.to, transition.patch.approvedAmountUSDC ?? null, transition.patch.quoteHash ?? null, transition.patch.quoteSnapshot ?? null, transition.patch.authorizationPayloadHash ?? null, transition.patch.authorizationPayload ?? null, transition.patch.authorizationHash ?? null, transition.patch.settlementRef ?? null, transition.patch.providerTransferId ?? null, transition.patch.serviceStatus ?? null, transition.patch.paymentResponseHash ?? null, transition.patch.failureCode ?? null, transition.patch.failureMessage ?? null],
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

  async recordX402FacilitatorVerification(input: X402FacilitatorVerificationProjection): Promise<StoredX402FacilitatorVerification> {
    if (!/^[0-9a-f-]{36}$/i.test(input.intentId) || !/^[0-9a-f-]{36}$/i.test(input.receiptId)) {
      throw new AgonStoreInvariantError("facilitator verification ids must be UUIDs");
    }
    if (input.verificationId && !/^[0-9a-f-]{36}$/i.test(input.verificationId)) {
      throw new AgonStoreInvariantError("facilitator verification id must be a UUID");
    }
    const approvalHash = normalizeHash(input.approvalHash);
    const evidenceHash = normalizeHash(input.evidenceHash);
    const payer = input.payer === null ? null : normalizeAddress(input.payer);
    if (input.network !== "eip155:5042002") throw new AgonStoreInvariantError("facilitator verification network is not Arc Testnet");
    if (!(input.verifiedAt instanceof Date) || !Number.isFinite(input.verifiedAt.getTime())) {
      throw new AgonStoreInvariantError("facilitator verification timestamp is invalid");
    }
    const inserted = await this.pool.query<X402FacilitatorVerificationRow>(
      `insert into agon_x402_facilitator_verifications (
         verification_id, receipt_id, intent_id, approval_hash, network, payer_address,
         evidence_hash, verified_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (intent_id, approval_hash) do nothing
       returning ${X402_FACILITATOR_VERIFICATION_COLUMNS}`,
      [input.verificationId ?? randomUUID(), input.receiptId, input.intentId, approvalHash, input.network, payer, evidenceHash, input.verifiedAt],
    );
    if (inserted.rows[0]) return mapX402FacilitatorVerification(inserted.rows[0]);
    const existing = await this.pool.query<X402FacilitatorVerificationRow>(
      `select ${X402_FACILITATOR_VERIFICATION_COLUMNS}
       from agon_x402_facilitator_verifications
       where intent_id = $1 and approval_hash = $2`,
      [input.intentId, approvalHash],
    );
    const row = existing.rows[0];
    if (!row) throw new AgonStoreInvariantError("facilitator verification conflict could not be loaded");
    if (row.receipt_id !== input.receiptId || row.network !== input.network || row.payer_address !== payer || row.evidence_hash !== evidenceHash) {
      throw new AgonStoreInvariantError("facilitator verification conflict does not match the original evidence");
    }
    return mapX402FacilitatorVerification(row);
  }

  async getLatestX402FacilitatorVerification(intentId: string): Promise<StoredX402FacilitatorVerification | null> {
    if (!/^[0-9a-f-]{36}$/i.test(intentId)) throw new AgonStoreInvariantError("intent id must be a UUID");
    const result = await this.pool.query<X402FacilitatorVerificationRow>(
      `select ${X402_FACILITATOR_VERIFICATION_COLUMNS}
       from agon_x402_facilitator_verifications
       where intent_id = $1
       order by verified_at desc, created_at desc
       limit 1`,
      [intentId],
    );
    return result.rows[0] ? mapX402FacilitatorVerification(result.rows[0]) : null;
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
