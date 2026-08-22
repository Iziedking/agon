import type {
  AgonHealth,
  AgonListing,
  AgonListingPage,
  ApiErrorBody,
  BindProfileRequest,
  ListListingsQuery,
  PublishListingRequest,
  SubmittedOperation,
  X402CallIntentRequest,
  X402CallIntentView,
  X402ApprovalRequest,
  X402ApprovalView,
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
  X402FacilitatorVerificationRequest,
  X402FacilitatorVerificationView,
} from "./types";
import { AGON_PREVIEW_HEALTH, AGON_PREVIEW_LISTINGS } from "./preview";

export const AGON_PREVIEW_MODE = process.env.NEXT_PUBLIC_AGON_PREVIEW_FIXTURES === "1";

const AGON_API_URL = (
  process.env.NEXT_PUBLIC_AGON_API_URL ??
  process.env.NEXT_PUBLIC_AUTH_URL ??
  "http://localhost:8082"
).replace(/\/$/, "");

export class AgonApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "AgonApiError";
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${AGON_API_URL}/agon${path}`, {
      ...init,
      credentials: "include",
      headers: init?.body
        ? { "content-type": "application/json", ...init.headers }
        : init?.headers,
    });
  } catch {
    throw new AgonApiError("network_unavailable", "Could not reach the Agon indexer.", 0);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new AgonApiError(
      body.error?.code ?? "request_failed",
      body.error?.message ?? "Agon request failed.",
      response.status,
    );
  }
  return (await response.json()) as T;
}

export function listListings(query: ListListingsQuery = {}): Promise<AgonListingPage> {
  if (AGON_PREVIEW_MODE) {
    const items = AGON_PREVIEW_LISTINGS
      .filter((listing) => !query.category || listing.category === query.category)
      .filter((listing) => !query.agentId || listing.agentId === query.agentId)
      .slice(0, query.limit ?? AGON_PREVIEW_LISTINGS.length);
    return Promise.resolve({ items, nextCursor: null });
  }
  const params = new URLSearchParams();
  if (query.limit) params.set("limit", String(query.limit));
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.category) params.set("category", query.category);
  if (query.agentId) params.set("agentId", query.agentId);
  const suffix = params.size ? `?${params.toString()}` : "";
  return request<AgonListingPage>(`/listings${suffix}`);
}

export function getListing(reference: string): Promise<AgonListing> {
  if (AGON_PREVIEW_MODE) {
    const listing = AGON_PREVIEW_LISTINGS.find((item) => item.id === reference || item.listingId === reference);
    return listing
      ? Promise.resolve(listing)
      : Promise.reject(new AgonApiError("listing_not_found", "This preview listing does not exist.", 404));
  }
  return request<AgonListing>(`/listings/${encodeURIComponent(reference)}`);
}

export function getAgonHealth(): Promise<AgonHealth> {
  if (AGON_PREVIEW_MODE) return Promise.resolve(AGON_PREVIEW_HEALTH);
  return request<AgonHealth>("/health");
}

export function bindProfile(payload: BindProfileRequest): Promise<SubmittedOperation> {
  return request<SubmittedOperation>("/profiles/bind", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function publishListing(payload: PublishListingRequest): Promise<SubmittedOperation> {
  return request<SubmittedOperation>("/listings", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function confirmAgonOperation(
  operationId: string,
  txHash: `0x${string}`,
): Promise<SubmittedOperation> {
  return request<SubmittedOperation>(`/operations/${encodeURIComponent(operationId)}/confirm`, {
    method: "POST",
    body: JSON.stringify({ txHash }),
  });
}

export function prepareX402CallIntent(
  reference: string,
  payload: X402CallIntentRequest,
): Promise<X402CallIntentView> {
  if (AGON_PREVIEW_MODE) {
    return Promise.resolve({
      intentId: "00000000-0000-4000-8000-000000000099",
      actor: "0x0000000000000000000000000000000000000000",
      idempotencyKey: payload.idempotencyKey,
      listingReference: reference,
      listingVersion: "1",
      inputHash: `0x${"99".repeat(32)}`,
      maxAmountUSDC: payload.maxAmountUSDC,
      state: "prepared",
      executionEnabled: false,
      nextAction: "execution_adapter_not_enabled",
      createdAt: "2026-08-20T12:00:00.000Z",
      targetUrl: payload.endpointUrl ?? null,
    });
  }
  return request<X402CallIntentView>(`/listings/${encodeURIComponent(reference)}/call-intents`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function approveX402CallIntent(
  intentId: string,
  payload: X402ApprovalRequest,
): Promise<X402ApprovalView> {
  if (AGON_PREVIEW_MODE) {
    return Promise.resolve({
      receiptId: "00000000-0000-4000-8000-000000000100",
      intentId,
      actor: "0x0000000000000000000000000000000000000000",
      state: "approved",
      approvedAmountUSDC: payload.approvedAmountUSDC,
      executionEnabled: false,
      nextAction: "payment_adapter_not_enabled",
      approvedAt: "2026-08-20T12:01:00.000Z",
    });
  }
  return request<X402ApprovalView>(`/call-intents/${encodeURIComponent(intentId)}/approve`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function captureX402Quote(intentId: string): Promise<X402QuoteView> {
  if (AGON_PREVIEW_MODE) {
    return Promise.resolve({
      receiptId: "00000000-0000-4000-8000-000000000100",
      intentId,
      state: "payment_required",
      status: 402,
      targetUrl: "https://preview.provider.example/x402",
      quoteHash: `0x${"ab".repeat(32)}`,
      x402Version: 2,
      resource: { url: "https://preview.provider.example/x402", description: "Agon preview quote", mimeType: "application/json" },
      accepts: [{
        scheme: "exact",
        network: "eip155:5042002",
        asset: `0x${"11".repeat(20)}`,
        amount: "1000",
        payTo: `0x${"22".repeat(20)}`,
        maxTimeoutSeconds: 600,
        gateway: true,
      }],
      executionEnabled: false,
      nextAction: "authorization_not_enabled",
      capturedAt: "2026-08-20T12:02:00.000Z",
    });
  }
  return request<X402QuoteView>(`/call-intents/${encodeURIComponent(intentId)}/payment-required`, { method: "POST" });
}

export function prepareX402Authorization(intentId: string): Promise<X402AuthorizationView> {
  if (AGON_PREVIEW_MODE) {
    const address = `0x${"aa".repeat(20)}` as `0x${string}`;
    return Promise.resolve({
      receiptId: "00000000-0000-4000-8000-000000000100",
      intentId,
      state: "authorization_ready",
      payloadHash: `0x${"cd".repeat(32)}`,
      payload: {
        x402Version: 2,
        domain: { name: "GatewayWalletBatched", version: "1", chainId: 5042002, verifyingContract: address },
        types: { TransferWithAuthorization: [
          { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
        ] },
        primaryType: "TransferWithAuthorization",
        message: { from: address, to: address, value: "1000", validAfter: "1787240000", validBefore: "1787844900", nonce: `0x${"bb".repeat(32)}` },
      },
      expiresAt: "2026-08-27T10:15:00.000Z",
      executionEnabled: false,
      nextAction: "user_signature_required",
      preparedAt: "2026-08-20T12:03:00.000Z",
    });
  }
  return request<X402AuthorizationView>(`/call-intents/${encodeURIComponent(intentId)}/authorization`, { method: "POST" });
}

/** Submit a wallet-produced signature for validation only. This endpoint never settles or calls the provider. */
export function submitX402AuthorizationSignature(
  intentId: string,
  body: X402AuthorizationSignatureRequest,
): Promise<X402AuthorizationSubmittedView> {
  if (AGON_PREVIEW_MODE) {
    return Promise.resolve({
      receiptId: "00000000-0000-4000-8000-000000000100",
      intentId,
      state: "authorization_submitted",
      authorizationHash: `0x${"de".repeat(32)}`,
      signatureAccepted: true,
      executionEnabled: false,
      nextAction: "settlement_not_enabled",
      submittedAt: "2026-08-20T12:04:00.000Z",
    });
  }
  return request<X402AuthorizationSubmittedView>(`/call-intents/${encodeURIComponent(intentId)}/authorization/signature`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Return a redacted, testnet-only settlement plan. This never calls Circle. */
export function prepareX402ExecutionPlan(intentId: string): Promise<X402ExecutionPlanView> {
  if (AGON_PREVIEW_MODE) {
    const address = `0x${"aa".repeat(20)}` as `0x${string}`;
    return Promise.resolve({
      receiptId: "00000000-0000-4000-8000-000000000100",
      intentId,
      state: "authorization_submitted",
      plan: {
        testnetOnly: true,
        facilitatorUrl: "https://gateway-api-testnet.circle.com",
        settlementEndpoint: "https://gateway-api-testnet.circle.com/v1/x402/settle",
        requirements: {
          scheme: "exact",
          network: "eip155:5042002",
          asset: address,
          amount: "1000",
          payTo: address,
          maxTimeoutSeconds: 604900,
          extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: address },
        },
        authorizationHash: `0x${"de".repeat(32)}`,
        planHash: `0x${"ef".repeat(32)}`,
        paymentPayloadPreview: {
          x402Version: 2,
          payload: {
            authorization: { from: address, to: address, value: "1000", validAfter: "1787240000", validBefore: "1787844900", nonce: `0x${"bb".repeat(32)}` },
            signatureHash: `0x${"de".repeat(32)}`,
            signature: null,
          },
        },
        executionEnabled: false,
        nextAction: "explicit_execution_approval",
      },
      executionEnabled: false,
      nextAction: "explicit_execution_approval",
      preparedAt: "2026-08-20T12:05:00.000Z",
    });
  }
  return request<X402ExecutionPlanView>(`/call-intents/${encodeURIComponent(intentId)}/execution-plan`, { method: "POST" });
}

export function approveX402Execution(intentId: string, body: X402ExecutionApprovalRequest): Promise<X402ExecutionApprovalView> {
  if (AGON_PREVIEW_MODE) {
    return prepareX402ExecutionPlan(intentId).then((plan) => ({
      approvalHash: `0x${"fa".repeat(32)}`,
      receiptId: plan.receiptId,
      intentId,
      actor: plan.plan.paymentPayloadPreview.payload.authorization.from,
      planHash: plan.plan.planHash,
      authorizationHash: plan.plan.authorizationHash,
      approvalIdempotencyKey: body.approvalIdempotencyKey,
      testnetOnly: true as const,
      approvedAt: "2026-08-20T12:06:00.000Z",
      expiresAt: "2026-08-27T12:11:00.000Z",
      executionEnabled: false as const,
      nextAction: "execution_adapter_not_enabled" as const,
    }));
  }
  return request<X402ExecutionApprovalView>(`/call-intents/${encodeURIComponent(intentId)}/execution-approval`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Inspect approval and adapter state without contacting Circle or settling. */
export function getX402ExecutionReadiness(intentId: string): Promise<X402ExecutionReadinessView> {
  if (AGON_PREVIEW_MODE) {
    return prepareX402ExecutionPlan(intentId).then((plan) => ({
      receiptId: plan.receiptId,
      intentId,
      state: "authorization_submitted" as const,
      plan: plan.plan,
      approval: null,
      status: "approval_required" as const,
      reason: "Execution approval is required before a settlement adapter can be considered.",
      executionEnabled: false as const,
      nextAction: "explicit_execution_approval" as const,
      checkedAt: new Date().toISOString(),
    }));
  }
  return request<X402ExecutionReadinessView>(`/call-intents/${encodeURIComponent(intentId)}/execution-readiness`, { method: "GET" });
}

/** Inspect durable settlement state without contacting Circle or settling. */
export function getX402SettlementReadiness(intentId: string): Promise<X402SettlementReadinessView> {
  if (AGON_PREVIEW_MODE) {
    return Promise.resolve({
      receiptId: "00000000-0000-4000-8000-000000000100",
      intentId,
      state: "authorization_submitted",
      network: "eip155:5042002",
      settlementRef: null,
      providerTransferId: null,
      status: "ready_but_disabled",
      reason: "Authorization is valid, but Circle settlement is disabled by policy.",
      executionEnabled: false,
      nextAction: "execution_adapter_not_enabled",
      checkedAt: new Date().toISOString(),
    });
  }
  return request<X402SettlementReadinessView>(`/call-intents/${encodeURIComponent(intentId)}/settlement-readiness`, { method: "GET" });
}

/** Inspect whether a provider receipt lookup is available; this never calls a provider. */
export function getX402ReconciliationReadiness(intentId: string): Promise<X402ReconciliationReadinessView> {
  if (AGON_PREVIEW_MODE) {
    return Promise.resolve({
      receiptId: "00000000-0000-4000-8000-000000000100",
      intentId,
      state: "authorization_submitted",
      network: "eip155:5042002",
      transaction: null,
      providerTransferId: null,
      status: "not_required",
      reason: "Complete authorization before a provider receipt lookup is required.",
      lookupEnabled: false,
      executionEnabled: false,
      nextAction: "complete_authorization",
      checkedAt: new Date().toISOString(),
    });
  }
  return request<X402ReconciliationReadinessView>(`/call-intents/${encodeURIComponent(intentId)}/reconciliation-readiness`, { method: "GET" });
}

/** Verify a wallet signature with Circle without settling or claiming delivery. */
export function verifyX402Facilitator(
  intentId: string,
  body: X402FacilitatorVerificationRequest,
): Promise<X402FacilitatorVerificationView> {
  if (AGON_PREVIEW_MODE) {
    return Promise.resolve({
      receiptId: "00000000-0000-4000-8000-000000000100",
      intentId,
      state: "facilitator_verified",
      network: "eip155:5042002",
      payer: `0x${"aa".repeat(20)}`,
      approvalHash: `0x${"fa".repeat(32)}`,
      evidenceHash: `0x${"fb".repeat(32)}`,
      verified: true,
      executionEnabled: false,
      nextAction: "settlement_remains_disabled",
      verifiedAt: new Date().toISOString(),
    });
  }
  return request<X402FacilitatorVerificationView>(`/call-intents/${encodeURIComponent(intentId)}/facilitator-verify`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getX402FacilitatorVerification(intentId: string): Promise<X402FacilitatorVerificationView> {
  if (AGON_PREVIEW_MODE) {
    return Promise.reject(new AgonApiError("receipt_unavailable", "No facilitator verification is recorded in this preview fixture.", 409));
  }
  return request<X402FacilitatorVerificationView>(`/call-intents/${encodeURIComponent(intentId)}/facilitator-verification`, { method: "GET" });
}
