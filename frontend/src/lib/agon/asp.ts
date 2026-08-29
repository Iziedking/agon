import { keccak256, stringToHex } from "viem";

import {
  AGON_CATEGORIES,
  categoryById,
  categoryBySlug,
  type AgonCategory,
} from "./catalog.ts";
import { canonicalManifestHash, canonicalizeManifest } from "./canonical.ts";
import { buildServiceManifest, parseTags, validateServiceDraft, validateServiceManifestV2 } from "./draft.ts";
import type {
  AgonArenaEvaluationView,
  AgonHealth,
  AgonListing,
  AgonPlaygroundRun,
  PublishListingRequest,
  PublishListingVersionRequest,
  SubmittedOperation,
} from "./types.ts";
import { assessListingAssurance, canUseEscrow, verifyManifestAnchor } from "./verify.ts";

export type AspIssue = { field: string; message: string };

export class AspCommandError extends Error {
  readonly code: string;
  readonly issues: AspIssue[];

  constructor(code: string, message: string, issues: AspIssue[] = []) {
    super(message);
    this.name = "AspCommandError";
    this.code = code;
    this.issues = issues;
  }
}

export type AspConfig = {
  chainId: string;
  agentId: string;
  serviceKey: string;
  manifestUri: string;
  name: string;
  description: string;
  logoUrl?: string;
  category: string;
  endpoint: string;
  tags: string[];
  amountUSDC: string;
};

export type PreparedAspListing = {
  config: AspConfig;
  category: AgonCategory;
  manifest: ReturnType<typeof buildServiceManifest>;
  canonicalManifest: string;
  manifestHash: `0x${string}`;
  serviceKeyHash: `0x${string}`;
  request: PublishListingRequest;
  initialTrustState: "Provider listed";
};

export type PreparedAspVersion = {
  config: AspConfig;
  listingId: string;
  version: number;
  manifest: ReturnType<typeof buildServiceManifest>;
  canonicalManifest: string;
  manifestHash: `0x${string}`;
  request: PublishListingVersionRequest;
  initialTrustState: "Provider listed";
};

export type AspManifestProof = {
  valid: boolean;
  state: "valid" | "match" | "mismatch" | "invalid";
  recomputedHash: `0x${string}` | null;
  expectedHash: string | null;
  issues: AspIssue[];
  message: string;
};

export type AspInspection = {
  reference: string;
  evidence: "coherent" | "unavailable" | "unsafe";
  category: ReturnType<typeof categoryById>;
  proof: ReturnType<typeof verifyManifestAnchor>;
  trust: ReturnType<typeof assessListingAssurance>;
  payment: AgonListing["payment"];
  effectivePayment: {
    directX402: boolean;
    escrow: boolean;
    message: string;
  };
  risk: AgonListing["risk"];
  provenance: AgonListing["provenance"];
};

type PublishAspListingOptions = {
  apiUrl: string;
  token: string;
  confirmed: boolean;
  prepared: PreparedAspListing;
  localManifest: unknown;
  fetchImpl?: typeof fetch;
};

type PublishAspVersionOptions = {
  apiUrl: string;
  token: string;
  confirmed: boolean;
  prepared: PreparedAspVersion;
  localManifest: unknown;
  fetchImpl?: typeof fetch;
};

export type EvaluateAspListingOptions = {
  apiUrl: string;
  token: string;
  listingReference: string;
  listingVersion: string;
  category: AgonPlaygroundRun["task"]["category"];
  taskId: string;
  idempotencyKey: string;
  input?: unknown;
  fetchImpl?: typeof fetch;
};

export type RequestAspVerificationOptions = {
  apiUrl: string;
  token: string;
  confirmed: boolean;
  listingReference: string;
  playgroundRunId: string;
  idempotencyKey: string;
  expiresAt: string;
  fetchImpl?: typeof fetch;
};

export type ConfirmAspOperationOptions = {
  apiUrl: string;
  token: string;
  operationId: string;
  txHash: string;
  fetchImpl?: typeof fetch;
};

