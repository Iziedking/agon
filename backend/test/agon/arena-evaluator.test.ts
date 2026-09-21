import assert from "node:assert/strict";
import test from "node:test";

import { createViemAgonArenaEvaluator } from "../../src/agon/execution/arena-evaluator.ts";

const arena = `0x${"11".repeat(20)}`;
const hash = (byte: string) => `0x${byte.repeat(64)}` as `0x${string}`;

test("Arena evaluator starts and scores only after confirmed state transitions", async () => {
  let state = 0;
  const writes: string[] = [];
  const adapter = createViemAgonArenaEvaluator({
    enabled: true,
    arenaAddress: arena,
    client: {
      async readContract() { return { state }; },
      async waitForTransactionReceipt() { return { status: "success" as const }; },
    },
    wallet: {
      async writeContract(input) {
        writes.push(input.functionName);
        state = input.functionName === "startEvaluation" ? 1 : 3;
        return hash(input.functionName === "startEvaluation" ? "a" : "b");
      },
    },
  });

  assert.equal(await adapter.startEvaluation("7"), hash("a"));
  assert.equal(await adapter.startEvaluation("7"), null);
  state = 2;
  assert.equal(await adapter.scoreEvaluation({ evaluationId: "7", score: 96, validationResponseHash: hash("c") }), hash("b"));
  assert.equal(await adapter.scoreEvaluation({ evaluationId: "7", score: 96, validationResponseHash: hash("c") }), null);
  assert.deepEqual(writes, ["startEvaluation", "scoreEvaluation"]);
});

test("Arena evaluator fails closed for disabled, reverted, and invalid scoring paths", async () => {
  const disabled = createViemAgonArenaEvaluator({ enabled: false, arenaAddress: arena });
  await assert.rejects(() => disabled.startEvaluation("1"), /read client/);

  const reverted = createViemAgonArenaEvaluator({
    enabled: true,
    arenaAddress: arena,
    client: {
      async readContract() { return { state: 0 }; },
      async waitForTransactionReceipt() { return { status: "reverted" as const }; },
    },
    wallet: { async writeContract() { return hash("d"); } },
  });
  await assert.rejects(() => reverted.startEvaluation("1"), /reverted/);
  await assert.rejects(() => reverted.scoreEvaluation({ evaluationId: "1", score: 101, validationResponseHash: hash("e") }), /integer/);
});
