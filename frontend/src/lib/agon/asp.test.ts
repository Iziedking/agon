import assert from "node:assert/strict";
import test from "node:test";

import {
  AspCommandError,
  confirmAspOperation,
  evaluateAspListing,
  executeCircleAspOperation,
  inspectAspListing,
  prepareAspListingVersion,
  prepareAspListing,
  publishAspListing,
  publishAspListingVersion,
  requestAspVerification,
  verifyAspManifest,
} from "./asp.ts";
import type { SubmittedOperation } from "./types.ts";

const preparedOperation: SubmittedOperation = {
  operationId: "op_123",
  state: "prepared" as const,
  transaction: {
    chainId: "5042002",
    to: "0x2144C156B0a4581da2D046C2E41AC41C6C3938CB",
    data: "0x1234",
    functionName: "publish" as const,
    args: ["42", `0x${"22".repeat(32)}`, `0x${"33".repeat(32)}`, "ipfs://manifest", "8", "0"],
  },
  txHash: null,
  resultReference: null,
  proof: null,
};

const config = {
  chainId: "5042002",
  agentId: "42",
  serviceKey: "protocol-security-review",
  manifestUri: "ipfs://bafybeigdyrzt/manifest.json",
  name: "Protocol security review",
  description: "Reviews smart contracts and returns prioritized findings.",
  category: "verification",
  endpoint: "https://agent.example.com/review",
  tags: ["security", "solidity"],
  amountUSDC: "0.01",
};

const listingBase = {
  id: "5042002:0x1111111111111111111111111111111111111111:7",
  chainId: "5042002",
  serviceRegistry: "0x1111111111111111111111111111111111111111",
  listingId: "7",
  agentId: "42",
  serviceKey: `0x${"22".repeat(32)}`,
  category: "8",
  version: "1",
  manifest: {
    hash: `0x${"00".repeat(32)}`,
    uri: config.manifestUri,
  },
  providerSnapshot: "0x3333333333333333333333333333333333333333",
  status: "Listed" as const,
  verification: {
    status: "Unverified" as const,
    scope: { agentId: "42", listingId: "7", version: "1", category: "8" },
  },
  risk: {
    unverified: true,
    warning: "This service has not passed Agon Arena verification.",
    quarantineReason: null,
  },
  endpointQa: {
    status: "passed" as const,
    checkedAt: "2026-08-20T08:00:00.000Z",
    endpointStatus: 402,
    evidenceHash: `0x${"a1".repeat(32)}`,
    reason: "Agon observed the service endpoint returning HTTP 402.",
    attempts: 1,
    passedAttempts: 1,
    successRate: 100,
  },
  payment: { rail: "X402" as const, directX402: true, escrowEligible: false },
  provenance: {
    sourceBlockNumber: "9001",
    sourceTxHash: `0x${"44".repeat(32)}`,
    sourceLogIndex: 2,
  },
};

test("prepares the exact x402 manifest and listing payload from marketplace language", () => {
  const prepared = prepareAspListing(config);

  assert.deepEqual(prepared.manifest, {
    name: config.name,
    version: 1,
    description: config.description,
    category: "verification",
    endpoint: config.endpoint,
    tags: config.tags,
    pricing: { rail: "x402", amountUSDC: "0.01" },
  });
  assert.equal(prepared.category.id, "8");
  assert.match(prepared.manifestHash, /^0x[0-9a-f]{64}$/);
  assert.match(prepared.serviceKeyHash, /^0x[0-9a-f]{64}$/);
  assert.deepEqual(prepared.request, {
    chainId: "5042002",
    agentId: "42",
    serviceKey: prepared.serviceKeyHash,
    manifestHash: prepared.manifestHash,
    manifestUri: config.manifestUri,
    category: "8",
    paymentRail: "X402",
  });
  assert.equal(prepared.initialTrustState, "Provider listed");
});

test("accepts category id or label without creating another registry", () => {
  assert.equal(prepareAspListing({ ...config, category: "8" }).category.slug, "verification");
  assert.equal(prepareAspListing({ ...config, category: "Verification" }).category.slug, "verification");
  assert.throws(
    () => prepareAspListing({ ...config, category: "47" }),
    (error: unknown) =>
      error instanceof AspCommandError &&
      error.code === "invalid_config" &&
      error.issues.some((issue) => issue.field === "category"),
  );
});

test("validates and hashes local manifests before publication", () => {
  const prepared = prepareAspListing(config);
  const match = verifyAspManifest(prepared.manifest, prepared.manifestHash);
  const mismatch = verifyAspManifest(prepared.manifest, `0x${"99".repeat(32)}`);
  const invalid = verifyAspManifest({ ...prepared.manifest, endpoint: "http://localhost:3000" });
  const duplicateTags = verifyAspManifest({ ...prepared.manifest, tags: ["security", "security"] });

  assert.equal(match.state, "match");
  assert.equal(match.valid, true);
  assert.equal(mismatch.state, "mismatch");
  assert.equal(mismatch.valid, true);
  assert.equal(invalid.state, "invalid");
  assert.equal(invalid.valid, false);
  assert.equal(duplicateTags.state, "invalid");
  assert.equal(duplicateTags.valid, false);
});