export type ExecuteCircleAspOperationOptions = {
  apiUrl: string;
  token: string;
  confirmed: boolean;
  operation: SubmittedOperation;
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  timeoutMs?: number;
};

export type CircleAspExecution = {
  circleTransactionId: string;
  state: string;
  txHash: `0x${string}`;
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function resolveCategory(value: string): AgonCategory | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  const byId = categoryById(normalized);
  if (byId.slug !== "other") return byId;
  return categoryBySlug(normalized) ??
    AGON_CATEGORIES.find((category) => category.label.toLowerCase() === normalized) ??
    null;
}

function normalizeApiUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported protocol");
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new AspCommandError("invalid_api_url", "API URL must use HTTP or HTTPS");
  }
}

function parseConfig(input: unknown): { config: AspConfig; category: AgonCategory } {
  const source = object(input);
  if (!source) throw new AspCommandError("invalid_config", "ASP config must be a JSON object");

  const rawTags = source.tags;
  const tagsAreStrings = Array.isArray(rawTags) && rawTags.every((tag) => typeof tag === "string");
  const tags = tagsAreStrings ? parseTags((rawTags as string[]).join(",")) : [];
  const category = resolveCategory(cleanString(source.category));
  const config: AspConfig = {
    chainId: cleanString(source.chainId),
    agentId: cleanString(source.agentId),
    serviceKey: cleanString(source.serviceKey),
    manifestUri: cleanString(source.manifestUri),
    name: cleanString(source.name),
    description: cleanString(source.description),
    logoUrl: cleanString(source.logoUrl) || undefined,
    category: cleanString(source.category),
    endpoint: cleanString(source.endpoint),
    tags,
    amountUSDC: cleanString(source.amountUSDC),
  };

  const issues: AspIssue[] = [];
  if (!/^[1-9]\d*$/.test(config.chainId)) {
    issues.push({ field: "chainId", message: "Use a positive decimal chain ID." });
  }
  if (!category) {
    issues.push({ field: "category", message: "Choose a category from the Agon registry." });
  }
  if (!tagsAreStrings) {
    issues.push({ field: "tags", message: "Use a JSON array of search-tag strings." });
  }
  if (!/^(https:\/\/|ipfs:\/\/).+/i.test(config.manifestUri)) {
    issues.push({ field: "manifestUri", message: "Manifest URI must use HTTPS or IPFS." });
  }

  const draftIssues = validateServiceDraft({
    agentId: config.agentId,
    name: config.name,
    description: config.description,
    logoUrl: config.logoUrl,
    categoryId: category?.id ?? "",
    serviceKey: config.serviceKey,
    endpoint: config.endpoint,
    tags: config.tags.join(","),
    amountUSDC: config.amountUSDC,
  });
  issues.push(...draftIssues.map((issue) => ({
    field: issue.field === "categoryId" ? "category" : issue.field,
    message: issue.message,
  })));

  if (issues.length || !category) {
    throw new AspCommandError("invalid_config", "ASP config is not ready", issues);
  }
  return { config, category };
}

export function prepareAspListing(input: unknown): PreparedAspListing {
  const { config, category } = parseConfig(input);
  const manifest = buildServiceManifest({
    agentId: config.agentId,
    name: config.name,
    description: config.description,
    logoUrl: config.logoUrl,
    categoryId: category.id,
    serviceKey: config.serviceKey,
    endpoint: config.endpoint,
    tags: config.tags.join(","),
    amountUSDC: config.amountUSDC,
  });
  const manifestHash = canonicalManifestHash(manifest);
  const serviceKeyHash = keccak256(stringToHex(config.serviceKey));
  return {
    config,
    category,
    manifest,
    canonicalManifest: canonicalizeManifest(manifest),
    manifestHash,
    serviceKeyHash,
    request: {
      chainId: config.chainId,
      agentId: config.agentId,
      serviceKey: serviceKeyHash,
      manifestHash,
      manifestUri: config.manifestUri,
      category: category.id,
      paymentRail: "X402",
    },
    initialTrustState: "Provider listed",
  };
}

