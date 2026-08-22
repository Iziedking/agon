import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import {
  createAgonRoutes,
  type AgonMarketService,
  type AgonRouteVariables,
} from "../../src/agon/http/routes.ts";
import type {
  AgonCapabilities,
  AgonListingView,
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
  X402AuthorizationView,
  X402AuthorizationSignatureRequest,
  X402AuthorizationSubmittedView,
  X402ExecutionPlanView,
  X402ExecutionApprovalRequest,
  X402ExecutionApprovalView,
  X402ExecutionReadinessView,
  X402SettlementReadinessView,
  X402SettlementRequest,
  X402SettlementView,
  X402ReconciliationReadinessView,
  X402FacilitatorVerificationRequest,
  X402FacilitatorVerificationView,
  AgonEscrowIntentRequest,
  AgonEscrowIntentView,
  AgonEscrowReadinessView,
} from "../../src/agon/http/api-types.ts";
import type { Result } from "../../src/agon/core/result.ts";

const ADDRESS = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REGISTRY = "0x3333333333333333333333333333333333333333";
const SERVICE_KEY = `0x${"44".repeat(32)}`;
const MANIFEST_HASH = `0x${"55".repeat(32)}`;

const listing: AgonListingView = {
  id: `5042002:${REGISTRY}:1`,
  chainId: "5042002",
  serviceRegistry: REGISTRY,
  listingId: "1",
  agentId: "42",
  serviceKey: SERVICE_KEY,
  category: "1",
  version: "1",
  manifest: { hash: MANIFEST_HASH, uri: "ipfs://manifest-v1" },
  providerSnapshot: ADDRESS,
  status: "Listed",
  verification: {
    status: "Unverified",
    scope: { agentId: "42", listingId: "1", version: "1", category: "1" },
  },
  risk: {
    unverified: true,
    warning: "This service has not passed Agon Arena verification.",
    quarantineReason: null,
  },
  endpointQa: {
    status: "not_checked",
    checkedAt: null,
    endpointStatus: null,
    evidenceHash: null,
    reason: "Agon has not run endpoint verification for this listing yet.",
    attempts: 0,
    passedAttempts: 0,
    successRate: null,
  },
  payment: { rail: "X402", directX402: true, escrowEligible: false },
  provenance: {
    sourceBlockNumber: "100",
    sourceTxHash: `0x${"66".repeat(32)}`,
    sourceLogIndex: 0,
  },
};

const capabilities: AgonCapabilities = {
  identityReads: true,
  profileWrites: false,
  listingReads: true,
  listingWrites: false,
  endpointQa: false,
  directX402: false,
  escrow: false,
  writeReadiness: { checkedAt: null, reasons: ["adapter_unconfigured"] },
};

function preparedOperation(operationId: string): SubmittedOperation {
  return {
    operationId,
    state: "prepared",
    transaction: {
      chainId: "5042002",
      to: REGISTRY,
      data: "0x1234",
      functionName: "publish",
      args: ["42", SERVICE_KEY, MANIFEST_HASH, "ipfs://manifest-v1", "1", "0"],
    },
    txHash: null,
    resultReference: null,
    proof: null,
  };
}

type ServiceError = {
  code: "not_found" | "not_owner" | "conflict" | "capability_unavailable" | "execution_not_ready";
  message: string;
};

class FakeAgonService implements AgonMarketService {
  lastQuery: ListingQuery | null = null;
  bindResult: Result<SubmittedOperation, ServiceError> = {
    ok: true,
    value: preparedOperation("bind-1"),
  };
  publishResult: Result<SubmittedOperation, ServiceError> = {
    ok: true,
    value: preparedOperation("publish-1"),
  };

  async listListings(query: ListingQuery): Promise<Result<ListingPage, ServiceError>> {
    this.lastQuery = query;
    return { ok: true, value: { items: [listing], nextCursor: "cursor-next" } };
  }

  async getListing(reference: string): Promise<Result<AgonListingView, ServiceError>> {
    return reference === listing.id
      ? { ok: true, value: listing }
      : { ok: false, error: { code: "not_found", message: "listing not found" } };
  }

  async bindProfile(
    _actor: string,
    _request: BindProfileRequest,
  ): Promise<Result<SubmittedOperation, ServiceError>> {
    return this.bindResult;
  }

