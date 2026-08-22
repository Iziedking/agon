import assert from "node:assert/strict";
import test from "node:test";
import {
  AGON_PRIZE_ESCROW_WRITE_NETWORK,
  PRIZE_ESCROW_REQUIRED_MUTATING_SIGNATURES,
  buildAgonPrizeEscrowWriteIntent,
  createDisabledAgonPrizeEscrowWritePreflightAdapter,
  createViemAgonPrizeEscrowWritePreflightAdapter,
} from "../../src/agon/execution/escrow-write-preflight.ts";
import { AGON_PRIZE_ESCROW_CONTROLLER_ROLE } from "../../src/agon/execution/escrow-reconciliation.ts";

const ESCROW = "0x1111111111111111111111111111111111111111";
const CONTROLLER = "0x2222222222222222222222222222222222222222";
const PARTICIPANT = "0x3333333333333333333333333333333333333333";
const USDC = "0x3600000000000000000000000000000000000000";

function request(overrides: Record<string, unknown> = {}) {
  return {
    network: AGON_PRIZE_ESCROW_WRITE_NETWORK,
    escrowAddress: ESCROW,
    controller: CONTROLLER,
    operation: "fund" as const,
    poolId: "7",
    amountBaseUnits: "1000000",
    participant: PARTICIPANT,
    expectedAsset: USDC,
    ...overrides,
  };
}

test("disabled write preflight performs no read and cannot execute", async () => {
  const adapter = createDisabledAgonPrizeEscrowWritePreflightAdapter();
  assert.equal(adapter.enabled, false);
  await assert.rejects(() => adapter.preflight(request()), /disabled by policy/);
});

test("pure intent builder creates deterministic fund calldata and stays execution-disabled", () => {
  const first = buildAgonPrizeEscrowWriteIntent(request());
  const second = buildAgonPrizeEscrowWriteIntent({ ...request(), amountBaseUnits: 1000000n });
  assert.equal(first.functionName, "depositPrizePool");
  assert.equal(first.execution, "disabled");
  assert.equal(first.poolId, "7");
  assert.equal(first.amountBaseUnits, "1000000");
  assert.deepEqual(first.args, [7n, PARTICIPANT, 1000000n]);
  assert.equal(first.data, second.data);
  assert.match(first.data, /^0x[0-9a-f]+$/);
});

test("release and refund both map to payout with the requested participant", () => {
  const release = buildAgonPrizeEscrowWriteIntent({ ...request(), operation: "release" });
  const refund = buildAgonPrizeEscrowWriteIntent({ ...request(), operation: "refund" });
  assert.equal(release.functionName, "payout");
  assert.equal(refund.functionName, "payout");
  assert.equal(release.data, refund.data);
});

test("rejects wrong network, asset, zero amount, and malformed addresses before RPC", () => {
  assert.throws(() => buildAgonPrizeEscrowWriteIntent({ ...request(), network: "eip155:1" }), /Arc Testnet/);
  assert.throws(() => buildAgonPrizeEscrowWriteIntent({ ...request(), expectedAsset: ESCROW }), /pinned to Arc Testnet USDC/);
  assert.throws(() => buildAgonPrizeEscrowWriteIntent({ ...request(), amountBaseUnits: "0" }), /positive/);
  assert.throws(() => buildAgonPrizeEscrowWriteIntent({ ...request(), participant: "0x123" }), /participant is invalid/);
});

test("enabled adapter performs bounded read-only code, asset, role, and authorization checks", async () => {
  const calls: string[] = [];
  const adapter = createViemAgonPrizeEscrowWritePreflightAdapter({
    enabled: true,
    escrowAddress: ESCROW,
    client: {
      getBytecode: async () => { calls.push("getBytecode"); return "0x60016000"; },
      readContract: async (input) => {
        calls.push(input.functionName);
        if (input.functionName === "usdc") return USDC;
        if (input.functionName === "CONTROLLER_ROLE") return AGON_PRIZE_ESCROW_CONTROLLER_ROLE;
        return true;
      },
    },
  });
  const result = await adapter.preflight(request());
  assert.equal(result.status, "preflight_passed");
  assert.equal(result.codePresent, true);
  assert.equal(result.controllerAuthorized, true);
  assert.deepEqual(calls.sort(), ["CONTROLLER_ROLE", "getBytecode", "hasRole", "usdc"]);
  assert.deepEqual(result.requiredMutatingSignatures, PRIZE_ESCROW_REQUIRED_MUTATING_SIGNATURES);
  assert.equal(result.intent.execution, "disabled");
});

test("fails closed on missing code, wrong role, or unauthorized controller", async () => {
  const base = {
    enabled: true,
    escrowAddress: ESCROW,
    client: {
      getBytecode: async () => "0x",
      readContract: async (input: { functionName: string }) => input.functionName === "usdc" ? USDC : input.functionName === "CONTROLLER_ROLE" ? AGON_PRIZE_ESCROW_CONTROLLER_ROLE : true,
    },
  } as const;
  await assert.rejects(() => createViemAgonPrizeEscrowWritePreflightAdapter(base).preflight(request()), /no deployed bytecode/);
  await assert.rejects(() => createViemAgonPrizeEscrowWritePreflightAdapter({ ...base, client: { ...base.client, getBytecode: async () => "0x6001", readContract: async (input: { functionName: string }) => input.functionName === "usdc" ? USDC : input.functionName === "CONTROLLER_ROLE" ? `0x${"11".repeat(32)}` : true } }).preflight(request()), /different controller role/);
  await assert.rejects(() => createViemAgonPrizeEscrowWritePreflightAdapter({ ...base, client: { ...base.client, getBytecode: async () => "0x6001", readContract: async (input: { functionName: string }) => input.functionName === "usdc" ? USDC : input.functionName === "CONTROLLER_ROLE" ? AGON_PRIZE_ESCROW_CONTROLLER_ROLE : false } }).preflight(request()), /not authorized/);
});