export function prepareAspListingVersion(input: unknown, localManifest: unknown, listingId: string): PreparedAspVersion {
  const normalizedListingId = cleanString(listingId);
  if (!/^[1-9]\d*$/.test(normalizedListingId)) {
    throw new AspCommandError("invalid_arguments", "Listing ID must be a positive decimal number.");
  }
  const { config, category } = parseConfig(input);
  const source = object(localManifest);
  const sourceService = object(source?.service);
  const version = sourceService?.version;
  if (typeof version !== "string" || !/^\d+$/.test(version) || Number(version) < 2) {
    throw new AspCommandError("invalid_manifest", "An update manifest must use an integer version of 2 or higher.");
  }
  const proof = verifyAspManifest(localManifest);
  if (!proof.valid || !proof.recomputedHash) {
    throw new AspCommandError("invalid_manifest", "The update manifest is not valid.", proof.issues);
  }
  const expectedManifest = buildServiceManifest({
    agentId: config.agentId,
    version: Number(version),
    name: config.name,
    description: config.description,
    logoUrl: config.logoUrl,
    categoryId: category.id,
    serviceKey: config.serviceKey,
    endpoint: config.endpoint,
    tags: config.tags.join(","),
    amountUSDC: config.amountUSDC,
  });
  if (canonicalizeManifest(localManifest) !== canonicalizeManifest(expectedManifest)) {
    throw new AspCommandError(
      "manifest_mismatch",
      "The update manifest differs from the reviewed service config. Update both files, then retry.",
    );
  }
  return {
    config,
    listingId: normalizedListingId,
    version: Number(version),
    manifest: expectedManifest,
    canonicalManifest: canonicalizeManifest(expectedManifest),
    manifestHash: proof.recomputedHash,
    request: {
      chainId: config.chainId,
      listingId: normalizedListingId,
      manifestHash: proof.recomputedHash,
      manifestUri: config.manifestUri,
      paymentRail: "X402",
    },
    initialTrustState: "Provider listed",
  };
}

function manifestIssues(input: unknown): AspIssue[] {
  const manifest = object(input);
  if (!manifest) return [{ field: "manifest", message: "Manifest must be a JSON object." }];

  if (manifest.protocol === "agon-service/2") {
    return validateServiceManifestV2(manifest).map((issue) => ({ field: issue.field, message: issue.message }));
  }

  const category = resolveCategory(cleanString(manifest.category));
  const pricing = object(manifest.pricing);
  const rawTags = manifest.tags;
  const tagsAreStrings = Array.isArray(rawTags) && rawTags.every((tag) => typeof tag === "string");
  const issues: AspIssue[] = [];
  if (!Number.isSafeInteger(manifest.version) || Number(manifest.version) < 1) {
    issues.push({ field: "version", message: "Manifest version must be a positive integer." });
  }
  if (!category || category.slug !== cleanString(manifest.category).toLowerCase()) {
    issues.push({ field: "category", message: "Manifest category must use a registered category slug." });
  }
  if (!pricing || pricing.rail !== "x402") {
    issues.push({ field: "pricing.rail", message: "The ASP CLI currently supports direct x402 pricing." });
  }
  if (!tagsAreStrings) {
    issues.push({ field: "tags", message: "Manifest tags must be an array of strings." });
  } else {
    const normalizedTags = (rawTags as string[]).map((tag) => tag.trim().toLowerCase());
    if (normalizedTags.some((tag) => !tag) || new Set(normalizedTags).size !== normalizedTags.length) {
      issues.push({ field: "tags", message: "Manifest tags must be nonempty and unique." });
    }
  }

  if (manifest.logoUrl !== undefined && typeof manifest.logoUrl !== "string") {
    issues.push({ field: "logoUrl", message: "Manifest logoUrl must be a public HTTPS image URL." });
  }

  if (category && pricing && tagsAreStrings) {
    const draftIssues = validateServiceDraft({
      agentId: "1",
      name: cleanString(manifest.name),
      description: cleanString(manifest.description),
      logoUrl: cleanString(manifest.logoUrl) || undefined,
      categoryId: category.id,
      serviceKey: "manifest-check",
      endpoint: cleanString(manifest.endpoint),
      tags: (rawTags as string[]).join(","),
      amountUSDC: cleanString(pricing.amountUSDC),
    });
    issues.push(...draftIssues
      .filter((issue) => issue.field !== "agentId" && issue.field !== "serviceKey")
      .map((issue) => ({
        field: issue.field === "categoryId" ? "category" : issue.field,
        message: issue.message,
      })));
  }

  const encoded = JSON.stringify(manifest);
  if (/"(?:\$ref|patternProperties|additionalProperties)"\s*:|"remote"\s*:/i.test(encoded)) {
    issues.push({ field: "inputSchema", message: "Manifest schema contains a forbidden remote or executable keyword." });
  }
  return issues;
}

