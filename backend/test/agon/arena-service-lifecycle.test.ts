import assert from "node:assert/strict";
import test from "node:test";

import { PostgresAgonMarketService } from "../../src/agon/http/service.ts";
import { AgonListingVerificationError } from "../../src/agon/execution/listing-verifier.ts";
import type { StoredAgonArenaEvaluation } from "../../src/agon/store/repository.ts";
import type { PlaygroundRun } from "../../src/agon/playground.ts";

const actor = `0x${"11".repeat(20)}` as `0x${string}`;
const arena = `0x${"22".repeat(20)}` as `0x${string}`;
const registry = `0x${"33".repeat(20)}` as `0x${string}`;
const hash = (byte: string) => `0x${byte.repeat(64)}` as `0x${string}`;

function evaluation(state: StoredAgonArenaEvaluation["state"]): StoredAgonArenaEvaluation {
  return {
    intentId: "00000000-0000-4000-8000-000000000001",
    actor,
    idempotencyKey: "arena-service-lifecycle",
    listingReference: `5042002:${registry}:7`,
    network: "eip155:5042002",
    arenaContract: arena,
    validationRegistry: arena,
    participant: actor,
    serviceRegistry: registry,
    listingId: "7",
    agentId: "42",
    listingVersion: "3",
    category: "3",
    manifestHash: hash("a"),
    capabilityHash: hash("b"),
    evaluatorVersionHash: hash("c"),
    taskCommitment: hash("d"),
    validationRequestHash: hash("e"),
    evidenceRoot: hash("f"),
    playgroundRunId: "00000000-0000-4000-8000-000000000002",
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    state,
    evaluationId: "9",
    requestTransactionHash: hash("1"),
    startTransactionHash: null,
    evidenceTransactionHash: state === "evidence_submitted" ? hash("2") : null,
    marketplaceVerificationState: "not_started",
    marketplaceVerificationTransactionHash: null,
    marketplaceVerificationError: null,
    marketplaceVerifiedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function chain(state: number) {
  const value = evaluation("request_submitted");
  return {
    evaluationId: "9",
    listingId: value.listingId,
    agentId: value.agentId,
    listingVersion: value.listingVersion,
    category: value.category,
    participant: value.participant,
    manifestHash: value.manifestHash,
    capabilityHash: value.capabilityHash,
    evaluatorVersionHash: value.evaluatorVersionHash,
    taskCommitment: value.taskCommitment,
    evidenceRoot: state >= 2 ? value.evidenceRoot : hash("0"),
    validationRequestHash: value.validationRequestHash,
    validationResponseHash: state >= 3 ? hash("8") : hash("0"),
    score: state >= 3 ? 96 : 0,
    expiresAt: value.expiresAt,
    state,
  };
}

test("reconciliation starts a pending evaluation with the configured evaluator", async () => {
  const current = evaluation("request_submitted");
  let startedWith: string | null = null;
  const service = new PostgresAgonMarketService({
    async getAgonArenaEvaluation() { return current; },
    async markAgonArenaEvaluationStarted(input: { transactionHash: `0x${string}` }) {
      startedWith = input.transactionHash;
      return { ...current, state: "evidence_ready" as const, startTransactionHash: input.transactionHash };
    },
  } as never, {
    protocolFinalityReader: { enabled: true, async inspectArenaEvaluation() { return chain(0); } } as never,
    arenaEvaluatorAdapter: {
      enabled: true,
      async startEvaluation() { return hash("7"); },
      async scoreEvaluation() { throw new Error("not expected"); },
    },
  });

  const result = await service.reconcileAgonArenaEvaluation(actor, current.intentId);
  assert.equal(result.ok, true);
  assert.equal(startedWith, hash("7"));
  if (result.ok) assert.equal(result.value.state, "evidence_ready");
});

test("reconciliation scores submitted evidence from the pinned playground result", async () => {
  const current = evaluation("evidence_submitted");
  let state = 2;
  let scored: { score: number; validationResponseHash: `0x${string}` } | null = null;
  const run = {
    score: 96,
    evidence: { responseHash: hash("8") },
  } as PlaygroundRun;
  const service = new PostgresAgonMarketService({
    async getAgonArenaEvaluation() { return current; },
    async reconcileAgonArenaEvaluation(input: { state: StoredAgonArenaEvaluation["state"] }) { return { ...current, state: input.state }; },
    async recordAgonArenaMarketplaceVerification(input: { state: StoredAgonArenaEvaluation["marketplaceVerificationState"]; error?: string | null }) {
      return { ...current, state: "verified" as const, marketplaceVerificationState: input.state, marketplaceVerificationError: input.error ?? null };
    },
  } as never, {
    protocolFinalityReader: { enabled: true, async inspectArenaEvaluation() { return chain(state); } } as never,
    playgroundStore: { async getRun() { return { state: "completed", result: run }; } } as never,
    arenaEvaluatorAdapter: {
      enabled: true,
      async startEvaluation() { throw new Error("not expected"); },
      async scoreEvaluation(input) { scored = input; state = 3; return hash("9"); },
    },
  });

  const result = await service.reconcileAgonArenaEvaluation(actor, current.intentId);
  assert.equal(result.ok, true);
  assert.deepEqual(scored, { evaluationId: "9", score: 96, validationResponseHash: hash("8") });
  if (result.ok) {
    assert.equal(result.value.state, "verified");
    assert.equal(result.value.marketplaceVerification.state, "failed");
    assert.match(result.value.marketplaceVerification.error ?? "", /version-scoped registry/);
  }
});

test("verified Arena evidence is automatically published to the marketplace", async () => {
  const current = evaluation("evidence_submitted");
  let stored = current;
  let verifiedScope: unknown = null;
  const repository = {
    async getAgonArenaEvaluation() { return stored; },
    async reconcileAgonArenaEvaluation(input: { state: StoredAgonArenaEvaluation["state"] }) {
      stored = { ...stored, state: input.state };
      return stored;
    },
    async claimAgonArenaMarketplaceVerification() {
      stored = { ...stored, marketplaceVerificationState: "pending" as const };
      return stored;
    },
    async recordAgonArenaMarketplaceVerification(input: { state: StoredAgonArenaEvaluation["marketplaceVerificationState"]; transactionHash?: `0x${string}` | null; error?: string | null }) {
      stored = {
        ...stored,
        marketplaceVerificationState: input.state,
        marketplaceVerificationTransactionHash: input.transactionHash === undefined ? stored.marketplaceVerificationTransactionHash : input.transactionHash,
        marketplaceVerificationError: input.error === undefined ? stored.marketplaceVerificationError : input.error,
        marketplaceVerifiedAt: input.state === "confirmed" ? new Date("2026-01-02T00:00:00.000Z") : stored.marketplaceVerifiedAt,
      };
      return stored;
    },
  };
  const service = new PostgresAgonMarketService(repository as never, {
    protocolFinalityReader: { enabled: true, async inspectArenaEvaluation() { return chain(3); } } as never,
    listingVerifierAdapter: {
      enabled: true,
      async verify(input) {
        verifiedScope = { listingId: input.listingId, agentId: input.agentId, listingVersion: input.listingVersion, manifestHash: input.manifestHash };
        await input.onSubmitted?.(hash("9"));
        return { status: "confirmed" as const, transactionHash: hash("9") };
      },
    },
  });

  const result = await service.reconcileAgonArenaEvaluation(actor, current.intentId);
  assert.equal(result.ok, true);
  assert.deepEqual(verifiedScope, { listingId: "7", agentId: "42", listingVersion: "3", manifestHash: hash("a") });
  if (result.ok) {
    assert.equal(result.value.verificationStatus, "verified");
    assert.equal(result.value.marketplaceVerification.state, "confirmed");
    assert.equal(result.value.marketplaceVerification.transactionHash, hash("9"));
  }
});

test("unknown marketplace outcomes stay retryable and never appear verified", async () => {
  const current = evaluation("verified");
  let stored = current;
  const repository = {
    async getAgonArenaEvaluation() { return stored; },
    async reconcileAgonArenaEvaluation() { return stored; },
    async claimAgonArenaMarketplaceVerification() {
      stored = { ...stored, marketplaceVerificationState: "pending" as const };
      return stored;
    },
    async recordAgonArenaMarketplaceVerification(input: { state: StoredAgonArenaEvaluation["marketplaceVerificationState"]; transactionHash?: `0x${string}` | null; error?: string | null }) {
      stored = {
        ...stored,
        marketplaceVerificationState: input.state,
        marketplaceVerificationTransactionHash: input.transactionHash === undefined ? stored.marketplaceVerificationTransactionHash : input.transactionHash,
        marketplaceVerificationError: input.error === undefined ? stored.marketplaceVerificationError : input.error,
      };
      return stored;
    },
  };
  const service = new PostgresAgonMarketService(repository as never, {
    protocolFinalityReader: { enabled: true, async inspectArenaEvaluation() { return chain(3); } } as never,
    listingVerifierAdapter: {
      enabled: true,
      async verify(input) {
        await input.onSubmitted?.(hash("9"));
        throw new AgonListingVerificationError("unknown_outcome", "receipt timed out", hash("9"));
      },
    },
  });

  const result = await service.reconcileAgonArenaEvaluation(actor, current.intentId);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.verificationStatus, "publishing_to_market");
    assert.equal(result.value.marketplaceVerification.state, "unknown");
    assert.equal(result.value.marketplaceVerification.transactionHash, hash("9"));
    assert.equal(result.value.nextAction, "reconcile_marketplace");
  }
});

