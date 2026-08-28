import { Hono, type Context, type MiddlewareHandler } from "hono";
import { randomUUID } from "node:crypto";
import { listPlaygroundCategories, runPlaygroundTask, PlaygroundError } from "../playground.ts";
import { PlaygroundProviderError, type PlaygroundProviderRunner } from "../playground-provider.ts";
import { PlaygroundRunConflictError, type PlaygroundRateLimiter, type PlaygroundRunStore } from "../playground-store.ts";
import { inspectManifest, ManifestInspectionError } from "../manifest-inspector.ts";
import { z, type ZodError } from "zod";
import type { Result } from "../core/result.ts";
import type {
  AgonCapabilities,
  AgonListingView,
  ApiErrorResponse,
  BindProfileRequest,
  ListingPage,
  ListingQuery,
  PublishListingRequest,
  PublishListingVersionRequest,
  SubmittedOperation,
  X402ApprovalRequest,
  X402ApprovalView,
  X402CallIntentRequest,
  X402CallIntentView,
  X402QuoteView,
  X402AuthorizationView,
  X402AuthorizationSignatureRequest,
  X402AuthorizationSubmittedView,
  X402ExecutionPlanView,
  X402ExecutionApprovalRequest,
  X402ExecutionApprovalView,
  X402ExecutionReadinessView,
  X402SettlementReadinessView,
  X402ReconciliationReadinessView,
  X402ReconciliationRequest,
  X402DeliveryEvidenceRequest,
  X402SettlementRequest,
  X402FacilitatorVerificationRequest,
  AgonEscrowIntentRequest,
  AgonEscrowIntentView,
  AgonEscrowReadinessView,
  AgonEscrowTransactionView,
  AgonEscrowTransactionApprovalRequest,
  AgonEscrowTransactionApprovalView,
  AgonEscrowTransactionApprovalReadinessView,
  AgonJobEscrowJobView,
  AgonJobEscrowIntentRequest,
  AgonJobEscrowIntentView,
  AgonJobEscrowTransactionView,
  AgonJobEscrowReconcileRequest,
  AgonJobEscrowSubmittedRequest,
  AgonArenaEvaluationRequest,
  AgonArenaEvaluationView,
  AgonArenaTransactionView,
  AgonArenaEvaluationSubmittedRequest,
  AgonArenaEvaluationStartedRequest,
  AgonArenaEvidenceSubmittedRequest,
  AgonSyndicateContributionRequest,
  AgonSyndicateContributionView,
  AgonPrizeClaimRequest,
  AgonPrizeClaimView,
  AgonSyndicatePrizeTransactionView,
  AgonSyndicatePrizeSubmittedRequest,
} from "./api-types.ts";

export type AgonRouteVariables = { address: string };

export type AgonServiceError = {
  code:
    | "not_found"
    | "not_owner"
    | "conflict"
    | "validation_failed"
    | "capability_unavailable"
    | "receipt_unavailable"
    | "receipt_invalid"
    | "signature_invalid"
    | "execution_not_ready"
    | "facilitator_rejected"
    | "facilitator_unavailable"
    | "reconciliation_disabled"
    | "reconciliation_unavailable"
    | "reconciliation_invalid"
    | "escrow_disabled"
    | "arena_disabled"
    | "arena_reconciliation_required"
    | "syndicate_prize_disabled"
    | "internal";
  message: string;
};

