import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgonArenaEvidencePlan,
  buildAgonArenaEvaluationInput,
  buildAgonArenaRequestPlan,
} from "../../src/agon/execution/arena-verification.ts";
import type { PlaygroundRun } from "../../src/agon/playground.ts";

const provider = `0x${"11".repeat(20)}`;
const registry = `0x${"22".repeat(20)}`;
const arena = `0x${"33".repeat(20)}`;
const validation = `0x${"44".repeat(20)}`;
const hash = (byte: string) => `0x${byte.repeat(64)}` as `0x${string}`;

function run(overrides: Partial<PlaygroundRun> = {}): PlaygroundRun {
  return {
    runId: "00000000-0000-4000-8000-000000000001",
    agent: { id: "agon-coder-v1", name: "Agon Coder", version: "1.0.0", capabilities: ["development"] },
    task: { id: "selector-guard", category: "development", title: "Selector guard", adversarialPrompt: "hostile calldata", capability: "calldata analysis" },
    input: {}, output: { accepted: true }, passed: true, score: 96, durationMs: 12,
    evidence: {
      evidenceRoot: hash("a"), responseHash: hash("b"), taskCommitment: hash("c"),
      validationRequestHash: hash("d"), evaluatorVersionHash: hash("e"),
    },
    provenance: { execution: "real_agent_runtime", chainId: null, blockNumber: null, externalWrites: false },
    scope: { listingReference: `5042002:${registry}:7`, listingVersion: "3" },
    ...overrides,
  };
}

function input(overrides: Partial<Parameters<typeof buildAgonArenaEvaluationInput>[0]> = {}) {
  return buildAgonArenaEvaluationInput({
    intentId: "00000000-0000-4000-8000-000000000002",
    actor: provider,
    idempotencyKey: "arena-evaluation-001",
    listingReference: `5042002:${registry}:7`,
    arenaContract: arena,
    validationRegistry: validation,
    listing: { serviceRegistry: registry, listingId: "7", agentId: "42", version: "3", category: "1", manifestHash: hash("f"), providerSnapshot: provider },
    playgroundRun: run(),
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    ...overrides,
  });
}

test("pins Arena request and evidence calldata to the authenticated playground run", () => {
  const evaluation = input();
  const request = buildAgonArenaRequestPlan({ ...evaluation, state: "prepared", evaluationId: null, requestTransactionHash: null, evidenceTransactionHash: null, createdAt: new Date(), updatedAt: new Date() });
  assert.equal(request.functionName, "requestEvaluation");
  assert.equal(request.to, arena);
  assert.match(request.data, /^0x[0-9a-f]+$/);

  const submitted = { ...evaluation, state: "evidence_ready" as const, evaluationId: "9", requestTransactionHash: hash("1"), startTransactionHash: hash("2"), evidenceTransactionHash: null, createdAt: new Date(), updatedAt: new Date() };
  const evidence = buildAgonArenaEvidencePlan(submitted);
  assert.equal(evidence.functionName, "submitEvidence");
  assert.equal(evidence.args[0], 9n);
  assert.equal(evidence.args[1], evaluation.evidenceRoot);
});

test("rejects evidence from another listing version or owner", () => {
  assert.throws(() => input({ playgroundRun: run({ scope: { listingReference: `5042002:${registry}:8`, listingVersion: "3" } }) }), /scope/);
  assert.throws(() => input({ actor: `0x${"55".repeat(20)}` }), /current listing provider/);
});

test("does not build evidence calldata before the request submission marker", () => {
  const evaluation = { ...input(), state: "prepared" as const, evaluationId: null, requestTransactionHash: null, evidenceTransactionHash: null, createdAt: new Date(), updatedAt: new Date() };
  assert.throws(() => buildAgonArenaEvidencePlan(evaluation), /evaluation id is required/);
});
