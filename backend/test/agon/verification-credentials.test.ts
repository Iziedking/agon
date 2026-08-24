import assert from "node:assert/strict";
import test from "node:test";
import {
  AGON_VALIDATION_NETWORK,
  AgonVerificationCredentialLedger,
  buildValidationRequestWritePlan,
  buildValidationRequestPayload,
  buildValidationResponseWritePlan,
  createDisabledAgonValidationRegistryAdapter,
  hashValidationRequest,
} from "../../src/agon/verification-credentials.ts";

const SERVICE = "0x1111111111111111111111111111111111111111" as const;
const REQUESTER = "0x2222222222222222222222222222222222222222" as const;
const VALIDATOR = "0x3333333333333333333333333333333333333333" as const;
const REQUEST_HASH = `0x${"aa".repeat(32)}` as const;
const MANIFEST_HASH = `0x${"bb".repeat(32)}` as const;
const TX_HASH = `0x${"cc".repeat(32)}` as const;
const NOW = new Date("2026-08-22T12:00:00.000Z");

function listing(overrides: Record<string, string> = {}) {
  return {
    serviceRegistry: SERVICE,
    listingId: "7",
    agentId: "42",
    version: "3",
    manifestHash: MANIFEST_HASH,
    ...overrides,
  };
}

function ledger() {
  return new AgonVerificationCredentialLedger();
}

function create(credentialLedger: AgonVerificationCredentialLedger, overrides: Record<string, unknown> = {}) {
  return credentialLedger.createRequest({
    listing: listing(),
    validatorAddress: VALIDATOR,
    requesterAddress: REQUESTER,
    requestURI: "ipfs://bafy-validation-request",
    requestHash: REQUEST_HASH,
    requestedAt: NOW,
    ...overrides,
  });
}

test("builds a deterministic ERC-8004 request payload and hash", () => {
  const payload = buildValidationRequestPayload({ ...listing(), checks: ["ownership", "manifest", "endpoint"] });
  assert.equal(payload.network, AGON_VALIDATION_NETWORK);
  assert.equal(hashValidationRequest(payload), hashValidationRequest({ ...payload, checks: ["ownership", "manifest", "endpoint"] }));
  assert.notEqual(hashValidationRequest(payload), hashValidationRequest({ ...payload, checks: ["endpoint", "manifest", "ownership"] }));
  assert.throws(() => buildValidationRequestPayload({ ...listing(), checks: ["ownership", "ownership"] }), /unique safe tags/);
});

test("rejects invalid requests and self-validation", () => {
  const credentialLedger = ledger();
  assert.deepEqual(create(credentialLedger, { validatorAddress: REQUESTER }), {
    ok: false,
    error: { code: "invalid_request", message: "validator must be valid and distinct from the requester" },
  });
  assert.deepEqual(create(credentialLedger, { requestURI: "http://unsafe.example/request" }), {
    ok: false,
    error: { code: "invalid_request", message: "request URI must use HTTPS or IPFS" },
  });
  assert.deepEqual(create(credentialLedger, { requestHash: "0x12" }), {
    ok: false,
    error: { code: "invalid_request", message: "request hash must be a bytes32 value" },
  });
});

test("creates an immutable request and replays it idempotently", () => {
  const credentialLedger = ledger();
  const first = create(credentialLedger);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.value.decision, "created");
  const replay = create(credentialLedger);
  assert.equal(replay.ok, true);
  if (!replay.ok) return;
  assert.equal(replay.value.decision, "idempotent_replay");
  assert.deepEqual(create(credentialLedger, { requestURI: "ipfs://different" }), {
    ok: false,
    error: { code: "request_conflict", message: "request hash is already bound to different validation economics" },
  });
});

test("accepts progressive responses but rejects wrong validators and stale evidence", () => {
  const credentialLedger = ledger();
  assert.equal(create(credentialLedger).ok, true);
  const pending = credentialLedger.respond({ requestHash: REQUEST_HASH, validatorAddress: VALIDATOR, response: 50, tag: "soft-finality", observedAt: new Date("2026-08-22T12:01:00.000Z") });
  assert.equal(pending.ok, true);
  if (pending.ok) assert.equal(pending.value.state, "pending");
  assert.deepEqual(credentialLedger.respond({ requestHash: REQUEST_HASH, validatorAddress: REQUESTER, response: 100 }), {
    ok: false,
    error: { code: "validator_mismatch", message: "response validator does not match the request" },
  });
  assert.deepEqual(credentialLedger.respond({ requestHash: REQUEST_HASH, validatorAddress: VALIDATOR, response: 100, observedAt: NOW }), {
    ok: false,
    error: { code: "stale_response", message: "validation response is older than the recorded response" },
  });
  const verified = credentialLedger.respond({ requestHash: REQUEST_HASH, validatorAddress: VALIDATOR, response: 100, responseURI: "https://agon.surf/evidence/1", responseHash: TX_HASH, transaction: TX_HASH, observedAt: new Date("2026-08-22T12:02:00.000Z") });
  assert.equal(verified.ok, true);
  if (verified.ok) assert.equal(verified.value.state, "verified");
});

