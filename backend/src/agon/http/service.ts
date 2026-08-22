import { z } from "zod";
import { randomUUID } from "node:crypto";
import { keccak256, stringToHex } from "viem";
import type { Result } from "../core/result.ts";
import {
  PostgresAgonRepository,
  AgonStoreInvariantError,
  type ListingCursor,
  type StoredListing,
  type StoredVerificationEvidence,
  type StoredX402FacilitatorVerification,
  type StoredAgonEscrowIntent,
} from "../store/repository.ts";
import { callIntentView, prepareX402Call } from "../execution/x402-intent.ts";
import { validateX402Approval } from "../execution/x402-approval.ts";
import { parsePaymentRequiredHeader, type X402QuoteSnapshot } from "../execution/x402-quote.ts";
import { buildX402Authorization, validateX402AuthorizationSignature, type X402AuthorizationPayload } from "../execution/x402-authorization.ts";
import { buildX402ExecutionPlan } from "../execution/x402-facilitator.ts";
import { createX402SettlementOrchestrator, type X402SettlementAdapter } from "../execution/x402-orchestrator.ts";
import { createX402ExecutionPolicy } from "../execution/x402-policy.ts";
import { isX402ProviderTransferId, isX402Transaction, validateX402ReceiptLookupResult, type X402ReceiptLookupAdapter } from "../execution/x402-reconciliation.ts";
import type { X402FacilitatorVerificationRequest as X402FacilitatorVerificationInput, X402FacilitatorVerificationResult, X402SettlementRequest as X402SettlementInput } from "../execution/x402-settlement.ts";
import { buildX402ExecutionApproval, type X402ExecutionApprovalRequest } from "../execution/x402-execution-approval.ts";
import { validateAgonPrizeEscrowPoolBinding, type AgonPrizeEscrowPoolBinding, type AgonPrizeEscrowReadAdapter } from "../execution/escrow-reconciliation.ts";
import { createAgonEscrowLifecycleOrchestrator, type AgonEscrowLifecycleAction } from "../execution/escrow-orchestrator.ts";
import { createDisabledAgonEscrowAdapter, evaluateAgonEscrowTerms, hashAgonEscrowTerms, type AgonEscrowAdapter, type AgonEscrowListing } from "../escrow-policy.ts";
import type {
  AgonCapabilities,
  AgonEndpointQa,
  AgonListingView,
  X402ApprovalRequest,
  X402ApprovalView,
  BindProfileRequest,
  ListingPage,
  ListingQuery,
  PublishListingRequest,
  SubmittedOperation,
  X402CallIntentRequest,
  X402CallIntentView,
  X402QuoteView,
  X402AuthorizationView,
  X402AuthorizationSignatureRequest,
  X402AuthorizationSubmittedView,
  X402ExecutionPlanView,
  X402ExecutionApprovalView,
  X402ExecutionReadinessView,
  X402SettlementReadinessView,
  X402ReconciliationReadinessView,
  X402ReconciliationRequest,
  X402ReconciliationView,
  X402SettlementRequest,
  X402SettlementView,
  X402FacilitatorVerificationView,
  X402FacilitatorVerificationRequest,
  AgonEscrowIntentRequest,
  AgonEscrowIntentView,
  AgonEscrowReadinessView,
} from "./api-types.ts";
import type { AgonMarketService, AgonServiceError } from "./routes.ts";
import type { AgonReadiness } from "../write/readiness.ts";

const cursorSchema = z.object({
  updatedAt: z.string().datetime(),
  chainId: z.string().regex(/^[1-9]\d*$/),
  serviceRegistry: z.string().regex(/^0x[0-9a-f]{40}$/),
  listingId: z.string().regex(/^[1-9]\d*$/),
});

export type AgonWriteAdapter = {
  getReadiness(force?: boolean): Promise<AgonReadiness>;
  bindProfile(
    actor: string,
    request: BindProfileRequest,
  ): Promise<Result<SubmittedOperation, AgonServiceError>>;
  publishListing(
    actor: string,
    request: PublishListingRequest,
  ): Promise<Result<SubmittedOperation, AgonServiceError>>;
  confirmOperation(
    actor: string,
    operationId: string,
    txHash: `0x${string}`,
  ): Promise<Result<SubmittedOperation, AgonServiceError>>;
};

export type PostgresAgonMarketServiceOptions = {
  writer?: AgonWriteAdapter;
  identityReads?: boolean;
  endpointQa?: boolean;
  directX402?: boolean;
  x402ExecutionEnabled?: boolean;
  x402ExecutionPolicy?: import("../execution/x402-policy.ts").X402ExecutionPolicy;
  x402SettlementAdapter?: X402SettlementAdapter;
  x402FacilitatorVerifier?: {
    verify(input: X402FacilitatorVerificationInput): Promise<X402FacilitatorVerificationResult>;
  };
  /** Server-side provider lookup only. Undefined keeps reconciliation disabled. */
  x402ReceiptLookup?: X402ReceiptLookupAdapter;
  /** Server-side PrizeEscrow view lookup only. Undefined keeps pool reads disabled. */
  escrowReadAdapter?: AgonPrizeEscrowReadAdapter;
  /** Configured PrizeEscrow address used to pin any durable pool binding. */
  escrowPoolContract?: `0x${string}`;
  /** Explicitly enabled lifecycle adapter; undefined keeps escrow disabled. */
  escrowExecutionAdapter?: AgonEscrowAdapter;
  escrowExecutionEnabled?: boolean;
  fetchImpl?: typeof fetch;
};