export type AgonMarketService = {
  listListings(query: ListingQuery): Promise<Result<ListingPage, AgonServiceError>>;
  getListing(reference: string): Promise<Result<AgonListingView, AgonServiceError>>;
  bindProfile(
    actor: string,
    request: BindProfileRequest,
  ): Promise<Result<SubmittedOperation, AgonServiceError>>;
  publishListing(
    actor: string,
    request: PublishListingRequest,
  ): Promise<Result<SubmittedOperation, AgonServiceError>>;
  publishListingVersion(
    actor: string,
    request: PublishListingVersionRequest,
  ): Promise<Result<SubmittedOperation, AgonServiceError>>;
  confirmOperation(
    actor: string,
    operationId: string,
    txHash: `0x${string}`,
  ): Promise<Result<SubmittedOperation, AgonServiceError>>;
  prepareX402Call(
    actor: string,
    reference: string,
    request: X402CallIntentRequest,
  ): Promise<Result<X402CallIntentView, AgonServiceError>>;
  approveX402Call(
    actor: string,
    intentId: string,
    request: X402ApprovalRequest,
  ): Promise<Result<X402ApprovalView, AgonServiceError>>;
  captureX402Quote(
    actor: string,
    intentId: string,
  ): Promise<Result<X402QuoteView, AgonServiceError>>;
  prepareX402Authorization(
    actor: string,
    intentId: string,
  ): Promise<Result<X402AuthorizationView, AgonServiceError>>;
  submitX402Authorization(
    actor: string,
    intentId: string,
    request: X402AuthorizationSignatureRequest,
  ): Promise<Result<X402AuthorizationSubmittedView, AgonServiceError>>;
  prepareX402ExecutionPlan(
    actor: string,
    intentId: string,
  ): Promise<Result<X402ExecutionPlanView, AgonServiceError>>;
  approveX402Execution(
    actor: string,
    intentId: string,
    request: X402ExecutionApprovalRequest,
  ): Promise<Result<X402ExecutionApprovalView, AgonServiceError>>;
  getX402ExecutionReadiness(
    actor: string,
    intentId: string,
  ): Promise<Result<X402ExecutionReadinessView, AgonServiceError>>;
  getX402SettlementReadiness(
    actor: string,
    intentId: string,
  ): Promise<Result<X402SettlementReadinessView, AgonServiceError>>;
  getX402ReconciliationReadiness(
    actor: string,
    intentId: string,
  ): Promise<Result<X402ReconciliationReadinessView, AgonServiceError>>;
  reconcileX402Receipt(
    actor: string,
    intentId: string,
    request: X402ReconciliationRequest,
  ): Promise<Result<import("./api-types.ts").X402ReconciliationView, AgonServiceError>>;
  recordX402Delivery?(
    actor: string,
    intentId: string,
    request: X402DeliveryEvidenceRequest,
  ): Promise<Result<import("./api-types.ts").X402DeliveryEvidenceView, AgonServiceError>>;
  settleX402Call(
    actor: string,
    intentId: string,
    request: X402SettlementRequest,
  ): Promise<Result<import("./api-types.ts").X402SettlementView, AgonServiceError>>;
  verifyX402Facilitator(
    actor: string,
    intentId: string,
    request: X402FacilitatorVerificationRequest,
  ): Promise<Result<import("./api-types.ts").X402FacilitatorVerificationView, AgonServiceError>>;
  getX402FacilitatorVerification(
    actor: string,
    intentId: string,
  ): Promise<Result<import("./api-types.ts").X402FacilitatorVerificationView, AgonServiceError>>;
  prepareAgonEscrowIntent(
    actor: string,
    request: AgonEscrowIntentRequest,
  ): Promise<Result<AgonEscrowIntentView, AgonServiceError>>;
  getAgonEscrowIntent(
    actor: string,
    intentId: string,
  ): Promise<Result<AgonEscrowIntentView, AgonServiceError>>;
  getAgonEscrowReadiness(
    actor: string,
    intentId: string,
  ): Promise<Result<AgonEscrowReadinessView, AgonServiceError>>;
  getAgonEscrowTransaction(
    actor: string,
    intentId: string,
    operation: "fund",
  ): Promise<Result<AgonEscrowTransactionView, AgonServiceError>>;
  getAgonJobEscrowJob?(
    actor: string,
    jobId: string,
  ): Promise<Result<AgonJobEscrowJobView, AgonServiceError>>;
  prepareAgonJobEscrowIntent?(
    actor: string,
    request: AgonJobEscrowIntentRequest,
  ): Promise<Result<AgonJobEscrowIntentView, AgonServiceError>>;
  getAgonJobEscrowIntent?(
    actor: string,
    intentId: string,
  ): Promise<Result<AgonJobEscrowIntentView, AgonServiceError>>;
  getAgonJobEscrowTransaction?(
    actor: string,
    intentId: string,
  ): Promise<Result<AgonJobEscrowTransactionView, AgonServiceError>>;
  reconcileAgonJobEscrowIntent?(
    actor: string,
    intentId: string,
    request: AgonJobEscrowReconcileRequest,
  ): Promise<Result<AgonJobEscrowIntentView, AgonServiceError>>;
  markAgonJobEscrowSubmitted?(
    actor: string,
    intentId: string,
    request: AgonJobEscrowSubmittedRequest,
  ): Promise<Result<AgonJobEscrowIntentView, AgonServiceError>>;
  prepareAgonArenaEvaluation?(
    actor: string,
    request: AgonArenaEvaluationRequest,
  ): Promise<Result<AgonArenaEvaluationView, AgonServiceError>>;
  getAgonArenaEvaluation?(
    actor: string,
    intentId: string,
  ): Promise<Result<AgonArenaEvaluationView, AgonServiceError>>;
  getAgonArenaRequestTransaction?(
    actor: string,
    intentId: string,
  ): Promise<Result<AgonArenaTransactionView, AgonServiceError>>;
  markAgonArenaEvaluationSubmitted?(
    actor: string,
    intentId: string,
    request: AgonArenaEvaluationSubmittedRequest,
  ): Promise<Result<AgonArenaEvaluationView, AgonServiceError>>;
  markAgonArenaEvaluationStarted?(
    actor: string,
    intentId: string,
    request: AgonArenaEvaluationStartedRequest,
  ): Promise<Result<AgonArenaEvaluationView, AgonServiceError>>;
  getAgonArenaEvidenceTransaction?(
    actor: string,
    intentId: string,
  ): Promise<Result<AgonArenaTransactionView, AgonServiceError>>;
  markAgonArenaEvidenceSubmitted?(
    actor: string,
    intentId: string,
    request: AgonArenaEvidenceSubmittedRequest,
  ): Promise<Result<AgonArenaEvaluationView, AgonServiceError>>;
  reconcileAgonArenaEvaluation?(
    actor: string,
    intentId: string,
  ): Promise<Result<AgonArenaEvaluationView, AgonServiceError>>;
  prepareAgonSyndicateContribution?(
    actor: string,
    request: AgonSyndicateContributionRequest,
  ): Promise<Result<AgonSyndicateContributionView, AgonServiceError>>;
  getAgonSyndicateContribution?(
    actor: string,
    intentId: string,
  ): Promise<Result<AgonSyndicateContributionView, AgonServiceError>>;
  getAgonSyndicateContributionTransaction?(
    actor: string,
    intentId: string,
  ): Promise<Result<AgonSyndicatePrizeTransactionView, AgonServiceError>>;
  markAgonSyndicateContributionSubmitted?(
    actor: string,
    intentId: string,
    request: AgonSyndicatePrizeSubmittedRequest,
  ): Promise<Result<AgonSyndicateContributionView, AgonServiceError>>;
  reconcileAgonSyndicateContribution?(
    actor: string,
    intentId: string,
  ): Promise<Result<AgonSyndicateContributionView, AgonServiceError>>;
  prepareAgonPrizeClaim?(
    actor: string,
    request: AgonPrizeClaimRequest,
  ): Promise<Result<AgonPrizeClaimView, AgonServiceError>>;
  getAgonPrizeClaim?(
    actor: string,
    intentId: string,
  ): Promise<Result<AgonPrizeClaimView, AgonServiceError>>;
  getAgonPrizeClaimTransaction?(
    actor: string,
    intentId: string,
  ): Promise<Result<AgonSyndicatePrizeTransactionView, AgonServiceError>>;
  markAgonPrizeClaimSubmitted?(
    actor: string,
    intentId: string,
    request: AgonSyndicatePrizeSubmittedRequest,
  ): Promise<Result<AgonPrizeClaimView, AgonServiceError>>;
  reconcileAgonPrizeClaim?(
    actor: string,
    intentId: string,
  ): Promise<Result<AgonPrizeClaimView, AgonServiceError>>;
  fundAgonEscrow?(
    actor: string,
    intentId: string,
    confirmation: string,
  ): Promise<Result<AgonEscrowIntentView, AgonServiceError>>;
  releaseAgonEscrow?(
    actor: string,
    intentId: string,
    confirmation: string,
  ): Promise<Result<AgonEscrowIntentView, AgonServiceError>>;
  refundAgonEscrow?(
    actor: string,
    intentId: string,
    confirmation: string,
  ): Promise<Result<AgonEscrowIntentView, AgonServiceError>>;
  approveAgonEscrowTransaction?(
    actor: string,
    intentId: string,
    request: AgonEscrowTransactionApprovalRequest,
  ): Promise<Result<AgonEscrowTransactionApprovalView, AgonServiceError>>;
  getAgonEscrowTransactionApproval?(
    actor: string,
    intentId: string,
  ): Promise<Result<AgonEscrowTransactionApprovalReadinessView, AgonServiceError>>;
  getCapabilities(): Promise<AgonCapabilities>;
};

export type CreateAgonRoutesOptions = {
  service: AgonMarketService;
  requireAuth: MiddlewareHandler<{ Variables: AgonRouteVariables }>;
  requireListingWriteAuth?: MiddlewareHandler<{ Variables: AgonRouteVariables }>;
  requireListingConfirmAuth?: MiddlewareHandler<{ Variables: AgonRouteVariables }>;
  requirePlaygroundAuth?: MiddlewareHandler<{ Variables: AgonRouteVariables }>;
  requireArenaAuth?: MiddlewareHandler<{ Variables: AgonRouteVariables }>;
  requirePrincipal?: MiddlewareHandler<{ Variables: AgonRouteVariables }>;
  playgroundStore?: PlaygroundRunStore;
  playgroundRateLimiter?: PlaygroundRateLimiter;
  playgroundProviderRunner?: PlaygroundProviderRunner;
};