test("concurrent reconciliation does not submit a second marketplace transaction", async () => {
  const current = evaluation("verified");
  let stored = current;
  let claimed = false;
  let writes = 0;
  const repository = {
    async getAgonArenaEvaluation() { return stored; },
    async reconcileAgonArenaEvaluation() { return stored; },
    async claimAgonArenaMarketplaceVerification() {
      if (claimed) return null;
      claimed = true;
      stored = { ...stored, marketplaceVerificationState: "pending" as const };
      return stored;
    },
    async recordAgonArenaMarketplaceVerification(input: { state: StoredAgonArenaEvaluation["marketplaceVerificationState"]; transactionHash?: `0x${string}` | null }) {
      stored = { ...stored, marketplaceVerificationState: input.state, marketplaceVerificationTransactionHash: input.transactionHash ?? stored.marketplaceVerificationTransactionHash };
      return stored;
    },
  };
  const service = new PostgresAgonMarketService(repository as never, {
    protocolFinalityReader: { enabled: true, async inspectArenaEvaluation() { return chain(3); } } as never,
    listingVerifierAdapter: {
      enabled: true,
      async verify(input) {
        writes += 1;
        await input.onSubmitted?.(hash("9"));
        return { status: "confirmed" as const, transactionHash: hash("9") };
      },
    },
  });

  await Promise.all([
    service.reconcileAgonArenaEvaluation(actor, current.intentId),
    service.reconcileAgonArenaEvaluation(actor, current.intentId),
  ]);
  assert.equal(writes, 1);
});

test("Arena reconciliation mismatch raises one operator escalation without changing verification state", async () => {
  const current = evaluation("evidence_submitted");
  const escalations: Array<{ intentId: string; reasons: readonly string[] }> = [];
  const service = new PostgresAgonMarketService({
    async getAgonArenaEvaluation() { return current; },
  } as never, {
    protocolFinalityReader: {
      enabled: true,
      async inspectArenaEvaluation() { return { ...chain(2), manifestHash: hash("9") }; },
    } as never,
    arenaEscalation: async (input) => { escalations.push({ intentId: input.intentId, reasons: input.reasons }); },
  });

  const result = await service.reconcileAgonArenaEvaluation(actor, current.intentId);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "reconciliation_invalid");
  assert.deepEqual(escalations, [{ intentId: current.intentId, reasons: ["chain_manifest_hash_mismatch"] }]);
  assert.equal(current.state, "evidence_submitted");
});