function parsePositive(value: string, label: string): bigint {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${label} must be a positive decimal string`);
  return BigInt(value);
}

function encodeCursor(listing: StoredListing): string {
  return Buffer.from(
    JSON.stringify({
      updatedAt: listing.updatedAt.toISOString(),
      chainId: listing.chainId.toString(),
      serviceRegistry: listing.serviceRegistry,
      listingId: listing.listingId.toString(),
    }),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(value: string | null): ListingCursor | null {
  if (value === null) return null;
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    if (!parsed.success) throw new Error("invalid cursor payload");
    return {
      updatedAt: new Date(parsed.data.updatedAt),
      chainId: BigInt(parsed.data.chainId),
      serviceRegistry: parsed.data.serviceRegistry,
      listingId: BigInt(parsed.data.listingId),
    };
  } catch {
    throw new Error("cursor is invalid or expired");
  }
}

function parseReference(reference: string) {
  const parts = reference.split(":");
  if (parts.length !== 3) return null;
  const [chainId, serviceRegistry, listingId] = parts;
  if (!chainId || !serviceRegistry || !listingId) return null;
  if (!/^[1-9]\d*$/.test(chainId) || !/^0x[0-9a-fA-F]{40}$/.test(serviceRegistry)) return null;
  if (!/^[1-9]\d*$/.test(listingId)) return null;
  return { chainId: BigInt(chainId), serviceRegistry, listingId: BigInt(listingId) };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function endpointQa(evidence: StoredVerificationEvidence | undefined): AgonEndpointQa {
  if (!evidence) {
    return {
      status: "not_checked",
      checkedAt: null,
      endpointStatus: null,
      evidenceHash: null,
      reason: "Agon has not run endpoint verification for this listing yet.",
      attempts: 0,
      passedAttempts: 0,
      successRate: null,
    };
  }
  const body = record(evidence.evidence);
  const checks = record(body?.checks);
  const x402 = record(checks?.x402_payment);
  const endpointStatus = typeof body?.endpointStatus === "number" && Number.isInteger(body.endpointStatus)
    ? body.endpointStatus
    : null;
  const checkedAt = typeof body?.checkedAt === "string" && !Number.isNaN(Date.parse(body.checkedAt))
    ? new Date(body.checkedAt).toISOString()
    : evidence.createdAt.toISOString();
  const passed = evidence.passed && x402?.passed === true;
  const endpointUrl = typeof body?.endpointUrl === "string" ? body.endpointUrl : undefined;
  const attempts = Number.isSafeInteger(evidence.attempts) && evidence.attempts > 0 ? evidence.attempts : 1;
  const passedAttempts = Number.isSafeInteger(evidence.passedAttempts) && evidence.passedAttempts >= 0
    ? Math.min(evidence.passedAttempts, attempts)
    : (evidence.passed ? 1 : 0);
  const reason = passed
    ? "Agon observed the service endpoint returning HTTP 402."
    : typeof body?.error === "string" && body.error
      ? body.error
      : typeof x402?.detail === "string" && x402.detail
        ? x402.detail
        : "The latest Agon endpoint verification did not pass.";
  return {
    status: passed ? "passed" : "failed",
    checkedAt,
    endpointStatus,
    evidenceHash: evidence.evidenceHash,
    reason,
    attempts,
    passedAttempts,
    successRate: Math.round((passedAttempts / attempts) * 100),
    ...(endpointUrl ? { endpointUrl } : {}),
  };
}

function listingView(listing: StoredListing, evidence?: StoredVerificationEvidence): AgonListingView {
  const unverified = listing.verification !== "Verified";
  const warning = listing.quarantineReason
    ? `This listing is quarantined because its indexed anchor failed validation: ${listing.quarantineReason}.`
    : unverified
      ? "This service has not passed Agon Arena verification."
      : null;
  return {
    id: `${listing.chainId}:${listing.serviceRegistry}:${listing.listingId}`,
    chainId: listing.chainId.toString(),
    serviceRegistry: listing.serviceRegistry,
    listingId: listing.listingId.toString(),
    agentId: listing.agentId.toString(),
    serviceKey: listing.serviceKey,
    category: listing.category.toString(),
    version: listing.currentVersion.toString(),
    manifest: { hash: listing.manifestHash, uri: listing.manifestUri },
    providerSnapshot: listing.providerSnapshot,
    status: listing.status,
    verification: {
      status: listing.verification,
      scope: {
        agentId: listing.agentId.toString(),
        listingId: listing.listingId.toString(),
        version: listing.currentVersion.toString(),
        category: listing.category.toString(),
      },
    },
    risk: {
      unverified,
      warning,
      quarantineReason: listing.quarantineReason,
    },
    endpointQa: endpointQa(evidence),
    payment: {
      rail: listing.paymentRail,
      directX402: listing.paymentRail === "X402" && listing.status === "Listed",
      escrowEligible:
        listing.paymentRail === "Escrow" &&
        listing.status === "Listed" &&
        listing.verification === "Verified" &&
        listing.quarantineReason === null,
    },
    provenance: {
      sourceBlockNumber: listing.sourceBlockNumber.toString(),
      sourceTxHash: listing.sourceTxHash,
      sourceLogIndex: listing.sourceLogIndex,
    },
  };
}

function escrowIntentView(intent: StoredAgonEscrowIntent, listingReference: string): AgonEscrowIntentView {
  const terminal = intent.state === "released" || intent.state === "refunded" || intent.state === "failed";
  return {
    intentId: intent.intentId,
    actor: intent.actor as `0x${string}`,
    idempotencyKey: intent.idempotencyKey,
    listingReference,
    termsHash: intent.termsHash,
    network: intent.terms.network,
    asset: intent.terms.asset,
    buyer: intent.terms.buyer,
    beneficiary: intent.terms.beneficiary,
    listing: intent.terms.listing,
    amountBaseUnits: intent.terms.amountBaseUnits.toString(),
    feeBps: intent.terms.feeBps,
    expiresAt: intent.terms.expiresAt.toISOString(),
    state: intent.state,
    providerReference: intent.providerReference,
    transaction: intent.transaction,
    poolBinding: intent.poolBinding ?? null,
    executionEnabled: false,
    nextAction: intent.state === "unknown"
      ? "reconcile_unknown_outcome"
      : terminal
        ? "none"
        : "escrow_adapter_not_enabled",
    createdAt: intent.createdAt.toISOString(),
    updatedAt: intent.updatedAt.toISOString(),
  };
}

function escrowReadinessView(intent: StoredAgonEscrowIntent, pool: AgonEscrowReadinessView["pool"]): AgonEscrowReadinessView {
  const terminal = intent.state === "released" || intent.state === "refunded" || intent.state === "failed";
  return {
    intentId: intent.intentId,
    state: intent.state,
    status: intent.state === "unknown" ? "reconciliation_required" : terminal ? "terminal" : "adapter_disabled",
    reason: intent.state === "unknown"
      ? "The previous escrow operation has an unknown outcome and requires independent reconciliation."
      : terminal
        ? "The escrow intent is terminal; no further operation is available."
        : "Agon escrow execution is disabled; the durable intent is ready for a separately approved adapter.",
    executionEnabled: false,
    nextAction: intent.state === "unknown"
      ? "reconcile_unknown_outcome"
      : terminal
        ? "none"
        : "escrow_adapter_not_enabled",
    pool,
    checkedAt: new Date().toISOString(),
  };
}

function internalError(error: unknown): Result<never, AgonServiceError> {
  console.error("[agon] service error:", error instanceof Error ? error.message : "unknown failure");
  return { ok: false, error: { code: "internal", message: "Agon service request failed" } };
}

function facilitatorVerificationView(evidence: StoredX402FacilitatorVerification): X402FacilitatorVerificationView {
  return {
    receiptId: evidence.receiptId,
    intentId: evidence.intentId,
    state: "facilitator_verified",
    network: evidence.network,
    payer: evidence.payer as `0x${string}` | null,
    approvalHash: evidence.approvalHash,
    evidenceHash: evidence.evidenceHash,
    verified: true,
    executionEnabled: false,
    nextAction: "settlement_remains_disabled",
    verifiedAt: evidence.verifiedAt.toISOString(),
  };
}

function quoteView(
  intent: { intentId: string; targetUrl?: string | null },
  receipt: { receiptId: string; updatedAt: Date },
  snapshot: X402QuoteSnapshot,
  quoteHash: string,
): X402QuoteView {
  return {
    receiptId: receipt.receiptId,
    intentId: intent.intentId,
    state: "payment_required",
    status: 402,
    targetUrl: intent.targetUrl!,
    quoteHash,
    x402Version: 2,
    resource: {
      url: snapshot.resource.url,
      description: snapshot.resource.description ?? null,
      mimeType: snapshot.resource.mimeType ?? null,
    },
    accepts: snapshot.accepts.map((option) => ({
      scheme: option.scheme,
      network: option.network,
      asset: option.asset,
      amount: option.amount,
      payTo: option.payTo,
      maxTimeoutSeconds: option.maxTimeoutSeconds,
      gateway: option.extra.name === "GatewayWalletBatched",
    })),
    executionEnabled: false,
    nextAction: "authorization_not_enabled",
    capturedAt: receipt.updatedAt.toISOString(),
  };
}

function authorizationView(
  intentId: string,
  receipt: { receiptId: string; updatedAt: Date },
  payload: X402AuthorizationPayload,
  payloadHash: string,
): X402AuthorizationView {
  return {
    receiptId: receipt.receiptId,
    intentId,
    state: "authorization_ready",
    payloadHash,
    payload: payload as unknown as X402AuthorizationView["payload"],
    expiresAt: new Date(Number(payload.message.validBefore) * 1000).toISOString(),
    executionEnabled: false,
    nextAction: "user_signature_required",
    preparedAt: receipt.updatedAt.toISOString(),
  };
}

function authorizationSubmittedView(
  intentId: string,
  receipt: { receiptId: string; authorizationHash: string | null; updatedAt: Date },
): X402AuthorizationSubmittedView {
  if (!receipt.authorizationHash) throw new Error("authorization receipt has no signature hash");
  return {
    receiptId: receipt.receiptId,
    intentId,
    state: "authorization_submitted",
    authorizationHash: receipt.authorizationHash,
    signatureAccepted: true,
    executionEnabled: false,
    nextAction: "settlement_not_enabled",
    submittedAt: receipt.updatedAt.toISOString(),
  };
}

function executionPlanView(
  intentId: string,
  receipt: { receiptId: string; updatedAt: Date },
  plan: X402ExecutionPlanView["plan"],
): X402ExecutionPlanView {
  return {
    receiptId: receipt.receiptId,
    intentId,
    state: "authorization_submitted",
    plan,
    executionEnabled: false,
    nextAction: "explicit_execution_approval",
    preparedAt: receipt.updatedAt.toISOString(),
  };
}

function executionApprovalView(
  receipt: { receiptId: string },
  approval: {
    approvalHash: string;
    intentId: string;
    actor: string;
    planHash: string;
    authorizationHash: string;
    approvalIdempotencyKey: string;
    approvedAt: Date;
    expiresAt: Date;
  },
): X402ExecutionApprovalView {
  return {
    approvalHash: approval.approvalHash,
    receiptId: receipt.receiptId,
    intentId: approval.intentId,
    actor: approval.actor as `0x${string}`,
    planHash: approval.planHash,
    authorizationHash: approval.authorizationHash,
    approvalIdempotencyKey: approval.approvalIdempotencyKey,
    testnetOnly: true,
    approvedAt: approval.approvedAt.toISOString(),
    expiresAt: approval.expiresAt.toISOString(),
    executionEnabled: false,
    nextAction: "execution_adapter_not_enabled",
  };
}

export class PostgresAgonMarketService implements AgonMarketService {
  private readonly repository: PostgresAgonRepository;
  private readonly options: PostgresAgonMarketServiceOptions;
  private readonly escrowLifecycle: ReturnType<typeof createAgonEscrowLifecycleOrchestrator>;

  constructor(repository: PostgresAgonRepository, options: PostgresAgonMarketServiceOptions = {}) {
    this.repository = repository;
    this.options = options;
    this.escrowLifecycle = createAgonEscrowLifecycleOrchestrator({
      store: repository,
      enabled: options.escrowExecutionEnabled === true,
      adapter: options.escrowExecutionAdapter ?? createDisabledAgonEscrowAdapter(),
    });
  }

  async listListings(query: ListingQuery): Promise<Result<ListingPage, AgonServiceError>> {
    try {
      const rows = await this.repository.listListings({
        limit: query.limit,
        cursor: decodeCursor(query.cursor),
        category: query.category ? parsePositive(query.category, "category") : null,
        agentId: query.agentId ? parsePositive(query.agentId, "agent id") : null,
      });
      const hasMore = rows.length > query.limit;
      const pageRows = rows.slice(0, query.limit);
      const last = pageRows.at(-1);
      const evidence = await this.repository.getLatestVerificationEvidence(pageRows);
      return {
        ok: true,
        value: {
          items: pageRows.map((listing) => listingView(listing, evidence.get(`${listing.listingId}:${listing.agentId}`))),
          nextCursor: hasMore && last ? encodeCursor(last) : null,
        },
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("cursor")) {
        return { ok: false, error: { code: "validation_failed", message: error.message } };
      }
      return internalError(error);
    }
  }

  async getListing(reference: string): Promise<Result<AgonListingView, AgonServiceError>> {
    const key = parseReference(reference);
    if (!key) return { ok: false, error: { code: "not_found", message: "listing not found" } };
    try {
      const listing = await this.repository.getListing(key);
      return listing
        ? {
            ok: true,
            value: listingView(
              listing,
              (await this.repository.getLatestVerificationEvidence([listing])).get(`${listing.listingId}:${listing.agentId}`),
            ),
          }
        : { ok: false, error: { code: "not_found", message: "listing not found" } };
    } catch (error) {
      return internalError(error);
    }
  }

  async bindProfile(
    actor: string,
    request: BindProfileRequest,
  ): Promise<Result<SubmittedOperation, AgonServiceError>> {
    if (!this.options.writer) {
      return {
        ok: false,
        error: { code: "capability_unavailable", message: "profile writes are unavailable" },
      };
    }
    return this.options.writer.bindProfile(actor, request);
  }

  async publishListing(
    actor: string,
    request: PublishListingRequest,
  ): Promise<Result<SubmittedOperation, AgonServiceError>> {
    if (!this.options.writer) {
      return {
        ok: false,
        error: { code: "capability_unavailable", message: "listing writes are unavailable" },
      };
    }
    return this.options.writer.publishListing(actor, request);
  }

  async confirmOperation(
    actor: string,
    operationId: string,
    txHash: `0x${string}`,
  ): Promise<Result<SubmittedOperation, AgonServiceError>> {
    if (!this.options.writer) {
      return {
        ok: false,
        error: { code: "capability_unavailable", message: "write confirmation is unavailable" },
      };
    }
    return this.options.writer.confirmOperation(actor, operationId, txHash);
  }

  async prepareAgonEscrowIntent(
    actor: string,
    request: AgonEscrowIntentRequest,
  ): Promise<Result<AgonEscrowIntentView, AgonServiceError>> {
    const listing = await this.getListing(request.listingReference);
    if (!listing.ok) return listing;
    const terms = evaluateAgonEscrowTerms({
      listing: {
        serviceRegistry: listing.value.serviceRegistry,
        listingId: listing.value.listingId,
        agentId: listing.value.agentId,
        version: listing.value.version,
        manifestHash: listing.value.manifest.hash,
        providerSnapshot: listing.value.providerSnapshot,
        status: listing.value.status,
        verification: listing.value.verification.status,
        paymentRail: listing.value.payment.rail,
        quarantineReason: listing.value.risk.quarantineReason,
      } satisfies AgonEscrowListing,
      buyer: actor,
      amountBaseUnits: request.amountBaseUnits,
      feeBps: request.feeBps,
      expiresAt: new Date(request.expiresAt),
    });
    if (!terms.ok) {
      return {
        ok: false,
        error: {
          code: terms.error.code === "escrow_not_eligible" ? "capability_unavailable" : "validation_failed",
          message: terms.error.message,
        },
      };
    }
    try {
      let poolBinding: AgonPrizeEscrowPoolBinding | null = null;
      if (request.poolBinding) {
        if (!this.options.escrowPoolContract) {
          return { ok: false, error: { code: "capability_unavailable", message: "PrizeEscrow pool binding is not configured" } };
        }
        try {
          poolBinding = validateAgonPrizeEscrowPoolBinding({
            contractAddress: this.options.escrowPoolContract,
            controller: request.poolBinding.controller,
            poolId: request.poolBinding.poolId,
          }, this.options.escrowPoolContract);
        } catch (error) {
          return { ok: false, error: { code: "validation_failed", message: error instanceof Error ? error.message : "PrizeEscrow pool binding is invalid" } };
        }
      }
      const stored = await this.repository.prepareAgonEscrowIntent({
        intentId: randomUUID(),
        actor,
        idempotencyKey: request.idempotencyKey,
        listingReference: request.listingReference,
        termsHash: hashAgonEscrowTerms(terms.value),
        terms: terms.value,
        state: "prepared",
        providerReference: null,
        transaction: null,
        poolBinding,
      });
      return { ok: true, value: escrowIntentView(stored, stored.listingReference) };
    } catch (error) {
      if (error instanceof AgonStoreInvariantError && error.message.includes("idempotency")) {
        return { ok: false, error: { code: "conflict", message: error.message } };
      }
      return internalError(error);
    }
  }

  async getAgonEscrowIntent(
    actor: string,
    intentId: string,
  ): Promise<Result<AgonEscrowIntentView, AgonServiceError>> {
    const intent = await this.repository.getAgonEscrowIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "Agon escrow intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the escrow intent owner can read this intent" } };
    return { ok: true, value: escrowIntentView(intent, intent.listingReference) };
  }

  async getAgonEscrowReadiness(
    actor: string,
    intentId: string,
  ): Promise<Result<AgonEscrowReadinessView, AgonServiceError>> {
    const intent = await this.repository.getAgonEscrowIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "Agon escrow intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the escrow intent owner can read escrow readiness" } };
    let pool: AgonEscrowReadinessView["pool"] = {
      status: "unbound",
      contractAddress: null,
      controller: null,
      poolId: null,
      balanceBaseUnits: null,
      checkedAt: null,
    };
    if (intent.poolBinding) {
      pool = {
        status: !this.options.escrowReadAdapter?.enabled ? "lookup_disabled" : "unavailable",
        contractAddress: intent.poolBinding.contractAddress,
        controller: intent.poolBinding.controller,
        poolId: intent.poolBinding.poolId,
        balanceBaseUnits: null,
        checkedAt: null,
      };
      if (this.options.escrowReadAdapter?.enabled) {
        try {
          const result = await this.options.escrowReadAdapter.inspect({
            network: intent.terms.network,
            escrowAddress: intent.poolBinding.contractAddress,
            controller: intent.poolBinding.controller,
            poolId: intent.poolBinding.poolId,
            expectedAsset: intent.terms.asset,
            expectedBalanceBaseUnits: intent.terms.amountBaseUnits.toString(),
          });
          pool = {
            ...pool,
            status: result.controllerAuthorized ? "match" : "controller_unapproved",
            balanceBaseUnits: result.balanceBaseUnits,
            checkedAt: result.checkedAt ?? new Date().toISOString(),
          };
        } catch (error) {
          if (error instanceof Error && (error.message.includes("does not match") || error.message.includes("different"))) pool.status = "mismatch";
        }
      }
    }
    return { ok: true, value: escrowReadinessView(intent, pool) };
  }

  private async executeAgonEscrowLifecycle(
    actor: string,
    intentId: string,
    action: AgonEscrowLifecycleAction,
    confirmation: string,
  ): Promise<Result<AgonEscrowIntentView, AgonServiceError>> {
    const expected = {
      fund: "FUND_ARC_TESTNET_ESCROW",
      release: "RELEASE_ARC_TESTNET_ESCROW",
      refund: "REFUND_ARC_TESTNET_ESCROW",
    }[action];
    if (confirmation !== expected) return { ok: false, error: { code: "validation_failed", message: "explicit Arc Testnet escrow confirmation is required" } };
    const intent = await this.repository.getAgonEscrowIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "Agon escrow intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the escrow intent owner can execute this operation" } };
    if (!this.options.escrowExecutionEnabled || !this.options.escrowExecutionAdapter?.enabled) {
      return { ok: false, error: { code: "escrow_disabled", message: "Agon escrow execution is disabled by policy" } };
    }
    if (!intent.poolBinding || !this.options.escrowReadAdapter?.enabled) {
      return { ok: false, error: { code: "execution_not_ready", message: "escrow execution requires a bound pool and enabled read-only readiness adapter" } };
    }
    const readiness = await this.getAgonEscrowReadiness(actor, intentId);
    if (!readiness.ok) return readiness;
    if (readiness.value.pool.status !== "match") {
      return { ok: false, error: { code: "execution_not_ready", message: `escrow pool is ${readiness.value.pool.status}; an exact authorized pool match is required` } };
    }
    const result = await this.escrowLifecycle[action](intentId);
    if (!result.ok) {
      if (result.error.code === "escrow_disabled") return { ok: false, error: { code: "escrow_disabled", message: result.error.message } };
      if (result.error.code === "escrow_unknown") return { ok: false, error: { code: "conflict", message: result.error.message } };
      return { ok: false, error: { code: "execution_not_ready", message: result.error.message } };
    }
    return { ok: true, value: escrowIntentView(result.intent, result.intent.listingReference) };
  }

  async fundAgonEscrow(
    actor: string,
    intentId: string,
    confirmation: string,
  ): Promise<Result<AgonEscrowIntentView, AgonServiceError>> {
    return this.executeAgonEscrowLifecycle(actor, intentId, "fund", confirmation);
  }

  async releaseAgonEscrow(
    actor: string,
    intentId: string,
    confirmation: string,
  ): Promise<Result<AgonEscrowIntentView, AgonServiceError>> {
    return this.executeAgonEscrowLifecycle(actor, intentId, "release", confirmation);
  }

  async refundAgonEscrow(
    actor: string,
    intentId: string,
    confirmation: string,
  ): Promise<Result<AgonEscrowIntentView, AgonServiceError>> {
    return this.executeAgonEscrowLifecycle(actor, intentId, "refund", confirmation);
  }

  async prepareX402Call(
    actor: string,
    reference: string,
    request: X402CallIntentRequest,
  ): Promise<Result<X402CallIntentView, AgonServiceError>> {
    const listing = await this.getListing(reference);
    if (!listing.ok) return listing;
    const prepared = prepareX402Call(actor, listing.value, request);
    if (!prepared.ok) {
      return {
        ok: false,
        error: {
          code: prepared.error.code === "invalid_request" ? "validation_failed" : "capability_unavailable",
          message: prepared.error.message,
        },
      };
    }
    try {
      const stored = await this.repository.prepareX402CallIntent({
        intentId: randomUUID(),
        actor: prepared.value.actor,
        idempotencyKey: prepared.value.idempotencyKey,
        listingReference: listing.value.id,
        chainId: BigInt(listing.value.chainId),
        serviceRegistry: listing.value.serviceRegistry,
        listingId: BigInt(listing.value.listingId),
        agentId: BigInt(listing.value.agentId),
        version: BigInt(listing.value.version),
        method: prepared.value.method,
        input: prepared.value.input,
        inputHash: prepared.value.inputHash,
        maxAmountUSDC: prepared.value.maxAmountUSDC,
        targetUrl: prepared.value.targetUrl,
        state: "prepared",
      });
      return {
        ok: true,
        value: callIntentView({
          intentId: stored.intentId,
          actor: stored.actor,
          idempotencyKey: stored.idempotencyKey,
          listingReference: stored.listingReference,
          listingVersion: stored.version.toString(),
          inputHash: stored.inputHash,
          maxAmountUSDC: stored.maxAmountUSDC,
          state: stored.state,
          createdAt: stored.createdAt,
          targetUrl: stored.targetUrl,
        }),
      };
    } catch (error) {
      if (error instanceof AgonStoreInvariantError && error.message.includes("idempotency key")) {
        return { ok: false, error: { code: "conflict", message: error.message } };
      }
      return internalError(error);
    }
  }

  async approveX402Call(
    actor: string,
    intentId: string,
    request: X402ApprovalRequest,
  ): Promise<Result<X402ApprovalView, AgonServiceError>> {
    const intent = await this.repository.getX402CallIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "x402 call intent not found" } };
    if (intent.actor !== actor.toLowerCase()) {
      return { ok: false, error: { code: "not_owner", message: "only the intent owner can approve this spend" } };
    }
    const approval = validateX402Approval(intent.maxAmountUSDC, request);
    if (!approval.ok) {
      return {
        ok: false,
        error: {
          code: approval.error.code === "limit_exceeded" ? "validation_failed" : "validation_failed",
          message: approval.error.message,
        },
      };
    }
    try {
      const receipt = await this.repository.approveX402CallReceipt(intent.intentId, approval.value.approvedAmountUSDC);
      if (receipt.state !== "approved" || !receipt.approvedAmountUSDC) {
        return { ok: false, error: { code: "conflict", message: `x402 receipt is ${receipt.state}, not approved` } };
      }
      return {
        ok: true,
        value: {
          receiptId: receipt.receiptId,
          intentId: receipt.intentId,
          actor: intent.actor,
          state: "approved",
          approvedAmountUSDC: receipt.approvedAmountUSDC,
          executionEnabled: false,
          nextAction: "payment_adapter_not_enabled",
          approvedAt: receipt.updatedAt.toISOString(),
        },
      };
    } catch (error) {
      if (error instanceof AgonStoreInvariantError) {
        return { ok: false, error: { code: "conflict", message: error.message } };
      }
      return internalError(error);
    }
  }

  async captureX402Quote(
    actor: string,
    intentId: string,
  ): Promise<Result<X402QuoteView, AgonServiceError>> {
    const intent = await this.repository.getX402CallIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "x402 call intent not found" } };
    if (intent.actor !== actor.toLowerCase()) {
      return { ok: false, error: { code: "not_owner", message: "only the intent owner can capture this quote" } };
    }
    const receipt = await this.repository.getX402CallReceipt(intentId);
    if (!receipt) return { ok: false, error: { code: "receipt_unavailable", message: "x402 approval receipt has not been created" } };
    if (receipt.state === "payment_required" && receipt.quoteSnapshot && receipt.quoteHash) {
      return { ok: true, value: quoteView(intent, receipt, receipt.quoteSnapshot as X402QuoteSnapshot, receipt.quoteHash) };
    }
    if (receipt.state !== "approved") {
      return { ok: false, error: { code: "conflict", message: `x402 receipt is ${receipt.state}; approve the spend before reading a quote` } };
    }
    if (!intent.targetUrl || !receipt.approvedAmountUSDC) {
      return { ok: false, error: { code: "capability_unavailable", message: "this intent has no verified HTTPS provider endpoint" } };
    }
    const fetchImpl = this.options.fetchImpl ?? globalThis.fetch;
    let response: Response;
    try {
      response = await fetchImpl(intent.targetUrl, {
        method: intent.method,
        redirect: "error",
        headers: intent.method === "GET" || intent.method === "DELETE" ? undefined : { "content-type": "application/json" },
        body: intent.method === "GET" || intent.method === "DELETE" ? undefined : JSON.stringify(intent.input),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return { ok: false, error: { code: "capability_unavailable", message: "Agon could not reach the verified provider endpoint" } };
    }
    if (response.status !== 402) {
      return { ok: false, error: { code: "validation_failed", message: `provider returned HTTP ${response.status}; expected HTTP 402` } };
    }
    const parsed = parsePaymentRequiredHeader(response.headers.get("PAYMENT-REQUIRED"), intent.targetUrl, intent.chainId.toString(), receipt.approvedAmountUSDC);
    if (!parsed.ok) return { ok: false, error: { code: "receipt_invalid", message: parsed.error.message } };
    try {
      const stored = await this.repository.advanceX402CallReceipt(intentId, {
        type: "payment_required",
        quoteHash: parsed.value.quoteHash,
        quoteSnapshot: parsed.value.snapshot,
      });
      return { ok: true, value: quoteView(intent, stored, parsed.value.snapshot, parsed.value.quoteHash) };
    } catch (error) {
      if (error instanceof AgonStoreInvariantError) return { ok: false, error: { code: "conflict", message: error.message } };
      return internalError(error);
    }
  }

  async prepareX402Authorization(
    actor: string,
    intentId: string,
  ): Promise<Result<X402AuthorizationView, AgonServiceError>> {
    const intent = await this.repository.getX402CallIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "x402 call intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the intent owner can prepare authorization" } };
    const receipt = await this.repository.getX402CallReceipt(intentId);
    if (!receipt) return { ok: false, error: { code: "receipt_unavailable", message: "x402 receipt has not been created" } };
    if (receipt.state === "authorization_ready" && receipt.authorizationPayload && receipt.authorizationPayloadHash) {
      return { ok: true, value: authorizationView(intentId, receipt, receipt.authorizationPayload as X402AuthorizationPayload, receipt.authorizationPayloadHash) };
    }
    if (receipt.state !== "payment_required" || !receipt.quoteSnapshot) {
      return { ok: false, error: { code: "conflict", message: `x402 receipt is ${receipt.state}; capture a payment quote first` } };
    }
    const built = buildX402Authorization(actor, intent.chainId.toString(), receipt.quoteSnapshot as X402QuoteSnapshot);
    if (!built.ok) return { ok: false, error: { code: "receipt_invalid", message: built.error.message } };
    try {
      const stored = await this.repository.advanceX402CallReceipt(intentId, {
        type: "authorization_ready",
        authorizationPayloadHash: built.value.payloadHash,
        authorizationPayload: built.value.payload,
      });
      return { ok: true, value: authorizationView(intentId, stored, built.value.payload, built.value.payloadHash) };
    } catch (error) {
      if (error instanceof AgonStoreInvariantError) return { ok: false, error: { code: "conflict", message: error.message } };
      return internalError(error);
    }
  }

  async submitX402Authorization(
    actor: string,
    intentId: string,
    request: X402AuthorizationSignatureRequest,
  ): Promise<Result<X402AuthorizationSubmittedView, AgonServiceError>> {
    const intent = await this.repository.getX402CallIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "x402 call intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the intent owner can submit authorization" } };
    const receipt = await this.repository.getX402CallReceipt(intentId);
    if (!receipt) return { ok: false, error: { code: "receipt_unavailable", message: "x402 receipt has not been created" } };
    if (receipt.state === "authorization_submitted" && receipt.authorizationHash) {
      const submittedHash = keccak256(request.signature as `0x${string}`);
      if (submittedHash.toLowerCase() !== receipt.authorizationHash.toLowerCase()) {
        return { ok: false, error: { code: "conflict", message: "a different authorization signature was already recorded" } };
      }
      return { ok: true, value: authorizationSubmittedView(intentId, receipt) };
    }
    if (receipt.state !== "authorization_ready" || !receipt.authorizationPayload || !receipt.authorizationPayloadHash) {
      return { ok: false, error: { code: "conflict", message: `x402 receipt is ${receipt.state}; prepare an authorization payload first` } };
    }
    if (request.payloadHash.toLowerCase() !== receipt.authorizationPayloadHash.toLowerCase()) {
      return { ok: false, error: { code: "signature_invalid", message: "payload hash does not match the prepared authorization" } };
    }
    const checked = await validateX402AuthorizationSignature(
      receipt.authorizationPayload as X402AuthorizationPayload,
      request.signature,
      actor,
    );
    if (!checked.ok) return { ok: false, error: { code: "signature_invalid", message: checked.error.message } };
    try {
      const stored = await this.repository.advanceX402CallReceipt(intentId, {
        type: "authorization_submitted",
        authorizationHash: checked.value.signatureHash,
      });
      return { ok: true, value: authorizationSubmittedView(intentId, stored) };
    } catch (error) {
      if (error instanceof AgonStoreInvariantError) return { ok: false, error: { code: "conflict", message: error.message } };
      return internalError(error);
    }
  }

  async prepareX402ExecutionPlan(
    actor: string,
    intentId: string,
  ): Promise<Result<X402ExecutionPlanView, AgonServiceError>> {
    const intent = await this.repository.getX402CallIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "x402 call intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the intent owner can prepare an execution plan" } };
    const receipt = await this.repository.getX402CallReceipt(intentId);
    if (!receipt) return { ok: false, error: { code: "receipt_unavailable", message: "x402 receipt has not been created" } };
    if (receipt.state !== "authorization_submitted" || !receipt.quoteSnapshot || !receipt.authorizationPayload || !receipt.authorizationPayloadHash || !receipt.authorizationHash || !receipt.approvedAmountUSDC) {
      return { ok: false, error: { code: "conflict", message: `x402 receipt is ${receipt.state}; submit a valid authorization first` } };
    }
    const built = buildX402ExecutionPlan({
      snapshot: receipt.quoteSnapshot as X402QuoteSnapshot,
      authorization: receipt.authorizationPayload as X402AuthorizationPayload,
      authorizationPayloadHash: receipt.authorizationPayloadHash,
      authorizationHash: receipt.authorizationHash,
      approvedAmountUSDC: receipt.approvedAmountUSDC,
    });
    if (!built.ok) return { ok: false, error: { code: "execution_not_ready", message: built.error.message } };
    return { ok: true, value: executionPlanView(intentId, receipt, built.value) };
  }

  async approveX402Execution(
    actor: string,
    intentId: string,
    request: X402ExecutionApprovalRequest,
  ): Promise<Result<X402ExecutionApprovalView, AgonServiceError>> {
    const intent = await this.repository.getX402CallIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "x402 call intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the intent owner can approve execution" } };
    const receipt = await this.repository.getX402CallReceipt(intentId);
    if (!receipt) return { ok: false, error: { code: "receipt_unavailable", message: "x402 receipt has not been created" } };
    if (receipt.state !== "authorization_submitted" || !receipt.quoteSnapshot || !receipt.authorizationPayload || !receipt.authorizationPayloadHash || !receipt.authorizationHash || !receipt.approvedAmountUSDC) {
      return { ok: false, error: { code: "conflict", message: `x402 receipt is ${receipt.state}; submit a valid authorization first` } };
    }
    const plan = buildX402ExecutionPlan({
      snapshot: receipt.quoteSnapshot as X402QuoteSnapshot,
      authorization: receipt.authorizationPayload as X402AuthorizationPayload,
      authorizationPayloadHash: receipt.authorizationPayloadHash,
      authorizationHash: receipt.authorizationHash,
      approvedAmountUSDC: receipt.approvedAmountUSDC,
    });
    if (!plan.ok) return { ok: false, error: { code: "execution_not_ready", message: plan.error.message } };
    const approval = buildX402ExecutionApproval({ intentId, actor, plan: plan.value, request });
    if (!approval.ok) return { ok: false, error: { code: "execution_not_ready", message: approval.error.message } };
    try {
      const stored = await this.repository.recordX402ExecutionApproval({
        approvalHash: approval.value.approvalHash,
        intentId,
        actor,
        planHash: approval.value.planHash,
        authorizationHash: approval.value.authorizationHash,
        approvalIdempotencyKey: approval.value.approvalIdempotencyKey,
        approvedAt: new Date(approval.value.approvedAt),
        expiresAt: new Date(approval.value.expiresAt),
      });
      return { ok: true, value: executionApprovalView(receipt, stored) };
    } catch (error) {
      if (error instanceof AgonStoreInvariantError) return { ok: false, error: { code: "conflict", message: error.message } };
      return internalError(error);
    }
  }

  async getX402ExecutionReadiness(
    actor: string,
    intentId: string,
  ): Promise<Result<X402ExecutionReadinessView, AgonServiceError>> {
    const intent = await this.repository.getX402CallIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "x402 call intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the intent owner can inspect execution readiness" } };
    const receipt = await this.repository.getX402CallReceipt(intentId);
    if (!receipt) return { ok: false, error: { code: "receipt_unavailable", message: "x402 receipt has not been created" } };
    if (receipt.state !== "authorization_submitted" || !receipt.quoteSnapshot || !receipt.authorizationPayload || !receipt.authorizationPayloadHash || !receipt.authorizationHash || !receipt.approvedAmountUSDC) {
      return { ok: false, error: { code: "conflict", message: `x402 receipt is ${receipt.state}; submit a valid authorization first` } };
    }
    const plan = buildX402ExecutionPlan({
      snapshot: receipt.quoteSnapshot as X402QuoteSnapshot,
      authorization: receipt.authorizationPayload as X402AuthorizationPayload,
      authorizationPayloadHash: receipt.authorizationPayloadHash,
      authorizationHash: receipt.authorizationHash,
      approvedAmountUSDC: receipt.approvedAmountUSDC,
    });
    if (!plan.ok) return { ok: false, error: { code: "execution_not_ready", message: plan.error.message } };
    const stored = await this.repository.getLatestX402ExecutionApproval(intentId);
    const expired = stored ? stored.expiresAt.getTime() <= Date.now() : false;
    return {
      ok: true,
      value: {
        receiptId: receipt.receiptId,
        intentId,
        state: "authorization_submitted",
        plan: plan.value,
        approval: stored ? executionApprovalView(receipt, stored) : null,
        status: !stored ? "approval_required" : expired ? "approval_expired" : "approved_but_disabled",
        reason: !stored
          ? "Execution approval is required before a settlement adapter can be considered."
          : expired
            ? "The execution approval expired; prepare a fresh approval before any future execution review."
            : "Approval evidence is valid, but Circle settlement remains disabled by policy.",
        executionEnabled: false,
        nextAction: !stored || expired ? "explicit_execution_approval" : "execution_adapter_not_enabled",
        checkedAt: new Date().toISOString(),
      },
    };
  }

  async getX402SettlementReadiness(
    actor: string,
    intentId: string,
  ): Promise<Result<X402SettlementReadinessView, AgonServiceError>> {
    const intent = await this.repository.getX402CallIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "x402 call intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the intent owner can inspect settlement readiness" } };
    const receipt = await this.repository.getX402CallReceipt(intentId);
    if (!receipt) return { ok: false, error: { code: "receipt_unavailable", message: "x402 receipt has not been created" } };
      const executionPolicyRequested = this.options.x402ExecutionEnabled === true;
    const transactionRef = receipt.settlementRef && /^0x[0-9a-f]{64}$/i.test(receipt.settlementRef)
      ? receipt.settlementRef
      : null;
    let status: X402SettlementReadinessView["status"];
    let reason: string;
    let nextAction: X402SettlementReadinessView["nextAction"];
    switch (receipt.state) {
        case "authorization_submitted":
          status = "ready_but_disabled";
          reason = executionPolicyRequested
            ? "Settlement policy is configured, but no facilitator route is wired in this service instance."
            : "Authorization is valid, but Circle settlement is disabled by policy.";
        nextAction = "execution_adapter_not_enabled";
        break;
      case "settlement_submitted":
        status = "service_delivery_pending";
        reason = transactionRef
          ? "Arc Testnet payment submission is recorded. Service delivery must be confirmed separately."
          : "A settlement attempt is recorded. A trusted transaction receipt is still required.";
        nextAction = "deliver_service";
        break;
      case "unknown":
        status = "reconciliation_required";
        reason = "The settlement outcome is ambiguous. Reconcile the Arc Testnet receipt before retrying.";
        nextAction = "reconcile_settlement";
        break;
      case "service_delivered":
        status = "service_delivery_pending";
        reason = "The provider response is recorded. Reconciliation is required before final receipt completion.";
        nextAction = "reconcile_settlement";
        break;
      case "reconciled":
      case "rejected":
      case "failed":
        status = "terminal";
        reason = receipt.state === "reconciled"
          ? "This x402 receipt is complete and immutable."
          : `This x402 receipt is terminal: ${receipt.state}.`;
        nextAction = "none";
        break;
      default:
        status = "authorization_required";
        reason = `x402 receipt is ${receipt.state}; complete authorization before settlement can be considered.`;
        nextAction = "complete_authorization";
        break;
    }
    return {
      ok: true,
      value: {
        receiptId: receipt.receiptId,
        intentId,
        state: receipt.state,
        network: "eip155:5042002",
        settlementRef: transactionRef,
        providerTransferId: receipt.providerTransferId ?? null,
        status,
        reason,
        executionEnabled: false,
        nextAction,
        checkedAt: new Date().toISOString(),
      },
    };
  }

  async getX402ReconciliationReadiness(
    actor: string,
    intentId: string,
  ): Promise<Result<X402ReconciliationReadinessView, AgonServiceError>> {
    const intent = await this.repository.getX402CallIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "x402 call intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the intent owner can inspect receipt reconciliation" } };
    const receipt = await this.repository.getX402CallReceipt(intentId);
    if (!receipt) return { ok: false, error: { code: "receipt_unavailable", message: "x402 receipt has not been created" } };

    const transaction = receipt.settlementRef && /^0x[0-9a-f]{64}$/i.test(receipt.settlementRef)
      ? receipt.settlementRef.toLowerCase() as `0x${string}`
      : null;
    const providerTransferId = receipt.providerTransferId && isX402ProviderTransferId(receipt.providerTransferId)
      ? receipt.providerTransferId.toLowerCase()
      : null;
    let status: X402ReconciliationReadinessView["status"];
    let reason: string;
    let nextAction: X402ReconciliationReadinessView["nextAction"];
    const lookupEnabled = this.options.x402ReceiptLookup?.enabled === true;
    switch (receipt.state) {
      case "unknown":
      case "service_delivered":
        if (!transaction && !providerTransferId) {
          status = "reference_required";
          reason = lookupEnabled
            ? "The read-only lookup adapter is enabled, but this receipt has no valid provider reference to query."
            : "The settlement outcome is ambiguous and has no valid provider reference. Enable a read-only receipt lookup after recording the provider reference.";
          nextAction = "record_provider_reference";
        } else if (!lookupEnabled) {
          status = "lookup_disabled";
          reason = "A provider receipt is required for this Arc Testnet settlement, but the read-only lookup adapter is disabled.";
          nextAction = "enable_receipt_lookup";
        } else {
          status = "lookup_required";
          reason = "A provider reference exists and the read-only lookup adapter is enabled. Reconcile matching Arc Testnet evidence.";
          nextAction = "reconcile_receipt";
        }
        break;
      case "settlement_submitted":
        if (!transaction && !providerTransferId) {
          status = "reference_required";
          reason = lookupEnabled
            ? "The read-only lookup adapter is enabled, but settlement was recorded without a valid provider reference."
            : "Settlement was recorded without a valid provider reference. Enable lookup only after a provider reference is recorded.";
          nextAction = "record_provider_reference";
        } else if (!lookupEnabled) {
          status = "lookup_disabled";
          reason = "A settlement reference exists, but the read-only lookup adapter is disabled.";
          nextAction = "enable_receipt_lookup";
        } else {
          status = "lookup_required";
          reason = "A settlement reference exists and the read-only lookup adapter is enabled. Reconcile only matching Arc Testnet evidence.";
          nextAction = "reconcile_receipt";
        }
        break;
      case "reconciled":
      case "rejected":
      case "failed":
        status = "terminal";
        reason = receipt.state === "reconciled"
          ? "This receipt is reconciled and terminal. No provider lookup is required."
          : `This x402 receipt is terminal: ${receipt.state}.`;
        nextAction = "none";
        break;
      default:
        status = "not_required";
        reason = `x402 receipt is ${receipt.state}; complete authorization before receipt reconciliation can begin.`;
        nextAction = "complete_authorization";
        break;
    }
    return {
      ok: true,
      value: {
        receiptId: receipt.receiptId,
        intentId,
        state: receipt.state,
        network: "eip155:5042002",
        transaction,
        providerTransferId,
        status,
        reason,
        lookupEnabled,
        executionEnabled: false,
        nextAction,
        checkedAt: new Date().toISOString(),
      },
    };
  }

  async reconcileX402Receipt(
    actor: string,
    intentId: string,
    request: X402ReconciliationRequest,
  ): Promise<Result<X402ReconciliationView, AgonServiceError>> {
    const adapter = this.options.x402ReceiptLookup;
    if (!adapter || adapter.enabled !== true) {
      return { ok: false, error: { code: "reconciliation_disabled", message: "Arc Testnet receipt reconciliation is disabled by policy" } };
    }
    if (request.confirmation !== "RECONCILE_ARC_TESTNET_X402") {
      return { ok: false, error: { code: "validation_failed", message: "explicit Arc Testnet reconciliation confirmation is required" } };
    }
    const intent = await this.repository.getX402CallIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "x402 call intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the intent owner can reconcile this receipt" } };
    const receipt = await this.repository.getX402CallReceipt(intentId);
    if (!receipt) return { ok: false, error: { code: "receipt_unavailable", message: "x402 receipt has not been created" } };
    const transaction = receipt.settlementRef && isX402Transaction(receipt.settlementRef) ? receipt.settlementRef.toLowerCase() as `0x${string}` : null;
    const providerTransferId = receipt.providerTransferId && isX402ProviderTransferId(receipt.providerTransferId) ? receipt.providerTransferId.toLowerCase() : null;
    if (!transaction && !providerTransferId) {
      return { ok: false, error: { code: "reconciliation_invalid", message: "x402 receipt has no valid Arc Testnet transaction or provider transfer reference" } };
    }
    if (receipt.state !== "unknown" && receipt.state !== "settlement_submitted") {
      return { ok: false, error: { code: "conflict", message: `x402 receipt is ${receipt.state}; reconciliation is not applicable` } };
    }

    let lookup: Awaited<ReturnType<X402ReceiptLookupAdapter["lookup"]>>;
    try {
      const authorization = receipt.authorizationPayload as { message?: { from?: string; to?: string; value?: string } } | null;
      const quote = receipt.quoteSnapshot as { accepts?: Array<{ payTo?: string; amount?: string }> } | null;
      const payer = typeof authorization?.message?.from === "string" && /^0x[0-9a-f]{40}$/i.test(authorization.message.from) ? authorization.message.from as `0x${string}` : undefined;
      const recipientValue = authorization?.message?.to ?? quote?.accepts?.[0]?.payTo;
      const recipient = typeof recipientValue === "string" && /^0x[0-9a-f]{40}$/i.test(recipientValue) ? recipientValue as `0x${string}` : undefined;
      const amountAtomicUnits = authorization?.message?.value ?? quote?.accepts?.[0]?.amount;
      lookup = await adapter.lookup({
        network: "eip155:5042002",
        transaction,
        providerTransferId,
        expected: {
          payer,
          recipient,
          amountAtomicUnits,
        },
      });
      lookup = validateX402ReceiptLookupResult(lookup, { network: "eip155:5042002", transaction, providerTransferId, expected: {
        payer,
        recipient,
        amountAtomicUnits,
      } });
    } catch (error) {
      return { ok: false, error: { code: "reconciliation_unavailable", message: error instanceof Error ? error.message : "provider receipt lookup failed without trusted evidence" } };
    }

    const orchestrator = createX402SettlementOrchestrator({
      store: this.repository,
      adapter: { settle: async () => ({ ok: false, error: { code: "execution_disabled", message: "settlement is not part of reconciliation" } }) },
      policy: createX402ExecutionPolicy({ enabled: false, maxAmountBaseUnits: 0n }),
    });
    const reconciled = await orchestrator.reconcile(intentId, lookup);
    if (!reconciled.ok) {
      return { ok: false, error: { code: "reconciliation_invalid", message: reconciled.error.message } };
    }
    const nextState = reconciled.receipt.state;
    return {
      ok: true,
      value: {
        receiptId: reconciled.receipt.receiptId,
        intentId,
        state: nextState,
        network: "eip155:5042002",
        status: lookup.status,
        transaction: lookup.transaction ?? null,
        providerTransferId: lookup.providerTransferId ?? null,
        executionEnabled: false,
        serviceDeliveryPending: nextState === "settlement_submitted",
        nextAction: nextState === "failed" ? "none" : lookup.status === "pending" ? "reconcile_receipt" : "deliver_service",
        recordedAt: reconciled.receipt.updatedAt.toISOString(),
      },
    };
  }

  async settleX402Call(
    actor: string,
    intentId: string,
    request: X402SettlementRequest,
  ): Promise<Result<X402SettlementView, AgonServiceError>> {
    if (this.options.x402ExecutionEnabled !== true || !this.options.x402SettlementAdapter) {
      return { ok: false, error: { code: "execution_not_ready", message: "Circle x402 settlement is disabled by policy" } };
    }
    if (request.confirmation !== "EXECUTE_ARC_TESTNET_X402") {
      return { ok: false, error: { code: "validation_failed", message: "explicit Arc Testnet settlement confirmation is required" } };
    }
    const intent = await this.repository.getX402CallIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "x402 call intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the intent owner can settle this call" } };
    const receipt = await this.repository.getX402CallReceipt(intentId);
    if (!receipt) return { ok: false, error: { code: "receipt_unavailable", message: "x402 receipt has not been created" } };
    if (receipt.state !== "authorization_submitted" && receipt.state !== "settlement_submitted" && receipt.state !== "unknown") {
      return { ok: false, error: { code: "conflict", message: `x402 receipt is ${receipt.state}; submit a valid authorization first` } };
    }
    if (!receipt.quoteSnapshot || !receipt.authorizationPayload || !receipt.authorizationPayloadHash || !receipt.authorizationHash || !receipt.approvedAmountUSDC) {
      return { ok: false, error: { code: "execution_not_ready", message: "x402 receipt is missing the exact execution evidence" } };
    }
    const plan = buildX402ExecutionPlan({
      snapshot: receipt.quoteSnapshot as X402QuoteSnapshot,
      authorization: receipt.authorizationPayload as X402AuthorizationPayload,
      authorizationPayloadHash: receipt.authorizationPayloadHash,
      authorizationHash: receipt.authorizationHash,
      approvedAmountUSDC: receipt.approvedAmountUSDC,
    });
    if (!plan.ok) return { ok: false, error: { code: "execution_not_ready", message: plan.error.message } };
    const approval = await this.repository.getLatestX402ExecutionApproval(intentId);
    if (!approval) return { ok: false, error: { code: "execution_not_ready", message: "explicit execution approval is required before settlement" } };
    const policy = this.options.x402ExecutionPolicy ?? createX402ExecutionPolicy({ enabled: false, maxAmountBaseUnits: 0n });
    const settled = await createX402SettlementOrchestrator({
      store: this.repository,
      adapter: this.options.x402SettlementAdapter,
      policy,
    }).settle({
      approval,
      plan: plan.value,
      signature: request.signature,
      confirmation: request.confirmation,
    } as X402SettlementInput);
    if (!settled.ok) {
      if (settled.error.code === "reconciliation_required") return { ok: false, error: { code: "conflict", message: settled.error.message } };
      if (settled.error.code === "settlement_unknown") return { ok: false, error: { code: "facilitator_unavailable", message: settled.error.message } };
      return { ok: false, error: { code: "execution_not_ready", message: settled.error.message } };
    }
    return {
      ok: true,
      value: {
        receiptId: settled.receipt.receiptId,
        intentId,
        state: "settlement_submitted",
        network: "eip155:5042002",
        transaction: settled.transaction,
        providerTransferId: settled.receipt.providerTransferId ?? null,
        payer: null,
        executionEnabled: true,
        serviceDeliveryPending: true,
        nextAction: "deliver_service",
        recordedAt: settled.receipt.updatedAt.toISOString(),
      },
    };
  }

  async verifyX402Facilitator(
    actor: string,
    intentId: string,
    request: X402FacilitatorVerificationRequest,
  ): Promise<Result<X402FacilitatorVerificationView, AgonServiceError>> {
    if (!this.options.x402FacilitatorVerifier) {
      return { ok: false, error: { code: "facilitator_unavailable", message: "Circle facilitator verification is disabled by policy" } };
    }
    const intent = await this.repository.getX402CallIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "x402 call intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the intent owner can verify this authorization" } };
    const receipt = await this.repository.getX402CallReceipt(intentId);
    if (!receipt) return { ok: false, error: { code: "receipt_unavailable", message: "x402 receipt has not been created" } };
    if (receipt.state !== "authorization_submitted" || !receipt.quoteSnapshot || !receipt.authorizationPayload || !receipt.authorizationPayloadHash || !receipt.authorizationHash || !receipt.approvedAmountUSDC) {
      return { ok: false, error: { code: "conflict", message: `x402 receipt is ${receipt.state}; submit a valid authorization first` } };
    }
    const plan = buildX402ExecutionPlan({
      snapshot: receipt.quoteSnapshot as X402QuoteSnapshot,
      authorization: receipt.authorizationPayload as X402AuthorizationPayload,
      authorizationPayloadHash: receipt.authorizationPayloadHash,
      authorizationHash: receipt.authorizationHash,
      approvedAmountUSDC: receipt.approvedAmountUSDC,
    });
    if (!plan.ok) return { ok: false, error: { code: "execution_not_ready", message: plan.error.message } };
    const approval = await this.repository.getLatestX402ExecutionApproval(intentId);
    if (!approval) return { ok: false, error: { code: "execution_not_ready", message: "explicit execution approval is required before facilitator verification" } };
    const recorded = await this.repository.getLatestX402FacilitatorVerification(intentId);
    if (recorded) {
      if (recorded.receiptId !== receipt.receiptId || recorded.approvalHash.toLowerCase() !== approval.approvalHash.toLowerCase()) {
        return { ok: false, error: { code: "conflict", message: "stored facilitator evidence does not match the current x402 receipt" } };
      }
      return { ok: true, value: facilitatorVerificationView(recorded) };
    }
    const result = await this.options.x402FacilitatorVerifier.verify({
      approval,
      plan: plan.value,
      signature: request.signature,
      confirmation: request.confirmation,
    } as X402FacilitatorVerificationInput);
    if (!result.ok) {
      const code = result.error.code === "facilitator_rejected" ? "facilitator_rejected" : result.error.code === "facilitator_unavailable" ? "facilitator_unavailable" : "execution_not_ready";
      return { ok: false, error: { code, message: result.error.message } };
    }
    const verifiedAt = new Date();
    const evidenceHash = keccak256(stringToHex(JSON.stringify({
      intentId,
      receiptId: receipt.receiptId,
      approvalHash: result.value.approvalHash,
      network: result.value.network,
      payer: result.value.payer,
      verifiedAt: verifiedAt.toISOString(),
    })));
    try {
      const stored = await this.repository.recordX402FacilitatorVerification({
        receiptId: receipt.receiptId,
        intentId,
        approvalHash: result.value.approvalHash,
        network: result.value.network,
        payer: result.value.payer,
        evidenceHash,
        verifiedAt,
      });
      return { ok: true, value: facilitatorVerificationView(stored) };
    } catch (error) {
      return internalError(error);
    }
  }

  async getX402FacilitatorVerification(
    actor: string,
    intentId: string,
  ): Promise<Result<X402FacilitatorVerificationView, AgonServiceError>> {
    const intent = await this.repository.getX402CallIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "x402 call intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the intent owner can read this verification" } };
    const evidence = await this.repository.getLatestX402FacilitatorVerification(intentId);
    if (!evidence) return { ok: false, error: { code: "receipt_unavailable", message: "no facilitator verification has been recorded" } };
    return { ok: true, value: facilitatorVerificationView(evidence) };
  }

  async getCapabilities(): Promise<AgonCapabilities> {
    const readiness = this.options.writer ? await this.options.writer.getReadiness() : null;
    const writesReady = readiness?.ready ?? false;
    return {
      identityReads: this.options.identityReads ?? false,
      profileWrites: writesReady,
      listingReads: true,
      listingWrites: writesReady,
      endpointQa: this.options.endpointQa ?? false,
      directX402: this.options.directX402 ?? false,
      escrow: false,
      writeReadiness: {
        checkedAt: readiness?.checkedAt ?? null,
        reasons: readiness?.reasons ?? ["adapter_unconfigured"],
      },
    };
  }
}
