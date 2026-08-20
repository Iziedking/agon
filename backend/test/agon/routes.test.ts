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
  code: "not_found" | "not_owner" | "conflict" | "capability_unavailable";
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