  async publishListing(
    _actor: string,
    _request: PublishListingRequest,
  ): Promise<Result<SubmittedOperation, ServiceError>> {
    return this.publishResult;
  }

  async confirmOperation(
    _actor: string,
    operationId: string,
    txHash: `0x${string}`,
  ): Promise<Result<SubmittedOperation, ServiceError>> {
    const operation = preparedOperation(operationId);
    return {
      ok: true,
      value: {
        ...operation,
        state: "confirmed",
        txHash,
        proof: { blockNumber: "123", logIndex: 7 },
      },
    };
  }

  async prepareX402Call(
    _actor: string,
    _reference: string,
    _request: X402CallIntentRequest,
  ): Promise<Result<X402CallIntentView, ServiceError>> {
    return {
      ok: true,
      value: {
        intentId: "00000000-0000-4000-8000-000000000001",
        actor: ADDRESS,
        idempotencyKey: "review-001",
        listingReference: listing.id,
        listingVersion: listing.version,
        inputHash: `0x${"77".repeat(32)}`,
        maxAmountUSDC: "0.01",
        state: "prepared",
        executionEnabled: false,
        nextAction: "execution_adapter_not_enabled",
        createdAt: "2026-08-20T10:00:00.000Z",
      },
    };
  }

  async approveX402Call(
    _actor: string,
    _intentId: string,
    request: X402ApprovalRequest,
  ): Promise<Result<X402ApprovalView, ServiceError>> {
    return {
      ok: true,
      value: {
        receiptId: "00000000-0000-4000-8000-000000000002",
        intentId: "00000000-0000-4000-8000-000000000001",
        actor: ADDRESS,
        state: "approved",
        approvedAmountUSDC: request.approvedAmountUSDC,
        executionEnabled: false,
        nextAction: "payment_adapter_not_enabled",
        approvedAt: "2026-08-20T10:01:00.000Z",
      },
    };
  }

  async captureX402Quote(
    _actor: string,
    intentId: string,
  ): Promise<Result<X402QuoteView, ServiceError>> {
    return {
      ok: true,
      value: {
        receiptId: "00000000-0000-4000-8000-000000000002",
        intentId,
        state: "payment_required",
        status: 402,
        targetUrl: "https://provider.example/x402",
        quoteHash: `0x${"88".repeat(32)}`,
        x402Version: 2,
        resource: { url: "https://provider.example/x402", description: null, mimeType: "application/json" },
        accepts: [{ scheme: "exact", network: "eip155:5042002", asset: `0x${"11".repeat(20)}`, amount: "0.001", payTo: ADDRESS, maxTimeoutSeconds: 600, gateway: true }],
        executionEnabled: false,
        nextAction: "authorization_not_enabled",
        capturedAt: "2026-08-20T10:02:00.000Z",
      },
    };
  }

  async prepareX402Authorization(
    _actor: string,
    intentId: string,
  ): Promise<Result<X402AuthorizationView, ServiceError>> {
    return {
      ok: true,
      value: {
        receiptId: "00000000-0000-4000-8000-000000000002",
        intentId,
        state: "authorization_ready",
        payloadHash: `0x${"99".repeat(32)}`,
        payload: {
          x402Version: 2,
          domain: { name: "GatewayWalletBatched", version: "1", chainId: 5042002, verifyingContract: ADDRESS },
          types: { TransferWithAuthorization: [{ name: "from", type: "address" }] },
          primaryType: "TransferWithAuthorization",
          message: { from: ADDRESS, to: ADDRESS, value: "1000", validAfter: "1", validBefore: "2", nonce: `0x${"aa".repeat(32)}` },
        },
        expiresAt: "2026-08-27T10:00:00.000Z",
        executionEnabled: false,
        nextAction: "user_signature_required",
        preparedAt: "2026-08-20T10:03:00.000Z",
      },
    };
  }

  async submitX402Authorization(
    _actor: string,
    intentId: string,
    _request: X402AuthorizationSignatureRequest,
  ): Promise<Result<X402AuthorizationSubmittedView, ServiceError>> {
    return {
      ok: true,
      value: {
        receiptId: "00000000-0000-4000-8000-000000000002",
        intentId,
        state: "authorization_submitted",
        authorizationHash: `0x${"ab".repeat(32)}`,
        signatureAccepted: true,
        executionEnabled: false,
        nextAction: "settlement_not_enabled",
        submittedAt: "2026-08-20T10:04:00.000Z",
      },
    };
  }

