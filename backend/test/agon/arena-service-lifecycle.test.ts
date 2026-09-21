import assert from "node:assert/strict";
import test from "node:test";

import { PostgresAgonMarketService } from "../../src/agon/http/service.ts";
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
  if (result.ok) assert.equal(result.value.state, "verified");
});
