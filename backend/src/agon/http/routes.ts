import { Hono, type Context, type MiddlewareHandler } from "hono";
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
  SubmittedOperation,
  X402ApprovalRequest,
  X402ApprovalView,
  X402CallIntentRequest,
  X402CallIntentView,
  X402QuoteView,
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
  getCapabilities(): Promise<AgonCapabilities>;
};

export type CreateAgonRoutesOptions = {
  service: AgonMarketService;
  requireAuth: MiddlewareHandler<{ Variables: AgonRouteVariables }>;
};

const positiveDecimal = z.string().regex(/^[1-9]\d*$/, "must be a positive decimal string");
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a bytes32 hex string");

const listingQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(2048).nullable().default(null),
  category: positiveDecimal.nullable().default(null),
  agentId: positiveDecimal.nullable().default(null),
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
    case "receipt_unavailable":
      return context.json(body, 409);
    case "receipt_invalid":
      return context.json(body, 422);
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
  });
}

export function createAgonRoutes(options: CreateAgonRoutesOptions) {
  const app = new Hono<{ Variables: AgonRouteVariables }>();

  app.get("/health", async (context) =>
    context.json({ ok: true, service: "agon", capabilities: await options.service.getCapabilities() }),
  );

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

  app.get("/listings/:reference", async (context) => {
    const result = await options.service.getListing(context.req.param("reference"));
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

  app.post("/profiles/bind", options.requireAuth, async (context) => {
    const body = await parseJson(context);
    if (isApiError(body)) return context.json(body, 400);
    const parsed = bindProfileSchema.safeParse(body);
    if (!parsed.success) return context.json(validationResponse(parsed.error), 400);
    const result = await options.service.bindProfile(context.get("address"), parsed.data);
    return result.ok ? context.json(result.value, 201) : serviceErrorResponse(context, result.error);
  });

  app.post("/listings", options.requireAuth, async (context) => {
    const body = await parseJson(context);
    if (isApiError(body)) return context.json(body, 400);
    const parsed = publishListingSchema.safeParse(body);
    if (!parsed.success) return context.json(validationResponse(parsed.error), 400);
    const result = await options.service.publishListing(context.get("address"), parsed.data);
    return result.ok ? context.json(result.value, 201) : serviceErrorResponse(context, result.error);
  });

  app.post("/operations/:operationId/confirm", options.requireAuth, async (context) => {
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