  async prepareX402ExecutionPlan(
    _actor: string,
    intentId: string,
  ): Promise<Result<X402ExecutionPlanView, ServiceError>> {
    return {
      ok: true,
      value: {
        receiptId: "00000000-0000-4000-8000-000000000002",
        intentId,
        state: "authorization_submitted",
        plan: {
          testnetOnly: true,
          facilitatorUrl: "https://gateway-api-testnet.circle.com",
          settlementEndpoint: "https://gateway-api-testnet.circle.com/v1/x402/settle",
          requirements: {
            scheme: "exact",
            network: "eip155:5042002",
            asset: `0x${"11".repeat(20)}`,
            amount: "1000",
            payTo: ADDRESS,
            maxTimeoutSeconds: 604900,
            extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: ADDRESS },
          },
          authorization: { from: ADDRESS, to: ADDRESS, value: "1000", validAfter: "1", validBefore: "2", nonce: `0x${"aa".repeat(32)}` },
          authorizationHash: `0x${"ab".repeat(32)}`,
          planHash: `0x${"cd".repeat(32)}`,
          paymentPayloadPreview: {
            x402Version: 2,
            payload: {
              authorization: { from: ADDRESS, to: ADDRESS, value: "1000", validAfter: "1", validBefore: "2", nonce: `0x${"aa".repeat(32)}` },
              signatureHash: `0x${"ab".repeat(32)}`,
              signature: null,
            },
          },
          executionEnabled: false,
          nextAction: "explicit_execution_approval",
        },
        executionEnabled: false,
        nextAction: "explicit_execution_approval",
        preparedAt: "2026-08-20T10:05:00.000Z",
      },
    };
  }

  async approveX402Execution(
    _actor: string,
    intentId: string,
    _request: X402ExecutionApprovalRequest,
  ): Promise<Result<X402ExecutionApprovalView, ServiceError>> {
    return {
      ok: true,
      value: {
        approvalHash: `0x${"ee".repeat(32)}`,
        receiptId: "00000000-0000-4000-8000-000000000002",
        intentId,
        actor: ADDRESS,
        planHash: `0x${"cd".repeat(32)}`,
        authorizationHash: `0x${"ab".repeat(32)}`,
        approvalIdempotencyKey: "approval-001",
        testnetOnly: true,
        approvedAt: "2026-08-20T10:06:00.000Z",
        expiresAt: "2026-08-20T10:11:00.000Z",
        executionEnabled: false,
        nextAction: "execution_adapter_not_enabled",
      },
    };
  }

  async getX402ExecutionReadiness(
    _actor: string,
    intentId: string,
  ): Promise<Result<X402ExecutionReadinessView, ServiceError>> {
    const plan = await this.prepareX402ExecutionPlan("", intentId);
    if (!plan.ok) return plan;
    return {
      ok: true,
      value: {
        receiptId: "00000000-0000-4000-8000-000000000002",
        intentId,
        state: "authorization_submitted",
        plan: plan.value.plan,
        approval: null,
        status: "approval_required",
        reason: "Execution approval is required before a settlement adapter can be considered.",
        executionEnabled: false,
        nextAction: "explicit_execution_approval",
        checkedAt: "2026-08-20T10:07:00.000Z",
      },
    };
  }

  async getX402SettlementReadiness(
    _actor: string,
    intentId: string,
  ) {
    return {
      ok: true as const,
      value: {
        receiptId: "00000000-0000-4000-8000-000000000002",
        intentId,
        state: "authorization_submitted" as const,
        network: "eip155:5042002" as const,
        settlementRef: null,
        status: "ready_but_disabled" as const,
        reason: "Authorization is valid, but Circle settlement is disabled by policy.",
        executionEnabled: false as const,
        nextAction: "execution_adapter_not_enabled" as const,
        checkedAt: new Date().toISOString(),
      },
    };
  }

  async settleX402Call(
    _actor: string,
    _intentId: string,
    _request: X402SettlementRequest,
  ): Promise<Result<X402SettlementView, ServiceError>> {
    return { ok: false, error: { code: "execution_not_ready", message: "Circle x402 settlement is disabled by policy" } };
  }

  async getX402ReconciliationReadiness(
    _actor: string,
    intentId: string,
  ): Promise<Result<X402ReconciliationReadinessView, ServiceError>> {
    return {
      ok: true,
      value: {
        receiptId: "00000000-0000-4000-8000-000000000002",
        intentId,
        state: "unknown",
        network: "eip155:5042002",
        transaction: `0x${"ab".repeat(32)}`,
        status: "lookup_disabled",
        reason: "The read-only provider receipt lookup adapter is disabled.",
        lookupEnabled: false,
        executionEnabled: false,
        nextAction: "enable_receipt_lookup",
        checkedAt: new Date().toISOString(),
      },
    };
  }

  async reconcileX402Receipt(
    _actor: string,
    intentId: string,
    _request: { confirmation: "RECONCILE_ARC_TESTNET_X402" },
  ): Promise<Result<import("../../src/agon/http/api-types.ts").X402ReconciliationView, ServiceError>> {
    return {
      ok: true,
      value: {
        receiptId: "00000000-0000-4000-8000-000000000002",
        intentId,
        state: "settlement_submitted",
        network: "eip155:5042002",
        status: "confirmed",
        transaction: `0x${"ab".repeat(32)}`,
        executionEnabled: false,
        serviceDeliveryPending: true,
        nextAction: "deliver_service",
        recordedAt: new Date().toISOString(),
      },
    };
  }

  async verifyX402Facilitator(
    _actor: string,
    intentId: string,
    _request: X402FacilitatorVerificationRequest,
  ): Promise<Result<X402FacilitatorVerificationView, ServiceError>> {
    return {
      ok: true,
      value: {
        receiptId: "00000000-0000-4000-8000-000000000002",
        intentId,
        state: "facilitator_verified",
        network: "eip155:5042002",
        payer: ADDRESS,
        approvalHash: `0x${"ee".repeat(32)}`,
        evidenceHash: `0x${"ef".repeat(32)}`,
        verified: true,
        executionEnabled: false,
        nextAction: "settlement_remains_disabled",
        verifiedAt: "2026-08-20T10:08:00.000Z",
      },
    };
  }

  async getX402FacilitatorVerification(
    _actor: string,
    intentId: string,
  ): Promise<Result<X402FacilitatorVerificationView, ServiceError>> {
    return {
      ok: true,
      value: {
        receiptId: "00000000-0000-4000-8000-000000000002",
        intentId,
        state: "facilitator_verified",
        network: "eip155:5042002",
        payer: ADDRESS,
        approvalHash: `0x${"ee".repeat(32)}`,
        evidenceHash: `0x${"ef".repeat(32)}`,
        verified: true,
        executionEnabled: false,
        nextAction: "settlement_remains_disabled",
        verifiedAt: "2026-08-20T10:08:00.000Z",
      },
    };
  }

  async prepareAgonEscrowIntent(
    _actor: string,
    request: AgonEscrowIntentRequest,
  ): Promise<Result<AgonEscrowIntentView, ServiceError>> {
    return {
      ok: true,
      value: {
        intentId: "00000000-0000-4000-8000-000000000010",
        actor: ADDRESS,
        idempotencyKey: request.idempotencyKey,
        listingReference: request.listingReference,
        termsHash: `0x${"aa".repeat(32)}`,
        network: "eip155:5042002",
        asset: `0x${"36".repeat(20)}`,
        buyer: ADDRESS,
        beneficiary: ADDRESS,
        listing: { serviceRegistry: REGISTRY, listingId: "1", agentId: "42", version: "1", manifestHash: MANIFEST_HASH },
        amountBaseUnits: request.amountBaseUnits,
        feeBps: request.feeBps,
        expiresAt: request.expiresAt,
        state: "prepared",
        providerReference: null,
        transaction: null,
        executionEnabled: false,
        nextAction: "escrow_adapter_not_enabled",
        createdAt: "2026-08-22T12:00:00.000Z",
        updatedAt: "2026-08-22T12:00:00.000Z",
      },
    };
  }

  async getAgonEscrowIntent(_actor: string, intentId: string): Promise<Result<AgonEscrowIntentView, ServiceError>> {
    const result = await this.prepareAgonEscrowIntent(ADDRESS, {
      listingReference: listing.id,
      idempotencyKey: "escrow-route-001",
      amountBaseUnits: "1000000",
      feeBps: 500,
      expiresAt: "2026-08-23T12:00:00.000Z",
    });
    if (result.ok) result.value.intentId = intentId;
    return result;
  }

  async getAgonEscrowReadiness(_actor: string, intentId: string): Promise<Result<AgonEscrowReadinessView, ServiceError>> {
    return {
      ok: true,
      value: {
        intentId,
        state: "prepared",
        status: "adapter_disabled",
        reason: "Agon escrow execution is disabled",
        executionEnabled: false,
        nextAction: "escrow_adapter_not_enabled",
        checkedAt: "2026-08-22T12:00:00.000Z",
      },
    };
  }

  async getCapabilities(): Promise<AgonCapabilities> {
    return capabilities;
  }
}

