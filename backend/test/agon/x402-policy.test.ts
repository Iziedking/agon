import assert from "node:assert/strict";
import test from "node:test";
import { createX402ExecutionPolicy, evaluateX402ExecutionPolicy } from "../../src/agon/execution/x402-policy.ts";

const PAY_TO = "0x2222222222222222222222222222222222222222" as const;

function plan(amount = "1000") {
  return {
    requirements: { network: "eip155:5042002", amount, payTo: PAY_TO },
  } as never;
}

test("accepts integer base-unit caps and pins the network", () => {
  const policy = createX402ExecutionPolicy({ enabled: true, maxAmountBaseUnits: "1000000" });
  assert.equal(policy.network, "eip155:5042002");
  assert.equal(policy.maxAmountBaseUnits, 1_000_000n);
  assert.throws(() => createX402ExecutionPolicy({ enabled: true, network: "eip155:1", maxAmountBaseUnits: "1000" }), /pinned to/);
  assert.throws(() => createX402ExecutionPolicy({ enabled: true, maxAmountBaseUnits: "0.01" }), /integer USDC/);
});

test("enforces recipient allowlists before an adapter can be called", () => {
  const policy = createX402ExecutionPolicy({ enabled: true, maxAmountBaseUnits: "1000", allowedRecipients: [PAY_TO] });
  assert.deepEqual(evaluateX402ExecutionPolicy(policy, plan()), { ok: true });
  const other = createX402ExecutionPolicy({ enabled: true, maxAmountBaseUnits: "1000", allowedRecipients: ["0x3333333333333333333333333333333333333333"] });
  assert.deepEqual(evaluateX402ExecutionPolicy(other, plan()), {
    ok: false,
    code: "execution_not_ready",
    message: "x402 recipient is not approved by policy",
  });
});

test("disabled policy is explicit even when the cap is populated", () => {
  const policy = createX402ExecutionPolicy({ enabled: false, maxAmountBaseUnits: "1000" });
  assert.deepEqual(evaluateX402ExecutionPolicy(policy, plan()), {
    ok: false,
    code: "execution_disabled",
    message: "x402 execution is disabled by policy",
  });
});
