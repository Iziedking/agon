import assert from "node:assert/strict";
import test from "node:test";
import {
  AGON_PRIZE_ESCROW_NETWORK,
  AGON_PRIZE_ESCROW_CONTROLLER_ROLE,
  createDisabledAgonPrizeEscrowReadAdapter,
  createViemAgonPrizeEscrowReadAdapter,
  validateAgonPrizeEscrowReadResult,
} from "../../src/agon/execution/escrow-reconciliation.ts";

const ESCROW = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const CONTROLLER = "0x2222222222222222222222222222222222222222" as `0x${string}`;
const USDC = "0x3600000000000000000000000000000000000000" as `0x${string}`;

function request(overrides: Partial<Parameters<typeof validateAgonPrizeEscrowReadResult>[1]> = {}) {
  return {
    network: AGON_PRIZE_ESCROW_NETWORK,
    escrowAddress: ESCROW,
    controller: CONTROLLER,
    poolId: "7",
    expectedAsset: USDC,
    expectedBalanceBaseUnits: "1000000",
    ...overrides,
  };
}

test("disabled PrizeEscrow inspection makes no call", async () => {
  const adapter = createDisabledAgonPrizeEscrowReadAdapter();
  assert.equal(adapter.enabled, false);
  await assert.rejects(() => adapter.inspect(request()), /disabled by policy/);
});

test("validates exact contract, controller, pool, asset, and balance identity", () => {
  const result = validateAgonPrizeEscrowReadResult({
    network: AGON_PRIZE_ESCROW_NETWORK,
    escrowAddress: ESCROW,
    asset: USDC,
    controller: CONTROLLER,
    poolId: "7",
    balanceBaseUnits: "1000000",
    controllerRole: AGON_PRIZE_ESCROW_CONTROLLER_ROLE,
    controllerAuthorized: true,
  }, request());
  assert.equal(result.balanceBaseUnits, "1000000");
  assert.equal(result.poolId, "7");
});

test("rejects a different pool balance instead of treating it as funded", () => {
  assert.throws(() => validateAgonPrizeEscrowReadResult({
    network: AGON_PRIZE_ESCROW_NETWORK,
    escrowAddress: ESCROW,
    asset: USDC,
    controller: CONTROLLER,
    poolId: "7",
    balanceBaseUnits: "999999",
    controllerRole: AGON_PRIZE_ESCROW_CONTROLLER_ROLE,
    controllerAuthorized: true,
  }, request()), /does not match/);
});

test("rejects wrong network, asset, controller, and malformed identifiers", () => {
  const valid = { controllerRole: AGON_PRIZE_ESCROW_CONTROLLER_ROLE, controllerAuthorized: true };
  assert.throws(() => validateAgonPrizeEscrowReadResult({ network: "eip155:1" as never, escrowAddress: ESCROW, asset: USDC, controller: CONTROLLER, poolId: "7", balanceBaseUnits: "1000000", ...valid }, request()), /Arc Testnet/);
  assert.throws(() => validateAgonPrizeEscrowReadResult({ network: AGON_PRIZE_ESCROW_NETWORK, escrowAddress: ESCROW, asset: ESCROW, controller: CONTROLLER, poolId: "7", balanceBaseUnits: "1000000", ...valid }, request()), /different USDC/);
  assert.throws(() => validateAgonPrizeEscrowReadResult({ network: AGON_PRIZE_ESCROW_NETWORK, escrowAddress: ESCROW, asset: USDC, controller: ESCROW, poolId: "7", balanceBaseUnits: "1000000", ...valid }, request()), /different controller/);
  assert.throws(() => validateAgonPrizeEscrowReadResult({ network: AGON_PRIZE_ESCROW_NETWORK, escrowAddress: ESCROW, asset: USDC, controller: CONTROLLER, poolId: "-1", balanceBaseUnits: "1000000", ...valid }, request()), /non-negative/);
});

test("enabled adapter performs only the four bounded view calls and normalizes result", async () => {
  const calls: string[] = [];
  const adapter = createViemAgonPrizeEscrowReadAdapter({
    enabled: true,
    escrowAddress: ESCROW,
    client: { readContract: async (input) => {
      calls.push(input.functionName);
      if (input.functionName === "usdc") return USDC;
      if (input.functionName === "CONTROLLER_ROLE") return AGON_PRIZE_ESCROW_CONTROLLER_ROLE;
      if (input.functionName === "hasRole") return true;
      return 1000000n;
    } },
  });
  const result = await adapter.inspect(request());
  assert.equal(adapter.enabled, true);
  assert.deepEqual(calls.sort(), ["CONTROLLER_ROLE", "hasRole", "poolBalance", "usdc"]);
  assert.equal(result.balanceBaseUnits, "1000000");
  assert.equal(result.asset, USDC.toLowerCase());
});

test("adapter rejects a mismatched configured contract before any read", async () => {
  let calls = 0;
  const adapter = createViemAgonPrizeEscrowReadAdapter({ enabled: true, escrowAddress: ESCROW, client: { readContract: async () => { calls += 1; return USDC; } } });
  await assert.rejects(() => adapter.inspect(request({ escrowAddress: CONTROLLER })), /configured contract/);
  assert.equal(calls, 0);
});

test("adapter opens its circuit after repeated read failures", async () => {
  const adapter = createViemAgonPrizeEscrowReadAdapter({
    enabled: true,
    escrowAddress: ESCROW,
    failureThreshold: 2,
    cooldownMs: 60_000,
    client: { readContract: async () => { throw new Error("rpc unavailable"); } },
  });
  await assert.rejects(() => adapter.inspect(request()), /rpc unavailable/);
  await assert.rejects(() => adapter.inspect(request()), /rpc unavailable/);
  await assert.rejects(() => adapter.inspect(request()), /circuit is open/);
});

test("does not treat an unauthorized controller as a ready pool", async () => {
  const adapter = createViemAgonPrizeEscrowReadAdapter({
    enabled: true,
    escrowAddress: ESCROW,
    client: { readContract: async (input) => {
      if (input.functionName === "usdc") return USDC;
      if (input.functionName === "CONTROLLER_ROLE") return AGON_PRIZE_ESCROW_CONTROLLER_ROLE;
      if (input.functionName === "hasRole") return false;
      return 1000000n;
    } },
  });
  const result = await adapter.inspect(request());
  assert.equal(result.controllerAuthorized, false);
  assert.equal(result.balanceBaseUnits, "1000000");
});

test("rejects a malformed controller authorization response", async () => {
  const adapter = createViemAgonPrizeEscrowReadAdapter({
    enabled: true,
    escrowAddress: ESCROW,
    client: { readContract: async (input) => {
      if (input.functionName === "usdc") return USDC;
      if (input.functionName === "CONTROLLER_ROLE") return AGON_PRIZE_ESCROW_CONTROLLER_ROLE;
      if (input.functionName === "hasRole") return "true";
      return 1000000n;
    } },
  });
  await assert.rejects(() => adapter.inspect(request()), /controller authorization is invalid/);
});