const testAuth: MiddlewareHandler<{ Variables: AgonRouteVariables }> = async (context, next) => {
  const address = context.req.header("x-test-address");
  if (!address) return context.json({ error: { code: "unauthorized", message: "unauthorized" } }, 401);
  context.set("address", address.toLowerCase());
  await next();
};

function testApp(service: AgonMarketService) {
  const app = new Hono<{ Variables: AgonRouteVariables }>();
  app.route("/agon", createAgonRoutes({ service, requireAuth: testAuth }));
  return app;
}

test("returns public listings with explicit unverified payment risk", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/listings");
  assert.equal(response.status, 200);
  const body = (await response.json()) as ListingPage;
  assert.equal(body.items[0]?.verification.status, "Unverified");
  assert.equal(body.items[0]?.risk.unverified, true);
  assert.equal(body.items[0]?.payment.directX402, true);
  assert.equal(body.items[0]?.payment.escrowEligible, false);
});

test("supports stable cursor pagination and category or agent filters", async () => {
  const service = new FakeAgonService();
  const app = testApp(service);
  const response = await app.request("/agon/listings?limit=10&cursor=cursor-1&category=7&agentId=42");
  assert.equal(response.status, 200);
  assert.deepEqual(service.lastQuery, {
    limit: 10,
    cursor: "cursor-1",
    category: "7",
    agentId: "42",
  });

  await app.request("/agon/categories/9/listings");
  assert.equal(service.lastQuery?.category, "9");
  await app.request("/agon/agents/77/listings");
  assert.equal(service.lastQuery?.agentId, "77");
});