const positiveDecimal = z.string().regex(/^[1-9]\d*$/, "must be a positive decimal string");
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a bytes32 hex string");

const listingQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(2048).nullable().default(null),
  category: positiveDecimal.nullable().default(null),
  agentId: positiveDecimal.nullable().default(null),
  includeManifest: z.boolean().default(false),
});

const bindProfileSchema = z.object({
  chainId: positiveDecimal,
  agentId: positiveDecimal,
  metadataUri: z.string().min(1).max(2048),
});

const publishListingSchema = z.object({
  chainId: positiveDecimal,
  agentId: positiveDecimal,
  serviceKey: bytes32,
  manifestHash: bytes32,
  manifestUri: z.string().min(1).max(2048),
  category: positiveDecimal,
  paymentRail: z.enum(["X402", "Escrow"]),
});

const publishListingVersionSchema = z.object({
  chainId: positiveDecimal,
  listingId: positiveDecimal,
  manifestHash: bytes32,
  manifestUri: z.string().min(1).max(2048),
  paymentRail: z.enum(["X402", "Escrow"]),
});

const confirmOperationSchema = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a transaction hash"),
});

const x402CallIntentSchema = z.object({
  idempotencyKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/, "must be 8-128 safe characters"),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  input: z.unknown().default(null),
  maxAmountUSDC: z.string().regex(/^(0|[1-9]\d*)(\.\d{1,6})?$/, "must be a USDC amount with up to 6 decimals"),
  endpointUrl: z.string().url().max(2048).optional(),
}).strict();

const x402ApprovalSchema = z.object({
  approvedAmountUSDC: z.string().regex(/^(0|[1-9]\d*)(\.\d{1,6})?$/, "must be a USDC amount with up to 6 decimals"),
}).strict();

const x402AuthorizationSignatureSchema = z.object({
  payloadHash: bytes32,
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/, "must be a 65-byte ECDSA signature"),
}).strict();

const x402ExecutionApprovalSchema = z.object({
  planHash: bytes32,
  approvalIdempotencyKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/, "must be 8-128 safe characters"),
  confirmation: z.literal("APPROVE_ARC_TESTNET_X402"),
}).strict();

const x402FacilitatorVerificationSchema = z.object({
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/, "must be a 65-byte ECDSA signature"),
  confirmation: z.literal("VERIFY_ARC_TESTNET_X402"),
}).strict();

const x402ReconciliationSchema = z.object({
  confirmation: z.literal("RECONCILE_ARC_TESTNET_X402"),
}).strict();

const x402DeliveryEvidenceSchema = z.object({
  deliveryId: z.string().uuid(),
  serviceStatus: z.number().int().min(200).max(299),
  latencyMs: z.number().int().min(0).max(900000),
  responseHash: bytes32,
  resultAttestationHash: bytes32.nullable().optional(),
  chargedAmountUSDC: z.string().regex(/^(0|[1-9]\d*)(\.\d{1,6})?$/, "must be a USDC amount with up to 6 decimals").nullable().optional(),
  deliveredAt: z.string().datetime({ offset: true }),
}).strict();

const x402SettlementSchema = z.object({
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/, "must be a 65-byte ECDSA signature"),
  confirmation: z.literal("EXECUTE_ARC_TESTNET_X402"),
}).strict();

const agonEscrowIntentSchema = z.object({
  listingReference: z.string().regex(/^[1-9]\d*:0x[0-9a-fA-F]{40}:[1-9]\d*$/, "must be a chain:registry:listing reference"),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/, "must be 8-128 safe characters"),
  amountBaseUnits: z.string().regex(/^[1-9]\d*$/, "must be a positive integer base-unit amount"),
  feeBps: z.number().int().min(0).max(1000),
  expiresAt: z.string().datetime({ offset: true }),
  poolBinding: z.object({
    controller: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be an address"),
    poolId: z.string().regex(/^\d+$/, "must be a non-negative integer"),
  }).strict().optional(),
}).strict();

const fundAgonEscrowSchema = z.object({ confirmation: z.literal("FUND_ARC_TESTNET_ESCROW") }).strict();
const releaseAgonEscrowSchema = z.object({ confirmation: z.literal("RELEASE_ARC_TESTNET_ESCROW") }).strict();
const refundAgonEscrowSchema = z.object({ confirmation: z.literal("REFUND_ARC_TESTNET_ESCROW") }).strict();
const agonEscrowTransactionApprovalSchema = z.object({
  operation: z.enum(["fund", "release", "refund"]),
  approvalIdempotencyKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/, "must be 8-128 safe characters"),
  confirmation: z.string().min(1).max(64),
}).strict();

const agonJobEscrowIntentSchema = z.object({
  listingReference: z.string().regex(/^[1-9]\d*:0x[0-9a-fA-F]{40}:[1-9]\d*$/, "must be a chain:registry:listing reference"),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/, "must be 8-128 safe characters"),
  amountBaseUnits: z.string().regex(/^[1-9]\d*$/, "must be a positive integer base-unit amount"),
  feeBps: z.number().int().min(0).max(1000),
  reviewHours: z.number().int().min(1).max(720),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

const agonJobEscrowReconcileSchema = z.object({ jobId: positiveDecimal }).strict();
const agonJobEscrowSubmittedSchema = z.object({ transactionHash: bytes32 }).strict();
const agonArenaEvaluationSchema = z.object({
  listingReference: z.string().regex(/^[1-9]\d*:0x[0-9a-fA-F]{40}:[1-9]\d*$/, "must be a chain:registry:listing reference"),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/, "must be 8-128 safe characters"),
  playgroundRunId: z.string().uuid(),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();
const agonArenaEvaluationSubmittedSchema = z.object({ evaluationId: positiveDecimal, transactionHash: bytes32 }).strict();
const agonArenaEvaluationStartedSchema = z.object({ transactionHash: bytes32 }).strict();
const agonArenaEvidenceSubmittedSchema = z.object({ transactionHash: bytes32 }).strict();
const nonNegativeDecimal = z.string().regex(/^\d+$/, "must be a non-negative decimal string");
const agonSyndicateContributionSchema = z.object({
  idempotencyKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/),
  syndicateId: positiveDecimal,
  agentId: positiveDecimal,
  contributionKey: bytes32,
  score: positiveDecimal,
  evidenceHash: bytes32,
}).strict();
const agonPrizeClaimSchema = z.object({
  idempotencyKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/),
  poolKey: bytes32,
  index: nonNegativeDecimal,
  beneficiary: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  amount: positiveDecimal,
  proof: z.array(bytes32).max(256),
}).strict();
const agonSyndicatePrizeSubmittedSchema = z.object({ transactionHash: bytes32 }).strict();