test("prepares an immutable update without changing the agent identity", () => {
  const manifest = {
    ...prepareAspListing(config).manifest,
    version: 2,
  };
  const prepared = prepareAspListingVersion(config, manifest, "7");

  assert.equal(prepared.listingId, "7");
  assert.equal(prepared.version, 2);
  assert.equal(prepared.request.listingId, "7");
  assert.equal(prepared.request.paymentRail, "X402");
  assert.equal(prepared.manifestHash, verifyAspManifest(manifest).recomputedHash);
});

test("rejects an update when config and hosted manifest drift", () => {
  const manifest = { ...prepareAspListing(config).manifest, version: 2, endpoint: "https://other.example.com/run" };
  assert.throws(
    () => prepareAspListingVersion(config, manifest, "7"),
    (error: unknown) => error instanceof AspCommandError && error.code === "manifest_mismatch",
  );
});

test("reports provider-listed and verified evidence without conflating them", () => {
  const prepared = prepareAspListing(config);
  const providerListed = inspectAspListing(
    { ...listingBase, manifest: { ...listingBase.manifest, hash: prepared.manifestHash } },
    prepared.manifest,
  );
  const verified = inspectAspListing(
    {
      ...listingBase,
      manifest: { ...listingBase.manifest, hash: prepared.manifestHash },
      verification: { ...listingBase.verification, status: "Verified" as const },
      risk: { unverified: false, warning: null, quarantineReason: null },
    },
    prepared.manifest,
    listingBase.providerSnapshot,
  );

  assert.equal(providerListed.evidence, "coherent");
  assert.equal(providerListed.trust.state, "unverified");
  assert.equal(providerListed.trust.label, "UNVERIFIED");
  assert.equal(providerListed.payment.directX402, true);
  assert.equal(providerListed.effectivePayment.directX402, true);
  assert.equal(providerListed.effectivePayment.escrow, false);
  assert.equal(verified.evidence, "coherent");
  assert.equal(verified.trust.state, "verified");
  assert.equal(verified.trust.label, "VERIFIED");
});

test("turns raw payment flags off when listing evidence is unsafe", () => {
  const prepared = prepareAspListing(config);
  const quarantined = inspectAspListing({
    ...listingBase,
    manifest: { ...listingBase.manifest, hash: `0x${"99".repeat(32)}` },
    risk: {
      unverified: true,
      warning: "The manifest body does not match the immutable onchain hash.",
      quarantineReason: "manifest_hash_mismatch",
    },
  }, prepared.manifest);

  assert.equal(quarantined.evidence, "unsafe");
  assert.equal(quarantined.payment.directX402, true);
  assert.equal(quarantined.effectivePayment.directX402, false);
  assert.equal(quarantined.effectivePayment.escrow, false);
  assert.match(quarantined.effectivePayment.message, /unsafe/i);
});