test("maps zero to rejected, expires pending requests, and keeps terminal states immutable", () => {
  const credentialLedger = ledger();
  assert.equal(create(credentialLedger, { expiresAt: new Date("2026-08-22T13:00:00.000Z") }).ok, true);
  const rejectedResponse = credentialLedger.respond({ requestHash: REQUEST_HASH, validatorAddress: VALIDATOR, response: 0, observedAt: new Date("2026-08-22T12:10:00.000Z") });
  assert.equal(rejectedResponse.ok, true);
  const rejected = credentialLedger.get(REQUEST_HASH);
  assert.equal(rejected?.state, "rejected");

  const expiring = ledger();
  assert.equal(create(expiring, { requestHash: `0x${"dd".repeat(32)}`, expiresAt: new Date("2026-08-22T13:00:00.000Z") }).ok, true);
  assert.equal(expiring.get(`0x${"dd".repeat(32)}`, new Date("2026-08-22T14:00:00.000Z"))?.state, "expired");
  assert.deepEqual(expiring.respond({ requestHash: `0x${"dd".repeat(32)}`, validatorAddress: VALIDATOR, response: 100 }), {
    ok: false,
    error: { code: "credential_terminal", message: "validation credential is terminal" },
  });
});

test("revokes a credential and never calls the disabled ValidationRegistry adapter", async () => {
  const credentialLedger = ledger();
  assert.equal(create(credentialLedger).ok, true);
  assert.equal(credentialLedger.revoke(REQUEST_HASH).ok, true);
  assert.equal(credentialLedger.get(REQUEST_HASH)?.state, "revoked");
  const adapter = createDisabledAgonValidationRegistryAdapter();
  assert.equal(adapter.enabled, false);
  assert.deepEqual(await adapter.request({ validatorAddress: VALIDATOR, agentId: 42n, requestURI: "ipfs://request", requestHash: REQUEST_HASH }), {
    ok: false,
    error: { code: "validation_disabled", message: "ERC-8004 validation writes are disabled by policy" },
  });
  assert.deepEqual(await adapter.respond({ requestHash: REQUEST_HASH, response: 100 }), {
    ok: false,
    error: { code: "validation_disabled", message: "ERC-8004 validation writes are disabled by policy" },
  });
});

test("builds exact unsigned ERC-8004 request and response plans", () => {
  const request = buildValidationRequestWritePlan({
    validationRegistryAddress: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
    validatorAddress: VALIDATOR,
    agentId: 42n,
    requestURI: "ipfs://bafy-validation-request",
    requestHash: REQUEST_HASH,
  });
  assert.equal(request.ok, true);
  if (!request.ok) return;
  assert.equal(request.value.chainId, 5042002);
  assert.equal(request.value.functionName, "validationRequest");
  assert.match(request.value.data, /^0x[0-9a-f]+$/);
  assert.equal(request.value.to, "0x8004Cb1BF31DAf7788923b405b754f57acEB4272");

  const response = buildValidationResponseWritePlan({
    validationRegistryAddress: request.value.to,
    requestHash: REQUEST_HASH,
    response: 100,
    responseURI: "https://agon.surf/evidence/1",
    responseHash: TX_HASH,
    tag: "arena-pass",
  });
  assert.equal(response.ok, true);
  if (!response.ok) return;
  assert.equal(response.value.functionName, "validationResponse");
  assert.match(response.value.data, /^0x[0-9a-f]+$/);
});

test("rejects unsafe unsigned ValidationRegistry plans", () => {
  assert.equal(buildValidationRequestWritePlan({
    validationRegistryAddress: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
    validatorAddress: VALIDATOR,
    agentId: 42n,
    requestURI: "http://unsafe.example/request",
    requestHash: REQUEST_HASH,
  }).ok, false);
  assert.equal(buildValidationResponseWritePlan({
    validationRegistryAddress: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
    requestHash: REQUEST_HASH,
    response: 101,
    responseURI: "https://agon.surf/evidence/1",
    responseHash: TX_HASH,
    tag: "arena-pass",
  }).ok, false);
});