export function verifyAspManifest(input: unknown, expectedHash?: string): AspManifestProof {
  const issues = manifestIssues(input);
  if (issues.length) {
    return {
      valid: false,
      state: "invalid",
      recomputedHash: null,
      expectedHash: expectedHash ?? null,
      issues,
      message: "Manifest validation failed.",
    };
  }

  const recomputedHash = canonicalManifestHash(input);
  if (!expectedHash) {
    return {
      valid: true,
      state: "valid",
      recomputedHash,
      expectedHash: null,
      issues: [],
      message: "Manifest is valid and ready for anchoring.",
    };
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(expectedHash)) {
    return {
      valid: false,
      state: "invalid",
      recomputedHash,
      expectedHash,
      issues: [{ field: "expectedHash", message: "Expected hash must be a bytes32 hex string." }],
      message: "Expected hash is invalid.",
    };
  }
  const matches = recomputedHash.toLowerCase() === expectedHash.toLowerCase();
  return {
    valid: true,
    state: matches ? "match" : "mismatch",
    recomputedHash,
    expectedHash,
    issues: [],
    message: matches
      ? "Canonical manifest hash matches the expected anchor."
      : "Canonical manifest hash does not match the expected anchor.",
  };
}

export function inspectAspListing(
  listing: AgonListing,
  manifest?: unknown,
  currentOwner?: string | null,
): AspInspection {
  let proof = verifyManifestAnchor(listing.manifest.hash, manifest);
  if (manifest !== undefined) {
    const local = verifyAspManifest(manifest, listing.manifest.hash);
    if (!local.valid) {
      proof = { state: "invalid", recomputedHash: null, message: local.message };
    }
  }
  const trust = assessListingAssurance(listing, proof, currentOwner);
  const coherent = proof.state === "match";
  const directX402 = coherent && listing.payment.directX402 && listing.endpointQa.status === "passed" &&
    (trust.state === "verified" || trust.state === "unverified");
  const escrow = canUseEscrow(listing, proof, currentOwner);
  return {
    reference: listing.id,
    evidence: coherent
      ? "coherent"
      : proof.state === "unavailable"
        ? "unavailable"
        : "unsafe",
    category: categoryById(listing.category),
    proof,
    trust,
    payment: listing.payment,
    effectivePayment: {
      directX402,
      escrow,
      message: directX402 || escrow
        ? "Current listing evidence supports the reported payment path."
        : coherent
          ? "The listing evidence is coherent, but no payment path is currently eligible."
          : "Payment is not recommended because listing evidence is incomplete or unsafe.",
    },
    risk: listing.risk,
    provenance: listing.provenance,
  };
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function apiFailure(status: number, body: unknown): AspCommandError {
  const response = object(body);
  const error = object(response?.error);
  return new AspCommandError(
    cleanString(error?.code) || "request_failed",
    cleanString(error?.message) || `Agon API request failed with status ${status}`,
  );
}

export async function getAspHealth(apiUrl: string, fetchImpl: typeof fetch = fetch): Promise<AgonHealth> {
  const baseUrl = normalizeApiUrl(apiUrl);
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/agon/health`, { signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new AspCommandError("network_unavailable", "Could not reach the Agon API");
  }
  const body = await readJson(response);
  if (!response.ok) throw apiFailure(response.status, body);
  const health = object(body);
  const capabilities = object(health?.capabilities);
  if (health?.ok !== true || health.service !== "agon" || !capabilities) {
    throw new AspCommandError("invalid_response", "Agon health response is malformed");
  }
  return body as AgonHealth;
}

export async function fetchAspListing(
  apiUrl: string,
  reference: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AgonListing> {
  const baseUrl = normalizeApiUrl(apiUrl);
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/agon/listings/${encodeURIComponent(reference)}`, {
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AspCommandError("network_unavailable", "Could not reach the Agon API");
  }
  const body = await readJson(response);
  if (!response.ok) throw apiFailure(response.status, body);
  const listing = object(body);
  if (!listing || cleanString(listing.id) !== reference || !object(listing.manifest)) {
    throw new AspCommandError("invalid_response", "Agon listing response is malformed");
  }
  return body as AgonListing;
}

export async function publishAspListing(options: PublishAspListingOptions): Promise<SubmittedOperation> {
  if (!options.confirmed) {
    throw new AspCommandError("confirmation_required", "Publication requires explicit --yes confirmation");
  }
  const localProof = verifyAspManifest(options.localManifest, options.prepared.manifestHash);
  if (!localProof.valid || localProof.state !== "match") {
    throw new AspCommandError(
      "manifest_mismatch",
      "Local manifest does not match the prepared listing anchor",
      localProof.issues,
    );
  }
  if (canonicalizeManifest(options.localManifest) !== options.prepared.canonicalManifest) {
    throw new AspCommandError("manifest_mismatch", "Local manifest content differs from the prepared service config");
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const apiUrl = normalizeApiUrl(options.apiUrl);
  const health = await getAspHealth(apiUrl, fetchImpl);
  if (!health.capabilities.listingWrites) {
    throw new AspCommandError(
      "capability_unavailable",
      "Agon listing writes are unavailable; no publication request was sent",
    );
  }
  if (!options.token.trim()) {
    throw new AspCommandError("authentication_required", "Set the selected session-token environment variable");
  }

  let response: Response;
  try {
    response = await fetchImpl(`${apiUrl}/agon/listings`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(options.prepared.request),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AspCommandError("network_unavailable", "Agon publication request did not complete");
  }
  const body = await readJson(response);
  if (!response.ok) throw apiFailure(response.status, body);
  const operation = object(body);
  if (!validWriteOperation(operation)) {
    throw new AspCommandError("invalid_response", "Agon publication response is malformed");
  }
  return body as SubmittedOperation;
}

export async function publishAspListingVersion(options: PublishAspVersionOptions): Promise<SubmittedOperation> {
  if (!options.confirmed) {
    throw new AspCommandError("confirmation_required", "Version publication requires explicit --yes confirmation");
  }
  const localProof = verifyAspManifest(options.localManifest, options.prepared.manifestHash);
  if (!localProof.valid || localProof.state !== "match") {
    throw new AspCommandError("manifest_mismatch", "Local update manifest does not match the prepared version anchor", localProof.issues);
  }
  if (canonicalizeManifest(options.localManifest) !== options.prepared.canonicalManifest) {
    throw new AspCommandError("manifest_mismatch", "Local update manifest differs from the reviewed service config");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiUrl = normalizeApiUrl(options.apiUrl);
  const health = await getAspHealth(apiUrl, fetchImpl);
  if (!health.capabilities.listingWrites) {
    throw new AspCommandError("capability_unavailable", "Agon listing writes are unavailable; no update request was sent");
  }
  if (!options.token.trim()) {
    throw new AspCommandError("authentication_required", "Set the selected session-token environment variable");
  }
  let response: Response;
  try {
    response = await fetchImpl(`${apiUrl}/agon/listings/${encodeURIComponent(options.prepared.listingId)}/versions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(options.prepared.request),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AspCommandError("network_unavailable", "Agon version publication request did not complete");
  }
  const body = await readJson(response);
  if (!response.ok) throw apiFailure(response.status, body);
  const operation = object(body);
  if (!validWriteOperation(operation) || operation.transaction.functionName !== "publishVersion") {
    throw new AspCommandError("invalid_response", "Agon version publication response is malformed");
  }
  return body as SubmittedOperation;
}

export async function evaluateAspListing(options: EvaluateAspListingOptions): Promise<AgonPlaygroundRun> {
  if (!options.token.trim()) throw new AspCommandError("authentication_required", "Set the selected session-token environment variable");
  const apiUrl = normalizeApiUrl(options.apiUrl);
  if (!/^[1-9]\d*$/.test(options.listingVersion)) throw new AspCommandError("invalid_arguments", "Listing version must be a positive decimal number");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(options.idempotencyKey)) throw new AspCommandError("invalid_arguments", "Idempotency key must be 8-128 safe characters");
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(`${apiUrl}/agon/playground/evaluate`, {
      method: "POST",
      headers: { authorization: `Bearer ${options.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        listingReference: options.listingReference,
        listingVersion: options.listingVersion,
        category: options.category,
        taskId: options.taskId,
        idempotencyKey: options.idempotencyKey,
        input: options.input,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new AspCommandError("network_unavailable", "Agon Playground did not respond");
  }
  const body = await readJson(response);
  if (!response.ok) throw apiFailure(response.status, body);
  const run = object(body);
  if (!run || !cleanString(run.runId) || typeof run.score !== "number" || !object(run.evidence)) {
    throw new AspCommandError("invalid_response", "Agon Playground response is malformed");
  }
  return body as AgonPlaygroundRun;
}

export async function requestAspVerification(options: RequestAspVerificationOptions): Promise<AgonArenaEvaluationView> {
  if (!options.confirmed) throw new AspCommandError("confirmation_required", "Verification request requires explicit --yes confirmation");
  if (!options.token.trim()) throw new AspCommandError("authentication_required", "Set the selected session-token environment variable");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(options.idempotencyKey)) throw new AspCommandError("invalid_arguments", "Idempotency key must be 8-128 safe characters");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(options.playgroundRunId)) throw new AspCommandError("invalid_arguments", "Playground run ID must be a UUID");
  if (Number.isNaN(Date.parse(options.expiresAt))) throw new AspCommandError("invalid_arguments", "Verification expiry must be an ISO timestamp");
  const apiUrl = normalizeApiUrl(options.apiUrl);
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(`${apiUrl}/agon/arena/evaluations`, {
      method: "POST",
      headers: { authorization: `Bearer ${options.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        listingReference: options.listingReference,
        idempotencyKey: options.idempotencyKey,
        playgroundRunId: options.playgroundRunId,
        expiresAt: options.expiresAt,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AspCommandError("network_unavailable", "Agon verification request did not complete");
  }
  const body = await readJson(response);
  if (!response.ok) throw apiFailure(response.status, body);
  const evaluation = object(body);
  if (!evaluation || !cleanString(evaluation.intentId) || evaluation.listingReference !== options.listingReference) {
    throw new AspCommandError("invalid_response", "Agon verification response is malformed");
  }
  return body as AgonArenaEvaluationView;
}

export async function confirmAspOperation(options: ConfirmAspOperationOptions): Promise<SubmittedOperation> {
  if (!options.token.trim()) {
    throw new AspCommandError("authentication_required", "Set the selected session-token environment variable");
  }
  if (!options.operationId.trim()) {
    throw new AspCommandError("invalid_arguments", "Operation ID is required");
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(options.txHash)) {
    throw new AspCommandError("invalid_arguments", "Transaction hash must be 32-byte hex");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiUrl = normalizeApiUrl(options.apiUrl);
  let response: Response;
  try {
    response = await fetchImpl(
      `${apiUrl}/agon/operations/${encodeURIComponent(options.operationId)}/confirm`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ txHash: options.txHash }),
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    throw new AspCommandError("network_unavailable", "Agon receipt confirmation did not complete");
  }
  const body = await readJson(response);
  if (!response.ok) throw apiFailure(response.status, body);
  const operation = object(body);
  if (!validWriteOperation(operation) || operation.state !== "confirmed" || !operation.txHash) {
    throw new AspCommandError("invalid_response", "Agon confirmation response is malformed");
  }
  return body as SubmittedOperation;
}

export async function executeCircleAspOperation(options: ExecuteCircleAspOperationOptions): Promise<CircleAspExecution> {
  if (!options.confirmed) throw new AspCommandError("confirmation_required", "Circle execution requires explicit --yes confirmation");
  if (!options.token.trim()) throw new AspCommandError("authentication_required", "Set the selected session-token environment variable");
  if (!validWriteOperation(options.operation) || options.operation.state !== "prepared") {
    throw new AspCommandError("invalid_operation", "Only a prepared Agon operation can be executed");
  }
  const signatures: Record<SubmittedOperation["transaction"]["functionName"], string> = {
    bindProfile: "bindProfile(uint256,string)",
    publish: "publish(uint256,bytes32,bytes32,string,uint256,uint8)",
    publishVersion: "publishVersion(uint256,bytes32,string,uint8)",
  };
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiUrl = normalizeApiUrl(options.apiUrl);
  let response: Response;
  try {
    response = await fetchImpl(`${apiUrl}/wallet/execute`, {
      method: "POST",
      headers: { authorization: `Bearer ${options.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        contractAddress: options.operation.transaction.to,
        abiFunctionSignature: signatures[options.operation.transaction.functionName],
        abiParameters: options.operation.transaction.args,
        refId: options.operation.operationId,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AspCommandError("network_unavailable", "Circle transaction submission did not complete");
  }
  const submitted = await readJson(response);
  if (!response.ok) throw apiFailure(response.status, submitted);
  const submittedObject = object(submitted);
  const circleTransactionId = cleanString(submittedObject?.id);
  if (!circleTransactionId) throw new AspCommandError("invalid_response", "Circle returned no transaction ID");

  const deadline = Date.now() + (options.timeoutMs ?? 120_000);
  const pollIntervalMs = options.pollIntervalMs ?? 1_200;
  while (Date.now() < deadline) {
    let statusResponse: Response;
    try {
      statusResponse = await fetchImpl(`${apiUrl}/wallet/tx/${encodeURIComponent(circleTransactionId)}`, {
        headers: { authorization: `Bearer ${options.token}` },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new AspCommandError("network_unavailable", "Circle transaction status could not be loaded");
    }
    const statusBody = await readJson(statusResponse);
    if (!statusResponse.ok) throw apiFailure(statusResponse.status, statusBody);
    const status = object(statusBody);
    const txHash = cleanString(status?.txHash);
    const state = cleanString(status?.state);
    if (txHash && /^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      return { circleTransactionId, state, txHash: txHash as `0x${string}` };
    }
    if (["FAILED", "REJECTED", "CANCELLED"].includes(state.toUpperCase())) {
      throw new AspCommandError("transaction_failed", `Circle transaction ${state.toLowerCase()}`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, pollIntervalMs));
  }
  throw new AspCommandError("transaction_timeout", "Circle did not return a transaction hash before the polling deadline");
}

function validWriteOperation(operation: Record<string, unknown> | null): operation is Record<string, unknown> & SubmittedOperation {
  const transaction = object(operation?.transaction);
  return Boolean(
    operation &&
    cleanString(operation.operationId) &&
    (operation.state === "prepared" || operation.state === "confirmed") &&
    transaction &&
    cleanString(transaction.chainId) &&
    /^0x[0-9a-fA-F]{40}$/.test(cleanString(transaction.to) ?? "") &&
    /^0x[0-9a-fA-F]+$/.test(cleanString(transaction.data) ?? "") &&
    (transaction.functionName === "bindProfile" || transaction.functionName === "publish" || transaction.functionName === "publishVersion") &&
    Array.isArray(transaction.args),
  );
}