const playgroundCategorySchema = z.enum(["development", "research", "analysis", "verification", "execution"]);
const playgroundCategoryId = {
  research: "1",
  analysis: "3",
  execution: "5",
  development: "7",
  verification: "8",
} as const;
const playgroundTaskSchema = z.object({
  category: playgroundCategorySchema,
  taskId: z.string().regex(/^[a-z0-9-]{1,64}$/),
  input: z.unknown().optional(),
}).strict();
const playgroundEvaluationSchema = playgroundTaskSchema.extend({
  listingReference: z.string().regex(/^[1-9]\d*:0x[0-9a-fA-F]{40}:[1-9]\d*$/),
  listingVersion: positiveDecimal,
  idempotencyKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/),
}).strict();

function validationResponse(error: ZodError): ApiErrorResponse {
  return {
    error: {
      code: "invalid_request",
      message: "request validation failed",
      issues: error.issues.map((issue) => ({
        path: issue.path.map(String),
        code: issue.code,
        message: issue.message,
      })),
    },
  };
}

function serviceErrorResponse(
  context: Context<{ Variables: AgonRouteVariables }>,
  error: AgonServiceError,
) {
  const body: ApiErrorResponse = { error: { code: error.code, message: error.message } };
  switch (error.code) {
    case "not_found":
      return context.json(body, 404);
    case "not_owner":
      return context.json(body, 403);
    case "conflict":
      return context.json(body, 409);
    case "validation_failed":
      return context.json(body, 422);
    case "capability_unavailable":
      return context.json(body, 503);
    case "facilitator_unavailable":
      return context.json(body, 503);
    case "facilitator_rejected":
      return context.json(body, 422);
    case "reconciliation_disabled":
      return context.json(body, 503);
    case "reconciliation_unavailable":
      return context.json(body, 503);
    case "reconciliation_invalid":
      return context.json(body, 422);
    case "receipt_unavailable":
      return context.json(body, 409);
    case "receipt_invalid":
      return context.json(body, 422);
    case "signature_invalid":
      return context.json(body, 422);
    case "execution_not_ready":
      return context.json(body, 409);
    case "escrow_disabled":
      return context.json(body, 503);
    case "arena_disabled":
      return context.json(body, 503);
    case "arena_reconciliation_required":
      return context.json(body, 409);
    case "syndicate_prize_disabled":
      return context.json(body, 503);
    case "internal":
      return context.json(body, 500);
  }
}

async function parseJson(context: Context): Promise<unknown | ApiErrorResponse> {
  try {
    return await context.req.json();
  } catch {
    return { error: { code: "invalid_json", message: "request body must be valid JSON" } };
  }
}

