import assert from "node:assert/strict";
import test from "node:test";
import { AGON_ARENA_EVALUATOR_ROLE } from "../../src/agon/execution/arena-readiness.ts";
import { PostgresAgonMarketService } from "../../src/agon/http/service.ts";

const ARENA = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const EVALUATOR = "0x2222222222222222222222222222222222222222" as `0x${string}`;

test("capabilities expose read-only Arena evaluator readiness", async () => {
  const service = new PostgresAgonMarketService({} as never, {
    agonArenaAddress: ARENA,
    arenaEvaluatorReadiness: async () => ({
      enabled: true,
      arenaAddress: ARENA,
      evaluatorAddress: EVALUATOR,
      role: AGON_ARENA_EVALUATOR_ROLE,
      assigned: true,
      reason: "assigned" as const,
    }),
  });

  const capabilities = await service.getCapabilities();
  assert.equal(capabilities.arenaVerification, true);
  assert.equal(capabilities.arenaEvaluatorReadiness.assigned, true);
  assert.equal(capabilities.arenaEvaluatorReadiness.reason, "assigned");
  assert.equal(capabilities.arenaEvaluatorReadiness.executionEnabled, false);
  assert.equal(capabilities.arenaEvaluatorReadiness.executionReason, "writer_disabled");
  assert.equal(capabilities.arenaEvaluatorReadiness.arenaAddress, ARENA);
  assert.ok(capabilities.arenaEvaluatorReadiness.checkedAt);
});

test("capabilities fail closed when evaluator readiness is not wired", async () => {
  const service = new PostgresAgonMarketService({} as never);
  const capabilities = await service.getCapabilities();
  assert.equal(capabilities.arenaEvaluatorReadiness.enabled, false);
  assert.equal(capabilities.arenaEvaluatorReadiness.assigned, false);
  assert.equal(capabilities.arenaEvaluatorReadiness.reason, "unconfigured");
  assert.equal(capabilities.arenaEvaluatorReadiness.checkedAt, null);
});
