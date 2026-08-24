import assert from "node:assert/strict";
import test from "node:test";
import {
  clientReferenceForJobEscrow,
  hashAgonJobEscrowTerms,
  isAgonJobEscrowTransitionAllowed,
  settlementForAgonJobStatus,
  stateForAgonJobStatus,
  validateAgonJobEscrowJobMatch,
} from "../../src/agon/execution/job-escrow-state.ts";

const buyer = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const provider = "0x2222222222222222222222222222222222222222" as `0x${string}`;
const manifestHash = `0x${"aa".repeat(32)}` as `0x${string}`;
const termsHash = `0x${"bb".repeat(32)}` as `0x${string}`;
const intent = {
  buyer,
  provider,
  listingId: "7",
  agentId: "42",
  listingVersion: "3",
  manifestHash,
  termsHash,
  amountBaseUnits: 1_000_000n,
  feeBps: 100,
  reviewHours: 24,
};

const job = {
  jobId: "9",
  ...intent,
  deliverableHash: `0x${"cc".repeat(32)}` as `0x${string}`,
  amount: "1000000",
  fee: "10000",
  acceptanceDeadline: new Date(),
  reviewDeadline: null,
  createdAt: new Date(),
  submittedAt: null,
  status: 0,
  settlement: 0,
};

test("maps only known contract status and settlement values", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(stateForAgonJobStatus), ["created", "accepted", "job_submitted", "complete", "rejected", "disputed", "failed"]);
  assert.equal(settlementForAgonJobStatus(1), "provider_paid");
  assert.equal(settlementForAgonJobStatus(2), "buyer_refunded");
  assert.throws(() => stateForAgonJobStatus(99), /unknown/);
  assert.throws(() => settlementForAgonJobStatus(99), /unknown/);
});

test("unknown outcomes can only move through reconciliation, never back to submission", () => {
  assert.equal(isAgonJobEscrowTransitionAllowed("prepared", "unknown"), true);
  assert.equal(isAgonJobEscrowTransitionAllowed("unknown", "created"), true);
  assert.equal(isAgonJobEscrowTransitionAllowed("unknown", "submitted"), false);
  assert.equal(isAgonJobEscrowTransitionAllowed("complete", "created"), false);
  assert.equal(isAgonJobEscrowTransitionAllowed("disputed", "complete"), true);
});

test("job matching binds identities, listing version, manifest, economics, and review window", () => {
  assert.deepEqual(validateAgonJobEscrowJobMatch(intent, job), { ok: true });
  assert.match(validateAgonJobEscrowJobMatch(intent, { ...job, provider: buyer }).message ?? "", /provider/);
  assert.match(validateAgonJobEscrowJobMatch(intent, { ...job, fee: "10001" }).message ?? "", /fee/);
  assert.match(validateAgonJobEscrowJobMatch(intent, { ...job, listingVersion: "4" }).message ?? "", /version/);
});

test("terms and client references are deterministic", () => {
  const input = {
    network: "eip155:5042002" as const,
    asset: "0x3600000000000000000000000000000000000000",
    buyer,
    provider,
    escrowContract: "0x3333333333333333333333333333333333333333",
    serviceRegistry: "0x4444444444444444444444444444444444444444",
    listingId: "7",
    agentId: "42",
    listingVersion: "3",
    manifestHash,
    amountBaseUnits: 1_000_000n,
    feeBps: 100,
    reviewHours: 24,
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
  };
  assert.equal(hashAgonJobEscrowTerms(input), hashAgonJobEscrowTerms({ ...input }));
  assert.equal(clientReferenceForJobEscrow("same-key"), clientReferenceForJobEscrow("same-key"));
  assert.notEqual(clientReferenceForJobEscrow("same-key"), clientReferenceForJobEscrow("other-key"));
});
