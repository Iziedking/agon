import { z } from "zod";
import { randomUUID } from "node:crypto";
import { keccak256 } from "viem";
import type { Result } from "../core/result.ts";
import {
  PostgresAgonRepository,
  AgonStoreInvariantError,
  type ListingCursor,
  type StoredListing,
  type StoredVerificationEvidence,
} from "../store/repository.ts";
import { callIntentView, prepareX402Call } from "../execution/x402-intent.ts";
import { validateX402Approval } from "../execution/x402-approval.ts";
import { parsePaymentRequiredHeader, type X402QuoteSnapshot } from "../execution/x402-quote.ts";
import { buildX402Authorization, validateX402AuthorizationSignature, type X402AuthorizationPayload } from "../execution/x402-authorization.ts";
import { buildX402ExecutionPlan } from "../execution/x402-facilitator.ts";
import { buildX402ExecutionApproval, type X402ExecutionApprovalRequest } from "../execution/x402-execution-approval.ts";
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

function internalError(error: unknown): Result<never, AgonServiceError> {
  console.error("[agon] service error:", error instanceof Error ? error.message : "unknown failure");
  return { ok: false, error: { code: "internal", message: "Agon service request failed" } };
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

  constructor(repository: PostgresAgonRepository, options: PostgresAgonMarketServiceOptions = {}) {
    this.repository = repository;
    this.options = options;
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