test("returns listing detail and a typed not-found response", async () => {
  const app = testApp(new FakeAgonService());
  const found = await app.request(`/agon/listings/${encodeURIComponent(listing.id)}`);
  assert.equal(found.status, 200);
  assert.equal(((await found.json()) as AgonListingView).id, listing.id);

  const missing = await app.request("/agon/listings/missing");
  assert.equal(missing.status, 404);
  assert.equal(((await missing.json()) as { error: { code: string } }).error.code, "not_found");
});

test("requires authentication for profile binding and listing publication", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/profiles/bind", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chainId: "5042002", agentId: "42", metadataUri: "ipfs://profile" }),
  });
  assert.equal(response.status, 401);
});

test("validates authenticated write payloads with path-specific issues", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/listings", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ chainId: "0", agentId: "x", manifestHash: "bad" }),
  });
  assert.equal(response.status, 400);
  const body = (await response.json()) as { error: { code: string; issues: Array<{ path: string[] }> } };
  assert.equal(body.error.code, "invalid_request");
  assert(body.error.issues.some((issue) => issue.path.join(".") === "chainId"));
  assert(body.error.issues.some((issue) => issue.path.join(".") === "manifestHash"));
});

test("maps owner refusal and unavailable contract capability honestly", async () => {
  const service = new FakeAgonService();
  const app = testApp(service);
  service.bindResult = { ok: false, error: { code: "not_owner", message: "not identity owner" } };
  const refused = await app.request("/agon/profiles/bind", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ chainId: "5042002", agentId: "42", metadataUri: "ipfs://profile" }),
  });
  assert.equal(refused.status, 403);

  service.publishResult = {
    ok: false,
    error: { code: "capability_unavailable", message: "listing writes are unavailable" },
  };
  const unavailable = await app.request("/agon/listings", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({
      chainId: "5042002",
      agentId: "42",
      serviceKey: SERVICE_KEY,
      manifestHash: MANIFEST_HASH,
      manifestUri: "ipfs://manifest-v1",
      category: "1",
      paymentRail: "X402",
    }),
  });
  assert.equal(unavailable.status, 503);
  assert.equal(
    ((await unavailable.json()) as { error: { code: string } }).error.code,
    "capability_unavailable",
  );
});

