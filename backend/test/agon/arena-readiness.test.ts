import assert from "node:assert/strict";
import test from "node:test";
import { AGON_ARENA_EVALUATOR_ROLE, readAgonArenaEvaluatorReadiness } from "../../src/agon/execution/arena-readiness.ts";

const ARENA = "0x1111111111111111111111111111111111111111";
const EVALUATOR = "0x2222222222222222222222222222222222222222";
const ACTIVE_REGISTRY = "0x3333333333333333333333333333333333333333";

test("Arena evaluator readiness is disabled without an explicit read gate", async () => {
  let calls = 0;
  const result = await readAgonArenaEvaluatorReadiness({ enabled: false, arenaAddress: ARENA, evaluatorAddress: EVALUATOR, client: { async readContract() { calls += 1; return true; } } });
  assert.equal(result.reason, "disabled");
  assert.equal(result.assigned, false);
  assert.equal(calls, 0);
});

test("Arena evaluator readiness reports missing configuration and role assignment", async () => {
  const missing = await readAgonArenaEvaluatorReadiness({ enabled: true, arenaAddress: ARENA, client: { async readContract() { return false; } } });
  assert.equal(missing.reason, "evaluator_not_configured");
  const assigned = await readAgonArenaEvaluatorReadiness({ enabled: true, arenaAddress: ARENA, evaluatorAddress: EVALUATOR, client: { async readContract(input) { assert.deepEqual(input.args, [AGON_ARENA_EVALUATOR_ROLE, EVALUATOR.toLowerCase()]); return true; } } });
  assert.equal(assigned.reason, "assigned");
  const unassigned = await readAgonArenaEvaluatorReadiness({ enabled: true, arenaAddress: ARENA, evaluatorAddress: EVALUATOR, client: { async readContract() { return false; } } });
  assert.equal(unassigned.reason, "role_not_assigned");
});

test("Arena evaluator readiness treats RPC errors as unknown", async () => {
  const result = await readAgonArenaEvaluatorReadiness({ enabled: true, arenaAddress: ARENA, evaluatorAddress: EVALUATOR, client: { async readContract() { throw new Error("rpc unavailable"); } } });
  assert.equal(result.reason, "read_failed");
  assert.equal(result.assigned, false);
});

test("Arena evaluator readiness refuses an Arena pinned to a different registry", async () => {
  const result = await readAgonArenaEvaluatorReadiness({
    enabled: true,
    arenaAddress: ARENA,
    evaluatorAddress: EVALUATOR,
    expectedServiceRegistry: ACTIVE_REGISTRY,
    client: { async readContract(input) {
      return input.functionName === "services" ? ARENA : true;
    } },
  });
  assert.equal(result.reason, "service_registry_link_mismatch");
  assert.equal(result.assigned, false);
});