async function parseBoundedJson(context: Context, maxBytes: number): Promise<unknown | ApiErrorResponse> {
  const contentLength = Number(context.req.header("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return { error: { code: "payload_too_large", message: "request payload exceeds the evaluation limit" } };
  }
  try {
    const body = await context.req.text();
    if (new TextEncoder().encode(body).byteLength > maxBytes) {
      return { error: { code: "payload_too_large", message: "request payload exceeds the evaluation limit" } };
    }
    return JSON.parse(body) as unknown;
  } catch {
    return { error: { code: "invalid_json", message: "request body must be valid JSON" } };
  }
}

function isApiError(value: unknown): value is ApiErrorResponse {
  return Boolean(
    value &&
      typeof value === "object" &&
      "error" in value &&
      typeof (value as ApiErrorResponse).error?.code === "string",
  );
}

function queryFromRequest(context: Context, overrides: Partial<ListingQuery> = {}) {
  return listingQuerySchema.safeParse({
    limit: context.req.query("limit") ?? 20,
    cursor: context.req.query("cursor") ?? null,
    category: overrides.category ?? context.req.query("category") ?? null,
    agentId: overrides.agentId ?? context.req.query("agentId") ?? null,
    includeManifest: overrides.includeManifest ?? ["1", "true"].includes(context.req.query("includeManifest") ?? ""),
  });
}

export function createAgonRoutes(options: CreateAgonRoutesOptions) {
  const app = new Hono<{ Variables: AgonRouteVariables }>();
  const requirePrincipal = options.requirePrincipal ?? (async (_context, next) => { await next(); });

  async function consumePlaygroundLimit(context: Context<{ Variables: AgonRouteVariables }>, scope: "sample" | "evaluation") {
    if (!options.playgroundRateLimiter) return true;
    const actor = context.get("address");
    const forwarded = context.req.header("x-real-ip") ?? context.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const key = actor ? `${scope}:actor:${actor}` : `${scope}:ip:${forwarded}`;
    const result = await options.playgroundRateLimiter.consume(key, scope === "evaluation" ? 10 : 30, 60);
    if (!result.allowed) {
      context.header("retry-after", String(result.retryAfterSeconds));
      return false;
    }
    return true;
  }

  app.get("/playground/categories", (context) => context.json({
    agent: "agon-coder-v1",
    categories: listPlaygroundCategories(),
    providerScopes: options.playgroundProviderRunner?.scopes() ?? [],
  }));

  app.post("/playground/run", async (context) => {
    if (!(await consumePlaygroundLimit(context, "sample"))) {
      return context.json({ error: { code: "rate_limited", message: "playground sample capacity is temporarily exhausted" } }, 429);
    }
    const body = await parseBoundedJson(context, 32 * 1024);
    if (isApiError(body)) return context.json(body, 400);
    const parsed = playgroundTaskSchema.safeParse(body);
    if (!parsed.success) return context.json(validationResponse(parsed.error), 400);
    try {
      const result = await runPlaygroundTask(parsed.data, {
        requestId: context.req.header("x-request-id") && /^[0-9a-f-]{36}$/i.test(context.req.header("x-request-id")!) ? context.req.header("x-request-id")! : randomUUID(),
        store: options.playgroundStore,
      });
      return context.json(result, result.replayed ? 200 : 201);
    } catch (cause) {
      if (cause instanceof PlaygroundRunConflictError) return context.json({ error: { code: "idempotency_conflict", message: cause.message } }, 409);
      if (cause instanceof PlaygroundError) return context.json({ error: { code: cause.code, message: cause.message } }, 400);
      return context.json({ error: { code: "playground_failed", message: "The agent task did not complete." } }, 500);
    }
  });

  app.post("/playground/evaluate", options.requirePlaygroundAuth ?? options.requireAuth, async (context) => {
    if (!(await consumePlaygroundLimit(context, "evaluation"))) {
      return context.json({ error: { code: "rate_limited", message: "evaluation capacity is temporarily exhausted" } }, 429);
    }
    const body = await parseBoundedJson(context, 32 * 1024);
    if (isApiError(body)) return context.json(body, 400);
    const parsed = playgroundEvaluationSchema.safeParse(body);
    if (!parsed.success) return context.json(validationResponse(parsed.error), 400);
    const listing = await options.service.getListing(parsed.data.listingReference);
    if (!listing.ok) return serviceErrorResponse(context, listing.error);
    if (listing.value.version !== parsed.data.listingVersion) {
      return context.json({ error: { code: "validation_failed", message: "evaluation scope does not match the current listing version" } }, 422);
    }
    if (listing.value.category !== playgroundCategoryId[parsed.data.category]) {
      return context.json({ error: { code: "validation_failed", message: "the selected challenge category does not match this listing" } }, 422);
    }
    const provider = {
      agentId: listing.value.agentId,
      serviceKey: listing.value.serviceKey,
      listingReference: parsed.data.listingReference,
      listingVersion: parsed.data.listingVersion,
    };
    if (!options.playgroundProviderRunner?.supports(provider)) {
      return context.json({ error: { code: "provider_not_enabled", message: "This listing does not yet have an approved live Playground endpoint." } }, 409);
    }
    try {
      const result = await runPlaygroundTask(
        { category: parsed.data.category, taskId: parsed.data.taskId, input: parsed.data.input },
        {
          actorAddress: context.get("address"),
          requestId: context.req.header("x-request-id") && /^[0-9a-f-]{36}$/i.test(context.req.header("x-request-id")!) ? context.req.header("x-request-id")! : randomUUID(),
          idempotencyKey: parsed.data.idempotencyKey,
          scope: { listingReference: parsed.data.listingReference, listingVersion: parsed.data.listingVersion },
          store: options.playgroundStore,
          execute: (task, input) => options.playgroundProviderRunner!.run({
            provider,
            task,
            taskInput: input,
          }),
        },
      );
      return context.json(result, result.replayed ? 200 : 201);
    } catch (cause) {
      if (cause instanceof PlaygroundRunConflictError) return context.json({ error: { code: "idempotency_conflict", message: cause.message } }, 409);
      if (cause instanceof PlaygroundError) {
        const status = cause.code === "run_in_progress" || cause.code === "run_failed" ? 409 : 400;
        return context.json({ error: { code: cause.code, message: cause.message } }, status);
      }
      if (cause instanceof PlaygroundProviderError) {
        const status = cause.code === "provider_not_enabled" || cause.code === "provider_task_unsupported" ? 409 : 502;
        return context.json({ error: { code: cause.code, message: cause.message } }, status);
      }
      return context.json({ error: { code: "playground_failed", message: "The evaluation did not complete." } }, 500);
    }
  });

  app.post("/arena/evaluations", options.requireArenaAuth ?? options.requireAuth, async (context) => {
    const body = await parseJson(context);
    if (isApiError(body)) return context.json(body, 400);
    const parsed = agonArenaEvaluationSchema.safeParse(body);
    if (!parsed.success) return context.json(validationResponse(parsed.error), 400);
    if (!options.service.prepareAgonArenaEvaluation) return serviceErrorResponse(context, { code: "arena_disabled", message: "Agon Arena evaluation preparation is not configured" });
    const result = await options.service.prepareAgonArenaEvaluation(context.get("address"), parsed.data);
    return result.ok ? context.json(result.value, 201) : serviceErrorResponse(context, result.error);
  });

  app.get("/arena/evaluations/:intentId", options.requireAuth, async (context) => {
    if (!options.service.getAgonArenaEvaluation) return serviceErrorResponse(context, { code: "arena_disabled", message: "Agon Arena evaluation reads are not configured" });
    const result = await options.service.getAgonArenaEvaluation(context.get("address"), context.req.param("intentId"));
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.get("/arena/evaluations/:intentId/request-transaction", options.requireAuth, async (context) => {
    if (!options.service.getAgonArenaRequestTransaction) return serviceErrorResponse(context, { code: "arena_disabled", message: "Agon Arena request planning is not configured" });
    const result = await options.service.getAgonArenaRequestTransaction(context.get("address"), context.req.param("intentId"));
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.post("/arena/evaluations/:intentId/requested", options.requireAuth, async (context) => {
    const body = await parseJson(context);
    if (isApiError(body)) return context.json(body, 400);
    const parsed = agonArenaEvaluationSubmittedSchema.safeParse(body);
    if (!parsed.success) return context.json(validationResponse(parsed.error), 400);
    if (!options.service.markAgonArenaEvaluationSubmitted) return serviceErrorResponse(context, { code: "arena_disabled", message: "Agon Arena request tracking is not configured" });
    const result = await options.service.markAgonArenaEvaluationSubmitted(context.get("address"), context.req.param("intentId"), parsed.data);
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.post("/arena/evaluations/:intentId/started", options.requireAuth, async (context) => {
    const body = await parseJson(context);
    if (isApiError(body)) return context.json(body, 400);
    const parsed = agonArenaEvaluationStartedSchema.safeParse(body);
    if (!parsed.success) return context.json(validationResponse(parsed.error), 400);
    if (!options.service.markAgonArenaEvaluationStarted) return serviceErrorResponse(context, { code: "arena_disabled", message: "Agon Arena start tracking is not configured" });
    const result = await options.service.markAgonArenaEvaluationStarted(context.get("address"), context.req.param("intentId"), parsed.data);
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.get("/arena/evaluations/:intentId/evidence-transaction", options.requireAuth, async (context) => {
    if (!options.service.getAgonArenaEvidenceTransaction) return serviceErrorResponse(context, { code: "arena_disabled", message: "Agon Arena evidence planning is not configured" });
    const result = await options.service.getAgonArenaEvidenceTransaction(context.get("address"), context.req.param("intentId"));
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.post("/arena/evaluations/:intentId/evidence-submitted", options.requireAuth, async (context) => {
    const body = await parseJson(context);
    if (isApiError(body)) return context.json(body, 400);
    const parsed = agonArenaEvidenceSubmittedSchema.safeParse(body);
    if (!parsed.success) return context.json(validationResponse(parsed.error), 400);
    if (!options.service.markAgonArenaEvidenceSubmitted) return serviceErrorResponse(context, { code: "arena_disabled", message: "Agon Arena evidence tracking is not configured" });
    const result = await options.service.markAgonArenaEvidenceSubmitted(context.get("address"), context.req.param("intentId"), parsed.data);
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.post("/arena/evaluations/:intentId/reconcile", options.requireAuth, async (context) => {
    if (!options.service.reconcileAgonArenaEvaluation) return serviceErrorResponse(context, { code: "arena_disabled", message: "Agon Arena finality reconciliation is not configured" });
    const result = await options.service.reconcileAgonArenaEvaluation(context.get("address"), context.req.param("intentId"));
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.post("/syndicates/contributions", options.requireAuth, async (context) => {
    const body = await parseJson(context);
    if (isApiError(body)) return context.json(body, 400);
    const parsed = agonSyndicateContributionSchema.safeParse(body);
    if (!parsed.success) return context.json(validationResponse(parsed.error), 400);
    if (!options.service.prepareAgonSyndicateContribution) return serviceErrorResponse(context, { code: "syndicate_prize_disabled", message: "syndicate contribution intents are not configured" });
    const result = await options.service.prepareAgonSyndicateContribution(context.get("address"), parsed.data);
    return result.ok ? context.json(result.value, 201) : serviceErrorResponse(context, result.error);
  });

  app.get("/syndicates/contributions/:intentId", options.requireAuth, async (context) => {
    if (!options.service.getAgonSyndicateContribution) return serviceErrorResponse(context, { code: "syndicate_prize_disabled", message: "syndicate contribution reads are not configured" });
    const result = await options.service.getAgonSyndicateContribution(context.get("address"), context.req.param("intentId"));
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.get("/syndicates/contributions/:intentId/transaction", options.requireAuth, async (context) => {
    if (!options.service.getAgonSyndicateContributionTransaction) return serviceErrorResponse(context, { code: "syndicate_prize_disabled", message: "syndicate contribution transaction planning is not configured" });
    const result = await options.service.getAgonSyndicateContributionTransaction(context.get("address"), context.req.param("intentId"));
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.post("/syndicates/contributions/:intentId/submitted", options.requireAuth, async (context) => {
    const body = await parseJson(context);
    if (isApiError(body)) return context.json(body, 400);
    const parsed = agonSyndicatePrizeSubmittedSchema.safeParse(body);
    if (!parsed.success) return context.json(validationResponse(parsed.error), 400);
    if (!options.service.markAgonSyndicateContributionSubmitted) return serviceErrorResponse(context, { code: "syndicate_prize_disabled", message: "syndicate contribution tracking is not configured" });
    const result = await options.service.markAgonSyndicateContributionSubmitted(context.get("address"), context.req.param("intentId"), parsed.data);
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.post("/syndicates/contributions/:intentId/reconcile", options.requireAuth, async (context) => {
    if (!options.service.reconcileAgonSyndicateContribution) return serviceErrorResponse(context, { code: "syndicate_prize_disabled", message: "syndicate contribution reconciliation is not configured" });
    const result = await options.service.reconcileAgonSyndicateContribution(context.get("address"), context.req.param("intentId"));
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.post("/prize-claims", options.requireAuth, async (context) => {
    const body = await parseJson(context);
    if (isApiError(body)) return context.json(body, 400);
    const parsed = agonPrizeClaimSchema.safeParse(body);
    if (!parsed.success) return context.json(validationResponse(parsed.error), 400);
    if (!options.service.prepareAgonPrizeClaim) return serviceErrorResponse(context, { code: "syndicate_prize_disabled", message: "prize claim intents are not configured" });
    const result = await options.service.prepareAgonPrizeClaim(context.get("address"), parsed.data);
    return result.ok ? context.json(result.value, 201) : serviceErrorResponse(context, result.error);
  });

  app.get("/prize-claims/:intentId", options.requireAuth, async (context) => {
    if (!options.service.getAgonPrizeClaim) return serviceErrorResponse(context, { code: "syndicate_prize_disabled", message: "prize claim reads are not configured" });
    const result = await options.service.getAgonPrizeClaim(context.get("address"), context.req.param("intentId"));
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.get("/prize-claims/:intentId/transaction", options.requireAuth, async (context) => {
    if (!options.service.getAgonPrizeClaimTransaction) return serviceErrorResponse(context, { code: "syndicate_prize_disabled", message: "prize claim transaction planning is not configured" });
    const result = await options.service.getAgonPrizeClaimTransaction(context.get("address"), context.req.param("intentId"));
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.post("/prize-claims/:intentId/submitted", options.requireAuth, async (context) => {
    const body = await parseJson(context);
    if (isApiError(body)) return context.json(body, 400);
    const parsed = agonSyndicatePrizeSubmittedSchema.safeParse(body);
    if (!parsed.success) return context.json(validationResponse(parsed.error), 400);
    if (!options.service.markAgonPrizeClaimSubmitted) return serviceErrorResponse(context, { code: "syndicate_prize_disabled", message: "prize claim tracking is not configured" });
    const result = await options.service.markAgonPrizeClaimSubmitted(context.get("address"), context.req.param("intentId"), parsed.data);
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.post("/prize-claims/:intentId/reconcile", options.requireAuth, async (context) => {
    if (!options.service.reconcileAgonPrizeClaim) return serviceErrorResponse(context, { code: "syndicate_prize_disabled", message: "prize claim reconciliation is not configured" });
    const result = await options.service.reconcileAgonPrizeClaim(context.get("address"), context.req.param("intentId"));
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.get("/health", async (context) =>
    context.json({ ok: true, service: "agon", capabilities: await options.service.getCapabilities() }),
  );

  app.get("/job-escrow/jobs/:jobId", options.requireAuth, async (context) => {
    const jobId = context.req.param("jobId");
    if (!positiveDecimal.safeParse(jobId).success) return serviceErrorResponse(context, { code: "validation_failed", message: "job id must be a positive decimal string" });
    if (!options.service.getAgonJobEscrowJob) return serviceErrorResponse(context, { code: "capability_unavailable", message: "AgonJobEscrow read inspection is not configured" });
    const result = await options.service.getAgonJobEscrowJob(context.get("address"), jobId);
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.post("/job-escrow/intents", options.requireAuth, async (context) => {
    const body = await parseJson(context);
    if (isApiError(body)) return context.json(body, 400);
    const parsed = agonJobEscrowIntentSchema.safeParse(body);
    if (!parsed.success) return context.json(validationResponse(parsed.error), 400);
    if (!options.service.prepareAgonJobEscrowIntent) return serviceErrorResponse(context, { code: "capability_unavailable", message: "AgonJobEscrow intent preparation is not configured" });
    const result = await options.service.prepareAgonJobEscrowIntent(context.get("address"), parsed.data);
    return result.ok ? context.json(result.value, 201) : serviceErrorResponse(context, result.error);
  });

  app.get("/job-escrow/intents/:intentId", options.requireAuth, async (context) => {
    if (!options.service.getAgonJobEscrowIntent) return serviceErrorResponse(context, { code: "capability_unavailable", message: "AgonJobEscrow intent reads are not configured" });
    const result = await options.service.getAgonJobEscrowIntent(context.get("address"), context.req.param("intentId"));
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.get("/job-escrow/intents/:intentId/transaction", options.requireAuth, async (context) => {
    if (!options.service.getAgonJobEscrowTransaction) return serviceErrorResponse(context, { code: "capability_unavailable", message: "AgonJobEscrow transaction planning is not configured" });
    const result = await options.service.getAgonJobEscrowTransaction(context.get("address"), context.req.param("intentId"));
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.post("/job-escrow/intents/:intentId/reconcile", options.requireAuth, async (context) => {
    const body = await parseJson(context);
    if (isApiError(body)) return context.json(body, 400);
    const parsed = agonJobEscrowReconcileSchema.safeParse(body);
    if (!parsed.success) return context.json(validationResponse(parsed.error), 400);
    if (!options.service.reconcileAgonJobEscrowIntent) return serviceErrorResponse(context, { code: "capability_unavailable", message: "AgonJobEscrow reconciliation is not configured" });
    const result = await options.service.reconcileAgonJobEscrowIntent(context.get("address"), context.req.param("intentId"), parsed.data);
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.post("/job-escrow/intents/:intentId/submitted", options.requireAuth, async (context) => {
    const body = await parseJson(context);
    if (isApiError(body)) return context.json(body, 400);
    const parsed = agonJobEscrowSubmittedSchema.safeParse(body);
    if (!parsed.success) return context.json(validationResponse(parsed.error), 400);
    if (!options.service.markAgonJobEscrowSubmitted) return serviceErrorResponse(context, { code: "capability_unavailable", message: "AgonJobEscrow submission tracking is not configured" });
    const result = await options.service.markAgonJobEscrowSubmitted(context.get("address"), context.req.param("intentId"), parsed.data);
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.get("/listings", async (context) => {
    const parsed = queryFromRequest(context);
    if (!parsed.success) return context.json(validationResponse(parsed.error), 400);
    const result = await options.service.listListings(parsed.data);
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.get("/categories/:category/listings", async (context) => {
    const parsed = queryFromRequest(context, { category: context.req.param("category") });
    if (!parsed.success) return context.json(validationResponse(parsed.error), 400);
    const result = await options.service.listListings(parsed.data);
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.get("/agents/:agentId/listings", async (context) => {
    const parsed = queryFromRequest(context, { agentId: context.req.param("agentId") });
    if (!parsed.success) return context.json(validationResponse(parsed.error), 400);
    const result = await options.service.listListings(parsed.data);
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.get("/manifests/inspect", async (context) => {
    const uri = context.req.query("uri")?.trim() ?? "";
    if (!uri || uri.length > 2048) {
      return context.json({ error: { code: "invalid_request", message: "provide a manifest HTTPS URL no longer than 2048 characters" } }, 400);
    }
    try {
      return context.json(await inspectManifest(uri));
    } catch (cause) {
      if (cause instanceof ManifestInspectionError) {
        const status = cause.code === "manifest_uri_invalid" || cause.code === "manifest_uri_blocked" ? 422 : 502;
        return context.json({ error: { code: cause.code, message: cause.message } }, status);
      }
      return context.json({ error: { code: "manifest_unavailable", message: "The manifest could not be inspected." } }, 502);
    }
  });

  app.get("/listings/:reference", async (context) => {
    const result = await options.service.getListing(context.req.param("reference"));
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.post("/escrow/intents", options.requireAuth, async (context) => {
    const body = await parseJson(context);
    if (isApiError(body)) return context.json(body, 400);
    const parsed = agonEscrowIntentSchema.safeParse(body);
    if (!parsed.success) return context.json(validationResponse(parsed.error), 400);
    const result = await options.service.prepareAgonEscrowIntent(context.get("address"), parsed.data);
    return result.ok ? context.json(result.value, 201) : serviceErrorResponse(context, result.error);
  });

  app.get("/escrow/intents/:intentId", options.requireAuth, async (context) => {
    const result = await options.service.getAgonEscrowIntent(context.get("address"), context.req.param("intentId"));
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.get("/escrow/intents/:intentId/readiness", options.requireAuth, async (context) => {
    const result = await options.service.getAgonEscrowReadiness(context.get("address"), context.req.param("intentId"));
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.get("/escrow/intents/:intentId/transaction", options.requireAuth, async (context) => {
    const operation = context.req.query("operation") ?? "fund";
    if (operation !== "fund") return serviceErrorResponse(context, { code: "validation_failed", message: "only the fund transaction is prepared through this route" });
    const result = await options.service.getAgonEscrowTransaction(context.get("address"), context.req.param("intentId"), "fund");
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.post("/escrow/intents/:intentId/transaction-approval", options.requireAuth, async (context) => {
    const body = await parseJson(context);
    if (isApiError(body)) return context.json(body, 400);
    const parsed = agonEscrowTransactionApprovalSchema.safeParse(body);
    if (!parsed.success) return context.json(validationResponse(parsed.error), 400);
    if (!options.service.approveAgonEscrowTransaction) return serviceErrorResponse(context, { code: "execution_not_ready", message: "escrow transaction approval is not configured" });
    const result = await options.service.approveAgonEscrowTransaction(context.get("address"), context.req.param("intentId"), parsed.data);
    return result.ok ? context.json(result.value, 201) : serviceErrorResponse(context, result.error);
  });

  app.get("/escrow/intents/:intentId/transaction-approval", options.requireAuth, async (context) => {
    if (!options.service.getAgonEscrowTransactionApproval) return serviceErrorResponse(context, { code: "execution_not_ready", message: "escrow transaction approval is not configured" });
    const result = await options.service.getAgonEscrowTransactionApproval(context.get("address"), context.req.param("intentId"));
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.post("/escrow/intents/:intentId/fund", options.requireAuth, async (context) => {
    const body = await parseJson(context);
    if (isApiError(body)) return context.json(body, 400);
    const parsed = fundAgonEscrowSchema.safeParse(body);
    if (!parsed.success) return context.json(validationResponse(parsed.error), 400);
    if (!options.service.fundAgonEscrow) return serviceErrorResponse(context, { code: "escrow_disabled", message: "Agon escrow execution is disabled by policy" });
    const result = await options.service.fundAgonEscrow(context.get("address"), context.req.param("intentId"), parsed.data.confirmation);
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.post("/escrow/intents/:intentId/release", options.requireAuth, async (context) => {
    const body = await parseJson(context);
    if (isApiError(body)) return context.json(body, 400);
    const parsed = releaseAgonEscrowSchema.safeParse(body);
    if (!parsed.success) return context.json(validationResponse(parsed.error), 400);
    if (!options.service.releaseAgonEscrow) return serviceErrorResponse(context, { code: "escrow_disabled", message: "Agon escrow execution is disabled by policy" });
    const result = await options.service.releaseAgonEscrow(context.get("address"), context.req.param("intentId"), parsed.data.confirmation);
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.post("/escrow/intents/:intentId/refund", options.requireAuth, async (context) => {
    const body = await parseJson(context);
    if (isApiError(body)) return context.json(body, 400);
    const parsed = refundAgonEscrowSchema.safeParse(body);
    if (!parsed.success) return context.json(validationResponse(parsed.error), 400);
    if (!options.service.refundAgonEscrow) return serviceErrorResponse(context, { code: "escrow_disabled", message: "Agon escrow execution is disabled by policy" });
    const result = await options.service.refundAgonEscrow(context.get("address"), context.req.param("intentId"), parsed.data.confirmation);
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.post("/listings/:reference/call-intents", options.requireAuth, async (context) => {
    const body = await parseJson(context);
    if (isApiError(body)) return context.json(body, 400);
    const parsed = x402CallIntentSchema.safeParse(body);
    if (!parsed.success) return context.json(validationResponse(parsed.error), 400);
    const result = await options.service.prepareX402Call(
      context.get("address"),
      context.req.param("reference"),
      { ...parsed.data, input: parsed.data.input ?? null },
    );
    return result.ok ? context.json(result.value, 201) : serviceErrorResponse(context, result.error);
  });

  app.post("/call-intents/:intentId/approve", options.requireAuth, async (context) => {
    const body = await parseJson(context);
    if (isApiError(body)) return context.json(body, 400);
    const parsed = x402ApprovalSchema.safeParse(body);
    if (!parsed.success) return context.json(validationResponse(parsed.error), 400);
    const result = await options.service.approveX402Call(
      context.get("address"),
      context.req.param("intentId"),
      parsed.data,
    );
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.post("/call-intents/:intentId/payment-required", options.requireAuth, async (context) => {
    const result = await options.service.captureX402Quote(
      context.get("address"),
      context.req.param("intentId"),
    );
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.post("/call-intents/:intentId/authorization", options.requireAuth, async (context) => {
    const result = await options.service.prepareX402Authorization(
      context.get("address"),
      context.req.param("intentId"),
    );
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.post("/call-intents/:intentId/authorization/signature", options.requireAuth, async (context) => {
    const body = await parseJson(context);
    if (isApiError(body)) return context.json(body, 400);
    const parsed = x402AuthorizationSignatureSchema.safeParse(body);
    if (!parsed.success) return context.json(validationResponse(parsed.error), 400);
    const result = await options.service.submitX402Authorization(
      context.get("address"),
      context.req.param("intentId"),
      parsed.data as X402AuthorizationSignatureRequest,
    );
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.post("/call-intents/:intentId/execution-plan", options.requireAuth, async (context) => {
    const result = await options.service.prepareX402ExecutionPlan(
      context.get("address"),
      context.req.param("intentId"),
    );
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.post("/call-intents/:intentId/execution-approval", options.requireAuth, async (context) => {
    const body = await parseJson(context);
    if (isApiError(body)) return context.json(body, 400);
    const parsed = x402ExecutionApprovalSchema.safeParse(body);
    if (!parsed.success) return context.json(validationResponse(parsed.error), 400);
    const result = await options.service.approveX402Execution(
      context.get("address"),
      context.req.param("intentId"),
      parsed.data,
    );
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.get("/call-intents/:intentId/execution-readiness", options.requireAuth, async (context) => {
    const result = await options.service.getX402ExecutionReadiness(
      context.get("address"),
      context.req.param("intentId"),
    );
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.get("/call-intents/:intentId/settlement-readiness", options.requireAuth, async (context) => {
    const result = await options.service.getX402SettlementReadiness(
      context.get("address"),
      context.req.param("intentId"),
    );
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.get("/call-intents/:intentId/reconciliation-readiness", options.requireAuth, async (context) => {
    const result = await options.service.getX402ReconciliationReadiness(
      context.get("address"),
      context.req.param("intentId"),
    );
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.post("/call-intents/:intentId/reconcile", options.requireAuth, async (context) => {
    const body = await parseJson(context);
    if (isApiError(body)) return context.json(body, 400);
    const parsed = x402ReconciliationSchema.safeParse(body);
    if (!parsed.success) return context.json(validationResponse(parsed.error), 400);
    const result = await options.service.reconcileX402Receipt(
      context.get("address"),
      context.req.param("intentId"),
      parsed.data,
    );
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.post("/call-intents/:intentId/delivery-evidence", options.requireAuth, async (context) => {
    const body = await parseJson(context);
    if (isApiError(body)) return context.json(body, 400);
    const parsed = x402DeliveryEvidenceSchema.safeParse(body);
    if (!parsed.success) return context.json(validationResponse(parsed.error), 400);
    if (!options.service.recordX402Delivery) {
      return serviceErrorResponse(context, { code: "execution_not_ready", message: "x402 delivery evidence is not configured" });
    }
    const result = await options.service.recordX402Delivery(
      context.get("address"),
      context.req.param("intentId"),
      parsed.data as X402DeliveryEvidenceRequest,
    );
    return result.ok ? context.json(result.value, 201) : serviceErrorResponse(context, result.error);
  });

  app.post("/call-intents/:intentId/settle", options.requireAuth, async (context) => {
    const body = await parseJson(context);
    if (isApiError(body)) return context.json(body, 400);
    const parsed = x402SettlementSchema.safeParse(body);
    if (!parsed.success) return context.json(validationResponse(parsed.error), 400);
    const result = await options.service.settleX402Call(
      context.get("address"),
      context.req.param("intentId"),
      parsed.data as X402SettlementRequest,
    );
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.post("/call-intents/:intentId/facilitator-verify", options.requireAuth, async (context) => {
    const body = await parseJson(context);
    if (isApiError(body)) return context.json(body, 400);
    const parsed = x402FacilitatorVerificationSchema.safeParse(body);
    if (!parsed.success) return context.json(validationResponse(parsed.error), 400);
    const result = await options.service.verifyX402Facilitator(
      context.get("address"),
      context.req.param("intentId"),
      parsed.data as X402FacilitatorVerificationRequest,
    );
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.get("/call-intents/:intentId/facilitator-verification", options.requireAuth, async (context) => {
    const result = await options.service.getX402FacilitatorVerification(
      context.get("address"),
      context.req.param("intentId"),
    );
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  app.post("/profiles/bind", options.requireListingWriteAuth ?? options.requireAuth, requirePrincipal, async (context) => {
    const body = await parseJson(context);
    if (isApiError(body)) return context.json(body, 400);
    const parsed = bindProfileSchema.safeParse(body);
    if (!parsed.success) return context.json(validationResponse(parsed.error), 400);
    const result = await options.service.bindProfile(context.get("address"), parsed.data);
    return result.ok ? context.json(result.value, 201) : serviceErrorResponse(context, result.error);
  });

  app.post("/listings", options.requireListingWriteAuth ?? options.requireAuth, requirePrincipal, async (context) => {
    const body = await parseJson(context);
    if (isApiError(body)) return context.json(body, 400);
    const parsed = publishListingSchema.safeParse(body);
    if (!parsed.success) return context.json(validationResponse(parsed.error), 400);
    const result = await options.service.publishListing(context.get("address"), parsed.data);
    return result.ok ? context.json(result.value, 201) : serviceErrorResponse(context, result.error);
  });

  app.post("/listings/:listingId/versions", options.requireListingWriteAuth ?? options.requireAuth, requirePrincipal, async (context) => {
    const body = await parseJson(context);
    if (isApiError(body)) return context.json(body, 400);
    const parsed = publishListingVersionSchema.safeParse({ ...(body as Record<string, unknown>), listingId: context.req.param("listingId") });
    if (!parsed.success) return context.json(validationResponse(parsed.error), 400);
    const result = await options.service.publishListingVersion(context.get("address"), parsed.data);
    return result.ok ? context.json(result.value, 201) : serviceErrorResponse(context, result.error);
  });

  app.post("/operations/:operationId/confirm", options.requireListingConfirmAuth ?? options.requireAuth, requirePrincipal, async (context) => {
    const body = await parseJson(context);
    if (isApiError(body)) return context.json(body, 400);
    const parsed = confirmOperationSchema.safeParse(body);
    if (!parsed.success) return context.json(validationResponse(parsed.error), 400);
    const result = await options.service.confirmOperation(
      context.get("address"),
      context.req.param("operationId"),
      parsed.data.txHash as `0x${string}`,
    );
    return result.ok ? context.json(result.value) : serviceErrorResponse(context, result.error);
  });

  return app;
}
