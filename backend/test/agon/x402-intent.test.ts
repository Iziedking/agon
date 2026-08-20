import assert from "node:assert/strict";
import test from "node:test";
import type { AgonListingView } from "../../src/agon/http/api-types.ts";
import { prepareX402Call } from "../../src/agon/execution/x402-intent.ts";

const ACTOR = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REGISTRY = "0x3333333333333333333333333333333333333333";
const HASH = `0x${"11".repeat(32)}`;

function listing(overrides: Partial<AgonListingView> = {}): AgonListingView {
  return {
    id: `5042002:${REGISTRY}:1`,
    chainId: "5042002",
    serviceRegistry: REGISTRY,
    listingId: "1",
    agentId: "42",
    serviceKey: HASH,
    category: "8",
    version: "1",
    manifest: { hash: HASH, uri: "ipfs://manifest" },
    providerSnapshot: ACTOR,
    status: "Listed",
    verification: { status: "Verified", scope: { agentId: "42", listingId: "1", version: "1", category: "8" } },
    risk: { unverified: false, warning: null, quarantineReason: null },
    endpointQa: {
      status: "passed",
      checkedAt: "2026-08-20T10:00:00.000Z",
      endpointStatus: 402,
      evidenceHash: HASH,
      reason: "Agon observed the service endpoint returning HTTP 402.",
      attempts: 3,
      passedAttempts: 3,
      successRate: 100,
    },
    payment: { rail: "X402", directX402: true, escrowEligible: false },
    provenance: { sourceBlockNumber: "100", sourceTxHash: HASH, sourceLogIndex: 0 },
    ...overrides,
  };
}

test("prepares a verified x402 call without enabling execution", () => {
  const result = prepareX402Call(ACTOR, listing(), {
    idempotencyKey: "audit-001",
    method: "POST",
    input: { b: 2, a: 1 },
    maxAmountUSDC: "0.01",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.actor, ACTOR);
  assert.match(result.value.inputHash, /^0x[0-9a-f]{64}$/);
  assert.equal(result.value.maxAmountUSDC, "0.01");
});

test("canonicalizes equivalent JSON input to the same hash", () => {
  const first = prepareX402Call(ACTOR, listing(), {
    idempotencyKey: "audit-001",
    method: "POST",
    input: { a: 1, b: 2 },
    maxAmountUSDC: "1",
  });
  const second = prepareX402Call(ACTOR, listing(), {
    idempotencyKey: "audit-002",
    method: "POST",
    input: { b: 2, a: 1 },
    maxAmountUSDC: "1",
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(first.value.inputHash, second.value.inputHash);
});

test("fails closed for unverified or unchecked listings", () => {
  const unverified = prepareX402Call(ACTOR, listing({ verification: { ...listing().verification, status: "Unverified" } }), {
    idempotencyKey: "audit-001", method: "GET", input: null, maxAmountUSDC: "0.01",
  });
  const unchecked = prepareX402Call(ACTOR, listing({ endpointQa: { ...listing().endpointQa, status: "not_checked" } }), {
    idempotencyKey: "audit-002", method: "GET", input: null, maxAmountUSDC: "0.01",
  });
  assert.deepEqual(unverified, { ok: false, error: { code: "not_eligible", message: "only Agon-verified listings can receive calls" } });
  assert.deepEqual(unchecked, { ok: false, error: { code: "not_eligible", message: "endpoint verification must pass before a call can be prepared" } });
});

test("rejects unsafe idempotency keys and zero spend caps", () => {
  const key = prepareX402Call(ACTOR, listing(), {
    idempotencyKey: "short",
    method: "POST",
    input: {},
    maxAmountUSDC: "0.01",
  });
  const amount = prepareX402Call(ACTOR, listing(), {
    idempotencyKey: "audit-001",
    method: "POST",
    input: {},
    maxAmountUSDC: "0.000000",
  });
  assert.equal(key.ok, false);
  assert.equal(amount.ok, false);
});
