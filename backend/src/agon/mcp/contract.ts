import { z } from "zod";

const id = z.string().trim().min(1).max(256);
const nonEmpty = z.string().trim().min(1).max(8_000);
const amount = z.string().regex(/^\d+(?:\.\d{1,6})?$/, "amount must be a decimal string");

export const mcpCapability = z.enum([
  "discover",
  "inspect",
  "preview",
  "hire",
  "escrow",
  "work",
  "result",
  "list",
  "publish",
  "pause",
]);

export const serviceSearchInput = z.object({
  query: nonEmpty.optional(),
  category: id.optional(),
  maxPriceUSDC: amount.optional(),
  privacy: z.enum(["none", "declared", "provider-retained"]).optional(),
  maxLatencyMs: z.number().int().positive().max(300_000).optional(),
  verifiedOnly: z.boolean().default(false),
  limit: z.number().int().positive().max(50).default(10),
}).strict();

export const serviceReference = z.object({
  reference: id,
  source: z.object({ id, name: nonEmpty }).strict(),
  name: nonEmpty,
  provider: nonEmpty,
  outcome: nonEmpty,
  category: id,
  priceUSDC: amount,
  expectedLatencyMs: z.number().int().positive().max(300_000),
  availability: z.enum(["ready", "busy", "paused", "needs_review"]),
  verification: z.enum(["verified", "listed", "unverified", "quarantined", "unavailable"]),
  privacy: nonEmpty,
  accepts: z.array(nonEmpty).max(32),
  returns: z.array(nonEmpty).max(32),
}).strict();

export const serviceTerms = z.object({
  service: serviceReference,
  input: z.record(z.unknown()),
  priceUSDC: amount,
  paymentMode: z.enum(["per_call", "escrow"]),
  expiresAt: z.string().datetime({ offset: true }),
  deliveryDeadlineMs: z.number().int().positive().max(86_400_000),
  privacy: nonEmpty,
  failurePolicy: nonEmpty,
  termsDigest: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
}).strict();

export const previewHireInput = z.object({
  serviceReference: id,
  input: z.record(z.unknown()),
  paymentMode: z.enum(["per_call", "escrow"]).default("per_call"),
}).strict();

export const authorizeHireInput = z.object({
  termsDigest: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  approval: z.literal("approve"),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/),
}).strict();

export const hireResult = z.object({
  status: z.enum(["awaiting_approval", "preparing", "paid", "working", "delivered", "reconciling", "complete", "needs_attention"]),
  nextAction: nonEmpty,
  hireId: id,
  terms: serviceTerms.optional(),
  result: z.unknown().optional(),
  paymentEvidence: z.record(z.unknown()).optional(),
  deliveryEvidence: z.record(z.unknown()).optional(),
  reconciliationEvidence: z.record(z.unknown()).optional(),
}).strict();

export const providerDraftInput = z.object({
  name: z.string().trim().min(1).max(80),
  outcome: z.string().trim().min(1).max(500),
  category: id,
  inputs: z.array(nonEmpty).max(64),
  outputs: z.array(nonEmpty).max(64),
  priceUSDC: amount,
  expectedLatencyMs: z.number().int().positive().max(300_000),
  privacy: nonEmpty,
  failurePolicy: nonEmpty,
  endpoint: z.string().url().startsWith("https://"),
}).strict();

export const mcpOperation = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("search_services"), input: serviceSearchInput }),
  z.object({ kind: z.literal("get_service"), reference: id }),
  z.object({ kind: z.literal("preview_hire"), input: previewHireInput }),
  z.object({ kind: z.literal("authorize_hire"), input: authorizeHireInput }),
  z.object({ kind: z.literal("get_work"), hireId: id }),
  z.object({ kind: z.literal("retry_or_report_work"), hireId: id, action: z.enum(["retry_delivery", "report_problem"]) }),
  z.object({ kind: z.literal("start_listing"), input: providerDraftInput }),
  z.object({ kind: z.literal("check_listing"), draftId: id }),
  z.object({ kind: z.literal("publish_listing"), draftId: id, approval: z.literal("approve") }),
  z.object({ kind: z.literal("pause_listing"), reference: id, approval: z.literal("approve") }),
]);

export type McpOperation = z.infer<typeof mcpOperation>;
export type ServiceSearchInput = z.infer<typeof serviceSearchInput>;
export type ServiceReference = z.infer<typeof serviceReference>;
export type ServiceTerms = z.infer<typeof serviceTerms>;
export type HireResult = z.infer<typeof hireResult>;
export type ProviderDraftInput = z.infer<typeof providerDraftInput>;
