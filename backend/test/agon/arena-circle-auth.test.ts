import assert from "node:assert/strict";
import test from "node:test";
import { authorizeArenaCircleExecution, AGON_ARENA_EVIDENCE_SIGNATURE, AGON_ARENA_REQUEST_SIGNATURE } from "../../src/agon/execution/arena-circle-auth.ts";
import { buildAgonArenaEvaluationInput, buildAgonArenaEvidencePlan, buildAgonArenaRequestPlan } from "../../src/agon/execution/arena-verification.ts";
import type { PlaygroundRun } from "../../src/agon/playground.ts";

const provider = `0x${"11".repeat(20)}` as `0x${string}`;
const registry = `0x${"22".repeat(20)}`;
const arena = `0x${"33".repeat(20)}`;
const validation = `0x${"44".repeat(20)}`;
const hash = (byte: string) => `0x${byte.repeat(64)}` as `0x${string}`;

function run(): PlaygroundRun {
  return {
    runId: "00000000-0000-4000-8000-000000000001",
    agent: { id: "agon-coder-v1", name: "Agon Coder", version: "1.0.0", capabilities: ["development"] },
    task: { id: "selector-guard", category: "development", title: "Selector guard", adversarialPrompt: "hostile calldata", capability: "calldata analysis" },
    input: {}, output: { accepted: true }, passed: true, score: 96, durationMs: 12,
    evidence: { evidenceRoot: hash("a"), responseHash: hash("b"), taskCommitment: hash("c"), validationRequestHash: hash("d"), evaluatorVersionHash: hash("e") },
    provenance: { execution: "real_agent_runtime", chainId: null, blockNumber: null, externalWrites: false },
    scope: { listingReference: `5042002:${registry}:7`, listingVersion: "3" },
  };
}

function evaluation(state: "prepared" | "evidence_ready" = "prepared") {
  const base = buildAgonArenaEvaluationInput({
    intentId: "00000000-0000-4000-8000-000000000002",
    actor: provider,
    idempotencyKey: "arena-evaluation-001",
    listingReference: `5042002:${registry}:7`,
    arenaContract: arena,
    validationRegistry: validation,
    listing: { serviceRegistry: registry, listingId: "7", agentId: "42", version: "3", category: "1", manifestHash: hash("f"), providerSnapshot: provider },
    playgroundRun: run(),
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
  });
  return {
    ...base,
    state,
    evaluationId: state === "evidence_ready" ? "9" : null,
    requestTransactionHash: state === "evidence_ready" ? hash("1") : null,
    startTransactionHash: state === "evidence_ready" ? hash("2") : null,
    evidenceTransactionHash: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

test("authorizes only the exact prepared Arena request for the provider", () => {
  const current = evaluation();
  const plan = buildAgonArenaRequestPlan(current);
  const result = authorizeArenaCircleExecution({
    evaluation: current,
    operator: provider,
    contractAddress: arena,
    abiFunctionSignature: AGON_ARENA_REQUEST_SIGNATURE,
    abiParameters: plan.args,
  });
  assert.deepEqual(result, { ok: true });
});

test("rejects a different actor, contract, function, or argument", () => {
  const current = evaluation();
  const plan = buildAgonArenaRequestPlan(current);
  const common = { evaluation: current, operator: provider, contractAddress: arena, abiFunctionSignature: AGON_ARENA_REQUEST_SIGNATURE, abiParameters: plan.args };
  assert.equal(authorizeArenaCircleExecution({ ...common, operator: `0x${"55".repeat(20)}` }).ok, false);
  assert.equal(authorizeArenaCircleExecution({ ...common, contractAddress: validation }).ok, false);
  assert.equal(authorizeArenaCircleExecution({ ...common, abiFunctionSignature: "requestEvaluation(bytes32,uint256)" }).ok, false);
  assert.equal(authorizeArenaCircleExecution({ ...common, abiParameters: [...plan.args.slice(0, -1), 0n] }).ok, false);
});

test("authorizes exact evidence only after evaluator start", () => {
  const current = evaluation("evidence_ready");
  const plan = buildAgonArenaEvidencePlan(current);
  const result = authorizeArenaCircleExecution({
    evaluation: current,
    operator: provider,
    contractAddress: arena,
    abiFunctionSignature: AGON_ARENA_EVIDENCE_SIGNATURE,
    abiParameters: plan.args,
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(authorizeArenaCircleExecution({ ...current, evaluation: evaluation(), operator: provider, contractAddress: arena, abiFunctionSignature: AGON_ARENA_EVIDENCE_SIGNATURE, abiParameters: plan.args }).ok, false);
});