test("reports granular Agon capabilities and keeps escrow disabled", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/health");
  assert.equal(response.status, 200);
  const body = (await response.json()) as { ok: boolean; capabilities: AgonCapabilities };
  assert.equal(body.ok, true);
  assert.equal(body.capabilities.listingReads, true);
  assert.equal(body.capabilities.listingWrites, false);
  assert.equal(body.capabilities.escrow, false);
  assert.deepEqual(body.capabilities.writeReadiness.reasons, ["adapter_unconfigured"]);
});

test("confirms a prepared operation with a validated transaction hash", async () => {
  const app = testApp(new FakeAgonService());
  const txHash = `0x${"77".repeat(32)}`;
  const response = await app.request("/agon/operations/op-1/confirm", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ txHash }),
  });
  assert.equal(response.status, 200);
  const operation = (await response.json()) as SubmittedOperation;
  assert.equal(operation.state, "confirmed");
  assert.equal(operation.txHash, txHash);
});

test("requires authentication and strict validation for Agon escrow preparation", async () => {
  const app = testApp(new FakeAgonService());
  const unauthenticated = await app.request("/agon/escrow/intents", { method: "POST", body: "{}" });
  assert.equal(unauthenticated.status, 401);
  const invalid = await app.request("/agon/escrow/intents", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ listingReference: listing.id, idempotencyKey: "short", amountBaseUnits: "0", feeBps: 1001, expiresAt: "not-a-date" }),
  });
  assert.equal(invalid.status, 400);
});

test("prepares and reads an escrow intent without enabling execution", async () => {
  const app = testApp(new FakeAgonService());
  const prepared = await app.request("/agon/escrow/intents", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ listingReference: listing.id, idempotencyKey: "escrow-route-001", amountBaseUnits: "1000000", feeBps: 500, expiresAt: "2026-08-23T12:00:00.000Z" }),
  });
  assert.equal(prepared.status, 201);
  const body = (await prepared.json()) as AgonEscrowIntentView;
  assert.equal(body.state, "prepared");
  assert.equal(body.executionEnabled, false);
  assert.equal(body.nextAction, "escrow_adapter_not_enabled");

  const readiness = await app.request(`/agon/escrow/intents/${body.intentId}/readiness`, { headers: { "x-test-address": ADDRESS } });
  assert.equal(readiness.status, 200);
  assert.equal(((await readiness.json()) as AgonEscrowReadinessView).status, "adapter_disabled");
});

test("requires authentication and exact confirmation for escrow lifecycle routes", async () => {
  const app = testApp(new FakeAgonService());
  const unauthenticated = await app.request("/agon/escrow/intents/00000000-0000-4000-8000-000000000001/fund", {
    method: "POST",
    body: JSON.stringify({ confirmation: "FUND_ARC_TESTNET_ESCROW" }),
  });
  assert.equal(unauthenticated.status, 401);

  const invalid = await app.request("/agon/escrow/intents/00000000-0000-4000-8000-000000000001/fund", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ confirmation: "EXECUTE_ARC_TESTNET_X402" }),
  });
  assert.equal(invalid.status, 400);
  assert.equal(((await invalid.json()) as { error: { code: string } }).error.code, "invalid_request");
});

test("disabled escrow lifecycle routes fail closed before an adapter exists", async () => {
  const app = testApp(new FakeAgonService());
  for (const action of ["fund", "release", "refund"] as const) {
    const confirmation = `${action.toUpperCase()}_ARC_TESTNET_ESCROW`;
    const response = await app.request(`/agon/escrow/intents/00000000-0000-4000-8000-000000000001/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-address": ADDRESS },
      body: JSON.stringify({ confirmation }),
    });
    assert.equal(response.status, 503);
    assert.equal(((await response.json()) as { error: { code: string } }).error.code, "escrow_disabled");
  }
});

test("escrow transaction approval routes require auth and fail closed without service wiring", async () => {
  const app = testApp(new FakeAgonService());
  const unauthenticated = await app.request("/agon/escrow/intents/00000000-0000-4000-8000-000000000001/transaction-approval", {
    method: "POST",
    body: JSON.stringify({ operation: "fund", approvalIdempotencyKey: "approval-route-001", confirmation: "APPROVE_FUND_ARC_TESTNET_ESCROW" }),
  });
  assert.equal(unauthenticated.status, 401);
  const invalid = await app.request("/agon/escrow/intents/00000000-0000-4000-8000-000000000001/transaction-approval", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ operation: "fund", approvalIdempotencyKey: "short", confirmation: "APPROVE_FUND_ARC_TESTNET_ESCROW" }),
  });
  assert.equal(invalid.status, 400);
  const disabled = await app.request("/agon/escrow/intents/00000000-0000-4000-8000-000000000001/transaction-approval", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ operation: "fund", approvalIdempotencyKey: "approval-route-001", confirmation: "APPROVE_FUND_ARC_TESTNET_ESCROW" }),
  });
  assert.equal(disabled.status, 409);
  assert.equal(((await disabled.json()) as { error: { code: string } }).error.code, "execution_not_ready");
  const readiness = await app.request("/agon/escrow/intents/00000000-0000-4000-8000-000000000001/transaction-approval", {
    headers: { "x-test-address": ADDRESS },
  });
  assert.equal(readiness.status, 409);
});

test("requires authentication before preparing an x402 call intent", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request(`/agon/listings/${encodeURIComponent(listing.id)}/call-intents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idempotencyKey: "review-001", method: "POST", input: {}, maxAmountUSDC: "0.01" }),
  });
  assert.equal(response.status, 401);
});

