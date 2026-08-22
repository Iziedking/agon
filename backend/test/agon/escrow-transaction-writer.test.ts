import assert from "node:assert/strict";
import test from "node:test";
import {
  AGON_ESCROW_TRANSACTION_APPROVAL_PHRASES,
  buildAgonEscrowTransactionApproval,
} from "../../src/agon/execution/escrow-transaction-approval.ts";
import { AGON_PRIZE_ESCROW_CONTROLLER_ROLE } from "../../src/agon/execution/escrow-reconciliation.ts";
import {
  PRIZE_ESCROW_REQUIRED_MUTATING_SIGNATURES,
  buildAgonPrizeEscrowWriteIntent,
  type AgonPrizeEscrowWritePreflightResult,
} from "../../src/agon/execution/escrow-write-preflight.ts";
import { createViemAgonEscrowTransactionWriter } from "../../src/agon/execution/escrow-transaction-writer.ts";

const ESCROW = "0x1111111111111111111111111111111111111111";
const CONTROLLER = "0x2222222222222222222222222222222222222222";
const PARTICIPANT = "0x3333333333333333333333333333333333333333";
const USDC = "0x3600000000000000000000000000000000000000";
const TX = `0x${"ab".repeat(32)}` as `0x${string}`;

function preflight(): AgonPrizeEscrowWritePreflightResult {
  const intent = buildAgonPrizeEscrowWriteIntent({
    network: "eip155:5042002",
    escrowAddress: ESCROW,
    controller: CONTROLLER,
    operation: "fund",
    poolId: "7",
    amountBaseUnits: "1000000",
    participant: PARTICIPANT,
    expectedAsset: USDC,
  });
  return {
    status: "preflight_passed",
    codePresent: true,
    controllerAuthorized: true,
    controllerRole: AGON_PRIZE_ESCROW_CONTROLLER_ROLE,
    requiredMutatingSignatures: PRIZE_ESCROW_REQUIRED_MUTATING_SIGNATURES,
    requiredMutatingSelectors: [],
    intent,
  };
}

function approval() {
  const result = buildAgonEscrowTransactionApproval({
    preflight: preflight(),
    request: {
      intentId: "escrow-intent-001",
      actor: CONTROLLER,
      operation: "fund",
      approvalIdempotencyKey: "writer-approval-001",
      confirmation: AGON_ESCROW_TRANSACTION_APPROVAL_PHRASES.fund,
    },
    nowSeconds: 1_700_000_000,
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function input(overrides: Record<string, unknown> = {}) {
  return { intentId: "escrow-intent-001", actor: CONTROLLER, preflight: preflight(), approval: approval(), nowSeconds: 1_700_000_001, ...overrides };
}

test("disabled writer makes no client calls even with an otherwise valid approval", async () => {
  let writes = 0;
  const writer = createViemAgonEscrowTransactionWriter({
    enabled: false,
    escrowAddress: ESCROW,
    client: {
      writeContract: async () => { writes += 1; return TX; },
      waitForTransactionReceipt: async () => { writes += 1; return { status: "success" as const, transactionHash: TX, to: ESCROW }; },
    },
  });
  const result = await writer.submit(input());
  assert.equal(writer.enabled, false);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "transaction_disabled");
  assert.equal(writes, 0);
});

test("requires approval and exact contract binding before the first write call", async () => {
  let writes = 0;
  const writer = createViemAgonEscrowTransactionWriter({
    enabled: true,
    escrowAddress: ESCROW,
    client: {
      writeContract: async () => { writes += 1; return TX; },
      waitForTransactionReceipt: async () => ({ status: "success" as const, transactionHash: TX, to: ESCROW }),
    },
  });
  const tampered = { ...approval(), approvalHash: `0x${"00".repeat(32)}` as `0x${string}` };
  const invalidApproval = await writer.submit(input({ approval: tampered }));
  assert.equal(invalidApproval.ok, false);
  if (!invalidApproval.ok) assert.equal(invalidApproval.error.code, "transaction_not_ready");
  const wrongContract = createViemAgonEscrowTransactionWriter({
    enabled: true,
    escrowAddress: "0x4444444444444444444444444444444444444444",
    client: {
      writeContract: async () => { writes += 1; return TX; },
      waitForTransactionReceipt: async () => ({ status: "success" as const, transactionHash: TX, to: ESCROW }),
    },
  });
  const contractResult = await wrongContract.submit(input());
  assert.equal(contractResult.ok, false);
  if (!contractResult.ok) assert.equal(contractResult.error.code, "transaction_not_ready");
  assert.equal(writes, 0);
});

test("writes exact preflight calldata as the controller and requires a matching successful receipt", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const writer = createViemAgonEscrowTransactionWriter({
    enabled: true,
    escrowAddress: ESCROW,
    client: {
      writeContract: async (call) => { calls.push(call as Record<string, unknown>); return TX; },
      waitForTransactionReceipt: async (call) => { calls.push(call as Record<string, unknown>); return { status: "success" as const, transactionHash: TX, to: ESCROW }; },
    },
  });
  const result = await writer.submit(input());
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.transaction, TX);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].address, ESCROW.toLowerCase());
  assert.equal(calls[0].functionName, "depositPrizePool");
  assert.deepEqual(calls[0].args, [7n, PARTICIPANT.toLowerCase(), 1000000n]);
  assert.equal(calls[0].account, CONTROLLER.toLowerCase());
  assert.deepEqual(calls[1], { hash: TX, timeout: 30_000 });
});

test("classifies a proven revert as terminal and an unavailable receipt as unknown", async () => {
  const reverted = createViemAgonEscrowTransactionWriter({
    enabled: true,
    escrowAddress: ESCROW,
    client: {
      writeContract: async () => TX,
      waitForTransactionReceipt: async () => ({ status: "reverted" as const, transactionHash: TX, to: ESCROW }),
    },
  });
  const revertedResult = await reverted.submit(input());
  assert.equal(revertedResult.ok, false);
  if (!revertedResult.ok) assert.equal(revertedResult.error.code, "transaction_reverted");

  const unknown = createViemAgonEscrowTransactionWriter({
    enabled: true,
    escrowAddress: ESCROW,
    client: {
      writeContract: async () => TX,
      waitForTransactionReceipt: async () => { throw new Error("timeout"); },
    },
  });
  const unknownResult = await unknown.submit(input());
  assert.equal(unknownResult.ok, false);
  if (!unknownResult.ok) assert.equal(unknownResult.error.code, "transaction_unknown");
});

test("rejects receipt evidence for another transaction or contract", async () => {
  const writer = createViemAgonEscrowTransactionWriter({
    enabled: true,
    escrowAddress: ESCROW,
    client: {
      writeContract: async () => TX,
      waitForTransactionReceipt: async () => ({ status: "success" as const, transactionHash: `0x${"cd".repeat(32)}`, to: "0x4444444444444444444444444444444444444444" }),
    },
  });
  const result = await writer.submit(input());
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "transaction_unknown");
});

test("does not retry or hide an ambiguous submission exception", async () => {
  let writes = 0;
  const writer = createViemAgonEscrowTransactionWriter({
    enabled: true,
    escrowAddress: ESCROW,
    client: {
      writeContract: async () => { writes += 1; throw new Error("provider disconnected after broadcast"); },
      waitForTransactionReceipt: async () => ({ status: "success" as const, transactionHash: TX, to: ESCROW }),
    },
  });
  const result = await writer.submit(input());
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "transaction_unknown");
  assert.equal(writes, 1);
});