test("refuses publication before POST when listing writes are unavailable", async () => {
  const prepared = prepareAspListing(config);
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify({
      ok: true,
      service: "agon",
      capabilities: {
        identityReads: false,
        profileWrites: false,
        listingReads: true,
        listingWrites: false,
        endpointQa: false,
        directX402: false,
        escrow: false,
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  await assert.rejects(
    publishAspListing({
      apiUrl: "https://api.example.com",
      token: "test-session-token",
      confirmed: true,
      prepared,
      localManifest: prepared.manifest,
      fetchImpl,
    }),
    (error: unknown) =>
      error instanceof AspCommandError && error.code === "capability_unavailable",
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://api.example.com/agon/health");
  assert.equal(requests[0]?.init?.method, undefined);
});

test("publishes only after confirmation, local proof, capability, and environment token", async () => {
  const prepared = prepareAspListing(config);
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    if (String(input).endsWith("/agon/health")) {
      return new Response(JSON.stringify({
        ok: true,
        service: "agon",
        capabilities: {
          identityReads: true,
          profileWrites: true,
          listingReads: true,
          listingWrites: true,
          endpointQa: true,
          directX402: true,
          escrow: false,
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify(preparedOperation), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  };

  const operation = await publishAspListing({
    apiUrl: "https://api.example.com/",
    token: "test-session-token",
    confirmed: true,
    prepared,
    localManifest: prepared.manifest,
    fetchImpl,
  });

  assert.deepEqual(operation, preparedOperation);
  assert.equal(requests.length, 2);
  assert.equal(requests[1]?.url, "https://api.example.com/agon/listings");
  assert.equal(requests[1]?.init?.method, "POST");
  assert.equal(new Headers(requests[1]?.init?.headers).get("authorization"), "Bearer test-session-token");
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), prepared.request);
});

test("confirms a published transaction through the receipt-verification endpoint", async () => {
  const txHash = `0x${"77".repeat(32)}`;
  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(String(input), "https://api.example.com/agon/operations/op_123/confirm");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-session-token");
    assert.deepEqual(JSON.parse(String(init?.body)), { txHash });
    return new Response(JSON.stringify({
      ...preparedOperation,
      state: "confirmed",
      txHash,
      resultReference: "5042002:0x2144c156b0a4581da2d046c2e41ac41c6c3938cb:9",
      proof: { blockNumber: "123", logIndex: 8 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const confirmed = await confirmAspOperation({
    apiUrl: "https://api.example.com",
    token: "test-session-token",
    operationId: "op_123",
    txHash,
    fetchImpl,
  });
  assert.equal(confirmed.state, "confirmed");
  assert.equal(confirmed.txHash, txHash);
});

test("executes the exact prepared operation through Circle after explicit approval", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const txHash = `0x${"88".repeat(32)}` as `0x${string}`;
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    if (String(input).endsWith("/wallet/execute")) {
      assert.deepEqual(JSON.parse(String(init?.body)), {
        contractAddress: preparedOperation.transaction.to,
        abiFunctionSignature: "publish(uint256,bytes32,bytes32,string,uint256,uint8)",
        abiParameters: preparedOperation.transaction.args,
        refId: preparedOperation.operationId,
      });
      return new Response(JSON.stringify({ id: "circle_tx_123", state: "QUEUED" }), { status: 200 });
    }
    assert.equal(String(input), "https://api.example.com/wallet/tx/circle_tx_123");
    return new Response(JSON.stringify({ state: "COMPLETE", txHash }), { status: 200 });
  };
  const execution = await executeCircleAspOperation({
    apiUrl: "https://api.example.com",
    token: "test-session-token",
    confirmed: true,
    operation: preparedOperation,
    fetchImpl,
    pollIntervalMs: 0,
  });
  assert.equal(execution.circleTransactionId, "circle_tx_123");
  assert.equal(execution.txHash, txHash);
  assert.equal(requests.length, 2);
});

test("publishes an update only when writes are available and the operation is publishVersion", async () => {
  const manifest = { ...prepareAspListing(config).manifest, version: 2 };
  const prepared = prepareAspListingVersion(config, manifest, "7");
  const operation = {
    ...preparedOperation,
    transaction: { ...preparedOperation.transaction, functionName: "publishVersion" as const },
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    if (String(input).endsWith("/agon/health")) {
      return new Response(JSON.stringify({ ok: true, service: "agon", capabilities: { listingWrites: true } }), { status: 200 });
    }
    assert.equal(String(input), "https://api.example.com/agon/listings/7/versions");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-session-token");
    assert.deepEqual(JSON.parse(String(init?.body)), prepared.request);
    return new Response(JSON.stringify(operation), { status: 201 });
  };
  const result = await publishAspListingVersion({
    apiUrl: "https://api.example.com",
    token: "test-session-token",
    confirmed: true,
    prepared,
    localManifest: manifest,
    fetchImpl,
  });
  assert.equal(result.operationId, "op_123");
});

test("evaluates an exact listing version and requests scoped verification", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    if (String(input).endsWith("/playground/evaluate")) {
      return new Response(JSON.stringify({ runId: "11111111-1111-4111-8111-111111111111", score: 96, evidence: {} }), { status: 201 });
    }
    return new Response(JSON.stringify({ intentId: "arena_123", listingReference: "5042002:0x1111111111111111111111111111111111111111:7" }), { status: 201 });
  };
  const run = await evaluateAspListing({
    apiUrl: "https://api.example.com",
    token: "test-session-token",
    listingReference: "5042002:0x1111111111111111111111111111111111111111:7",
    listingVersion: "2",
    category: "analysis",
    taskId: "evidence-under-pressure",
    idempotencyKey: "eval-123456",
    fetchImpl,
  });
  const verification = await requestAspVerification({
    apiUrl: "https://api.example.com",
    token: "test-session-token",
    confirmed: true,
    listingReference: "5042002:0x1111111111111111111111111111111111111111:7",
    playgroundRunId: run.runId,
    idempotencyKey: "verify-123456",
    expiresAt: "2026-08-27T12:00:00.000Z",
    fetchImpl,
  });
  assert.equal(verification.intentId, "arena_123");
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.url, "https://api.example.com/agon/playground/evaluate");
  assert.equal(requests[1]?.url, "https://api.example.com/agon/arena/evaluations");
});