test("returns a durable execution-disabled x402 intent after auth", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request(`/agon/listings/${encodeURIComponent(listing.id)}/call-intents`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ idempotencyKey: "review-001", method: "POST", input: { prompt: "audit" }, maxAmountUSDC: "0.01" }),
  });
  assert.equal(response.status, 201);
  const body = (await response.json()) as X402CallIntentView;
  assert.equal(body.state, "prepared");
  assert.equal(body.executionEnabled, false);
  assert.equal(body.nextAction, "execution_adapter_not_enabled");
});

test("requires authentication before approving an x402 spend", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ approvedAmountUSDC: "0.01" }),
  });
  assert.equal(response.status, 401);
});

test("returns an execution-disabled approval after authentication", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/approve", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ approvedAmountUSDC: "0.01" }),
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as X402ApprovalView;
  assert.equal(body.state, "approved");
  assert.equal(body.approvedAmountUSDC, "0.01");
  assert.equal(body.executionEnabled, false);
  assert.equal(body.nextAction, "payment_adapter_not_enabled");
});

test("requires authentication before capturing a provider payment quote", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/payment-required", { method: "POST" });
  assert.equal(response.status, 401);
});

test("returns a non-spending HTTP 402 quote after authentication", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/payment-required", {
    method: "POST",
    headers: { "x-test-address": ADDRESS },
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as X402QuoteView;
  assert.equal(body.status, 402);
  assert.equal(body.executionEnabled, false);
  assert.equal(body.nextAction, "authorization_not_enabled");
});

test("returns a reviewable unsigned authorization payload after authentication", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/authorization", {
    method: "POST",
    headers: { "x-test-address": ADDRESS },
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as X402AuthorizationView;
  assert.equal(body.state, "authorization_ready");
  assert.equal(body.executionEnabled, false);
  assert.equal(body.nextAction, "user_signature_required");
});

test("requires authentication before accepting an authorization signature", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/authorization/signature", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ payloadHash: `0x${"99".repeat(32)}`, signature: `0x${"11".repeat(65)}` }),
  });
  assert.equal(response.status, 401);
});

test("records a validated signature handoff without enabling settlement", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/authorization/signature", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ payloadHash: `0x${"99".repeat(32)}`, signature: `0x${"11".repeat(65)}` }),
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as X402AuthorizationSubmittedView;
  assert.equal(body.state, "authorization_submitted");
  assert.equal(body.signatureAccepted, true);
  assert.equal(body.executionEnabled, false);
  assert.equal(body.nextAction, "settlement_not_enabled");
});

test("returns a testnet-only redacted execution plan after signature handoff", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/execution-plan", {
    method: "POST",
    headers: { "x-test-address": ADDRESS },
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as X402ExecutionPlanView;
  assert.equal(body.plan.testnetOnly, true);
  assert.equal(body.plan.requirements.network, "eip155:5042002");
  assert.equal(body.plan.paymentPayloadPreview.payload.signature, null);
  assert.equal(body.executionEnabled, false);
  assert.equal(body.nextAction, "explicit_execution_approval");
});

test("records explicit execution approval without enabling settlement", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/execution-approval", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ planHash: `0x${"cd".repeat(32)}`, approvalIdempotencyKey: "approval-001", confirmation: "APPROVE_ARC_TESTNET_X402" }),
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as X402ExecutionApprovalView;
  assert.equal(body.testnetOnly, true);
  assert.equal(body.executionEnabled, false);
  assert.equal(body.nextAction, "execution_adapter_not_enabled");
});

test("returns disabled execution readiness without calling Circle", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/execution-readiness", {
    method: "GET",
    headers: { "x-test-address": ADDRESS },
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as X402ExecutionReadinessView;
  assert.equal(body.status, "approval_required");
  assert.equal(body.approval, null);
  assert.equal(body.executionEnabled, false);
  assert.equal(body.nextAction, "explicit_execution_approval");
});

test("returns authenticated settlement readiness without enabling Circle", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/settlement-readiness", {
    headers: { "x-test-address": ADDRESS },
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as X402SettlementReadinessView;
  assert.equal(body.state, "authorization_submitted");
  assert.equal(body.network, "eip155:5042002");
  assert.equal(body.settlementRef, null);
  assert.equal(body.status, "ready_but_disabled");
  assert.equal(body.executionEnabled, false);
  assert.equal(body.nextAction, "execution_adapter_not_enabled");
});

test("keeps settlement submission behind authentication, strict signature validation, and the kill switch", async () => {
  const app = testApp(new FakeAgonService());
  const unauthenticated = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/settle", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signature: `0x${"11".repeat(65)}`, confirmation: "EXECUTE_ARC_TESTNET_X402" }),
  });
  assert.equal(unauthenticated.status, 401);
  const invalid = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/settle", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ signature: "0x12", confirmation: "EXECUTE_ARC_TESTNET_X402" }),
  });
  assert.equal(invalid.status, 400);
  const disabled = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/settle", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ signature: `0x${"11".repeat(65)}`, confirmation: "EXECUTE_ARC_TESTNET_X402" }),
  });
  assert.equal(disabled.status, 409);
  const body = await disabled.json() as { error: { code: string } };
  assert.equal(body.error.code, "execution_not_ready");
});

test("returns authenticated reconciliation readiness without enabling a provider lookup", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/reconciliation-readiness", {
    headers: { "x-test-address": ADDRESS },
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as X402ReconciliationReadinessView;
  assert.equal(body.status, "lookup_disabled");
  assert.equal(body.network, "eip155:5042002");
  assert.equal(body.lookupEnabled, false);
  assert.equal(body.executionEnabled, false);
  assert.equal(body.nextAction, "enable_receipt_lookup");
});

test("keeps reconciliation mutation behind authentication and explicit confirmation", async () => {
  const app = testApp(new FakeAgonService());
  const unauthenticated = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/reconcile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirmation: "RECONCILE_ARC_TESTNET_X402" }),
  });
  assert.equal(unauthenticated.status, 401);
  const invalid = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/reconcile", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ confirmation: "RECONCILE" }),
  });
  assert.equal(invalid.status, 400);
  const response = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/reconcile", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ confirmation: "RECONCILE_ARC_TESTNET_X402" }),
  });
  assert.equal(response.status, 200);
  const body = await response.json() as { executionEnabled: boolean; nextAction: string };
  assert.equal(body.executionEnabled, false);
  assert.equal(body.nextAction, "deliver_service");
});

test("requires authentication before facilitator verification", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/facilitator-verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signature: `0x${"11".repeat(65)}`, confirmation: "VERIFY_ARC_TESTNET_X402" }),
  });
  assert.equal(response.status, 401);
});

test("returns durable facilitator verification evidence and never settlement permission", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/facilitator-verify", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ signature: `0x${"11".repeat(65)}`, confirmation: "VERIFY_ARC_TESTNET_X402" }),
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as X402FacilitatorVerificationView;
  assert.equal(body.state, "facilitator_verified");
  assert.equal(body.verified, true);
  assert.equal(body.executionEnabled, false);
  assert.equal(body.nextAction, "settlement_remains_disabled");
  assert.match(body.evidenceHash, /^0x[0-9a-f]{64}$/);
});

test("reads facilitator verification evidence through the authenticated owner path", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/facilitator-verification", {
    headers: { "x-test-address": ADDRESS },
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as X402FacilitatorVerificationView;
  assert.equal(body.state, "facilitator_verified");
  assert.match(body.evidenceHash, /^0x[0-9a-f]{64}$/);
});
