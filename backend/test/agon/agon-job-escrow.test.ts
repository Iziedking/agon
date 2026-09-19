import assert from "node:assert/strict";
import test from "node:test";
import {
  AGON_JOB_ESCROW_ABI,
  AGON_JOB_ESCROW_V2_READ_ABI,
  buildAgonJobEscrowWritePlan,
  createDisabledAgonJobEscrowReadAdapter,
  createViemAgonJobEscrowReadAdapter,
  validateAgonJobEscrowReceipt,
} from "../../src/agon/execution/agon-job-escrow.ts";
import { createViemAgonJobEscrowTransactionWriter } from "../../src/agon/execution/agon-job-escrow-writer.ts";
import { createAgonJobEscrowTransactionAdapter } from "../../src/agon/execution/agon-job-escrow-adapter.ts";
import type { AgonJobEscrowIntent } from "../../src/agon/execution/job-escrow-state.ts";
import { keccak256, stringToHex, toHex } from "viem";

const ESCROW = "0x1111111111111111111111111111111111111111";
const REGISTRY = "0x2222222222222222222222222222222222222222";
const USDC = "0x3600000000000000000000000000000000000000";
const RESOLVER = "0x3333333333333333333333333333333333333333";
const BUYER = "0x4444444444444444444444444444444444444444";
const PROVIDER = "0x5555555555555555555555555555555555555555";
const TX = `0x${"ab".repeat(32)}` as `0x${string}`;
const TERMS = `0x${"11".repeat(32)}`;
const REASON = `0x${"22".repeat(32)}`;

function intent(overrides: Partial<AgonJobEscrowIntent> = {}): AgonJobEscrowIntent {
  return {
    intentId: "intent-12345678",
    idempotencyKey: "idem-12345678",
    actor: BUYER.toLowerCase() as `0x${string}`,
    buyer: BUYER.toLowerCase() as `0x${string}`,
    provider: PROVIDER.toLowerCase() as `0x${string}`,
    listingReference: "listing:one",
    network: "eip155:5042002",
    asset: USDC.toLowerCase() as `0x${string}`,
    escrowContract: ESCROW.toLowerCase() as `0x${string}`,
    serviceRegistry: REGISTRY.toLowerCase() as `0x${string}`,
    listingId: "9",
    agentId: "100",
    listingVersion: "2",
    manifestHash: `0x${"33".repeat(32)}`,
    termsHash: TERMS as `0x${string}`,
    amountBaseUnits: 1000000n,
    feeBps: 500,
    reviewHours: 24,
    expiresAt: new Date(Date.now() + 3600000),
    clientReference: `0x${"aa".repeat(32)}`,
    state: "prepared",
    settlement: "none",
    onchainJobId: null,
    transactionHash: null,
    deliverableHash: null,
    reasonHash: null,
    lastReconciledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function eventTopic(signature: string) {
  return keccak256(stringToHex(signature));
}

test("builds exact disabled AgonJobEscrow calldata for every lifecycle action", () => {
  const create = buildAgonJobEscrowWritePlan({
    contractAddress: ESCROW,
    action: "create",
    clientReference: `0x${"aa".repeat(32)}`,
    listingId: "7",
    termsHash: TERMS,
    amountBaseUnits: "1000000",
    reviewHours: 24,
  });
  assert.equal(create.functionName, "createJob");
  assert.equal(create.execution, "disabled");
  assert.equal(create.chainId, 5042002);
  assert.equal(create.args[1], 7n);
  assert.equal(create.data, "0x" + create.data.slice(2));

  const submit = buildAgonJobEscrowWritePlan({ contractAddress: ESCROW, action: "submit", jobId: "7", deliverableHash: REASON });
  const refund = buildAgonJobEscrowWritePlan({ contractAddress: ESCROW, action: "resolve_refund", jobId: "7" });
  assert.equal(submit.functionName, "submitJob");
  assert.equal(refund.functionName, "resolveDispute");
  assert.equal(refund.args[1], false);
});

test("rejects unsafe job plan inputs", () => {
  assert.throws(() => buildAgonJobEscrowWritePlan({ contractAddress: ESCROW, action: "accept", jobId: "0" }), /positive/);
  assert.throws(() => buildAgonJobEscrowWritePlan({ contractAddress: ESCROW, action: "reject", jobId: "1", reasonHash: `0x${"00".repeat(32)}` }), /non-zero/);
  assert.throws(() => buildAgonJobEscrowWritePlan({ contractAddress: ESCROW, action: "create", clientReference: TERMS, listingId: "1", termsHash: TERMS, amountBaseUnits: "1", feeBps: 1001, reviewHours: 1 }), /fixed at 500/);
});

test("receipt verification requires the configured contract, successful status, and lifecycle event", () => {
  const jobId = 7n;
  const result = validateAgonJobEscrowReceipt({
    receipt: {
      status: "success",
      transactionHash: TX,
      to: ESCROW,
      logs: [{ address: ESCROW, topics: [eventTopic("JobAccepted(uint256,address)"), toHex(jobId, { size: 32 }), BUYER] }],
    },
    contractAddress: ESCROW,
    action: "accept",
    transactionHash: TX,
    jobId,
  });
  assert.deepEqual(result, { ok: true, transactionHash: TX, event: "JobAccepted" });
  assert.equal(validateAgonJobEscrowReceipt({ receipt: { status: "success", transactionHash: TX, to: ESCROW, logs: [] }, contractAddress: ESCROW, action: "accept", transactionHash: TX, jobId }).ok, false);
  assert.equal(validateAgonJobEscrowReceipt({ receipt: { status: "reverted", transactionHash: TX, to: ESCROW }, contractAddress: ESCROW, action: "accept", transactionHash: TX, jobId }).code, "receipt_reverted");
});

test("receipt verification accepts the V2 JobCreated event signature", () => {
  const result = validateAgonJobEscrowReceipt({
    receipt: {
      status: "success",
      transactionHash: TX,
      to: ESCROW,
      logs: [{
        address: ESCROW,
        topics: [eventTopic("JobCreated(uint256,bytes32,address,address,uint256,uint256,uint256,bytes32,bytes32,uint256,uint256,uint16,uint64,uint64)")],
      }],
    },
    contractAddress: ESCROW,
    contractVersion: "v2",
    action: "create",
    transactionHash: TX,
  });
  assert.deepEqual(result, { ok: true, transactionHash: TX, event: "JobCreated" });
});

test("disabled read adapter never reaches an RPC client", async () => {
  const adapter = createDisabledAgonJobEscrowReadAdapter();
  assert.equal(adapter.enabled, false);
  await assert.rejects(() => adapter.inspect("1"), /disabled by policy/);
});

test("read adapter pins bytecode, asset, registry, resolver, and job identity", async () => {
  let calls = 0;
  const job = [
    7n, BUYER, PROVIDER, 9n, 100n, 2n, `0x${"33".repeat(32)}`, TERMS, `0x${"44".repeat(32)}`,
    1000000n, 10000n, 24n, 1_900_000_000n, 0n, 1_899_900_000n, 0n, 2, 0,
  ];
  const adapter = createViemAgonJobEscrowReadAdapter({
    enabled: true,
    escrowAddress: ESCROW,
    expectedServiceRegistry: REGISTRY,
    expectedAsset: USDC,
    expectedDisputeResolver: RESOLVER,
    client: {
      async getBytecode() { calls += 1; return "0x6001"; },
      async readContract(input) {
        calls += 1;
        if (input.functionName === "usdc") return USDC;
        if (input.functionName === "serviceRegistry") return REGISTRY;
        if (input.functionName === "disputeResolver") return RESOLVER;
        return job;
      },
    },
  });
  const result = await adapter.inspect("7");
  assert.equal(result.jobId, "7");
  assert.equal(result.provider, PROVIDER.toLowerCase());
  assert.equal(result.status, 2);
  assert.equal(calls, 5);
  assert.deepEqual(AGON_JOB_ESCROW_ABI.some((item) => item.type === "function" && item.name === "getJob"), true);
});

test("read adapter can inspect a pre-switch job through the legacy contract address", async () => {
  const legacy = "0x6666666666666666666666666666666666666666";
  const job = [
    7n, BUYER, PROVIDER, 9n, 100n, 1n, `0x${"33".repeat(32)}`, TERMS, `0x${"44".repeat(32)}`,
    1000000n, 10000n, 500, 24n, 1_900_000_000n, 0n, 1_899_900_000n, 0n, 2, 0,
  ];
  const adapter = createViemAgonJobEscrowReadAdapter({
    enabled: true,
    escrowAddress: ESCROW,
    legacyEscrowAddresses: [legacy],
    expectedServiceRegistry: REGISTRY,
    expectedAsset: USDC,
    expectedDisputeResolver: RESOLVER,
    client: {
      async getBytecode(input) { return input.address === legacy ? "0x6001" : "0x"; },
      async readContract(input) {
        if (input.address !== legacy) throw new Error("current escrow has no job");
        assert.equal(input.abi, AGON_JOB_ESCROW_V2_READ_ABI);
        if (input.functionName === "usdc") return USDC;
        if (input.functionName === "serviceRegistry") return REGISTRY;
        if (input.functionName === "disputeResolver") return RESOLVER;
        return job;
      },
    },
  });
  const result = await adapter.inspect("7");
  assert.equal(result.listingVersion, "1");
  assert.equal(result.feeBps, 500);
});

test("read adapter normalizes V2 fee snapshots and keeps legacy fallback readable", async () => {
  const v2 = "0x7777777777777777777777777777777777777777";
  const legacy = "0x8888888888888888888888888888888888888888";
  const job = [
    7n, BUYER, PROVIDER, 9n, 100n, 2n, `0x${"33".repeat(32)}`, TERMS, `0x${"44".repeat(32)}`,
    1000000n, 2500n, 250, 24n, 1_900_000_000n, 0n, 1_899_900_000n, 0n, 2, 0,
  ];
  const adapter = createViemAgonJobEscrowReadAdapter({
    enabled: true,
    escrowAddress: v2,
    escrowVersion: "v2",
    legacyEscrowAddresses: [legacy],
    expectedServiceRegistry: REGISTRY,
    expectedAsset: USDC,
    expectedDisputeResolver: RESOLVER,
    client: {
      async getBytecode(input) { return input.address === v2 ? "0x6001" : "0x"; },
      async readContract(input) {
        assert.equal(input.abi, AGON_JOB_ESCROW_V2_READ_ABI);
        if (input.functionName === "usdc") return USDC;
        if (input.functionName === "serviceRegistry") return REGISTRY;
        if (input.functionName === "disputeResolver") return RESOLVER;
        return job;
      },
    },
  });
  const result = await adapter.inspect("7");
  assert.equal(result.listingVersion, "2");
  assert.equal(result.feeBps, 250);
  assert.equal(result.reviewHours, 24);
  assert.equal(result.status, 2);
});

test("deployed writer remains disabled without an explicit client and flag", async () => {
  let calls = 0;
  const writer = createViemAgonJobEscrowTransactionWriter({ enabled: false, escrowAddress: ESCROW, client: { async writeContract() { calls += 1; return TX; }, async waitForTransactionReceipt() { calls += 1; return { status: "success", transactionHash: TX, to: ESCROW, logs: [] }; } } });
  assert.equal(writer.enabled, false);
  const result = await writer.submit({ intent: intent(), action: "create", actor: BUYER });
  assert.deepEqual(result, { ok: false, error: { code: "transaction_disabled", message: "AgonJobEscrow transaction writing is disabled by policy" } });
  assert.equal(calls, 0);
});

test("legacy fee-input deployment cannot enable the fixed-fee writer", async () => {
  let calls = 0;
  const writer = createViemAgonJobEscrowTransactionWriter({
    enabled: true,
    escrowAddress: ESCROW,
    escrowVersion: "legacy",
    client: {
      async writeContract() { calls += 1; return TX; },
      async waitForTransactionReceipt() { calls += 1; return { status: "success", transactionHash: TX, to: ESCROW, logs: [] }; },
    },
  });
  assert.equal(writer.enabled, false);
  assert.equal((await writer.submit({ intent: intent(), action: "create", actor: BUYER })).error?.code, "transaction_disabled");
  assert.equal(calls, 0);
});

test("deployed writer binds account, contract and event-verified receipt", async () => {
  const calls: string[] = [];
  const writer = createViemAgonJobEscrowTransactionWriter({ enabled: true, escrowAddress: ESCROW, allowedActors: [BUYER], client: {
    async writeContract(input) { calls.push(`${input.functionName}:${input.account}:${input.address}`); return TX; },
    async waitForTransactionReceipt() { return { status: "success", transactionHash: TX, to: ESCROW, logs: [{ address: ESCROW, topics: [eventTopic("JobCreated(uint256,bytes32,address,address,uint256,uint256,uint256,bytes32,bytes32,uint256,uint256,uint64,uint64)")] }] }; },
  } });
  const result = await writer.submit({ intent: intent(), action: "create", actor: BUYER });
  assert.equal(result.ok, true);
  assert.equal(calls[0], `createJob:${BUYER.toLowerCase()}:${ESCROW.toLowerCase()}`);
});

test("deployed writer fails closed on ambiguous, reverted, and mismatched receipts", async () => {
  const ambiguous = createViemAgonJobEscrowTransactionWriter({ enabled: true, escrowAddress: ESCROW, client: { async writeContract() { throw new Error("rpc timeout"); }, async waitForTransactionReceipt() { throw new Error("unreachable"); } } });
  assert.equal((await ambiguous.submit({ intent: intent(), action: "create", actor: BUYER })).error?.code, "transaction_unknown");
  const reverted = createViemAgonJobEscrowTransactionWriter({ enabled: true, escrowAddress: ESCROW, client: { async writeContract() { return TX; }, async waitForTransactionReceipt() { return { status: "reverted", transactionHash: TX, to: ESCROW, logs: [] }; } } });
  assert.equal((await reverted.submit({ intent: intent(), action: "create", actor: BUYER })).error?.code, "transaction_reverted");
  const mismatched = createViemAgonJobEscrowTransactionWriter({ enabled: true, escrowAddress: ESCROW, client: { async writeContract() { return TX; }, async waitForTransactionReceipt() { return { status: "success", transactionHash: TX, to: REGISTRY, logs: [] }; } } });
  assert.equal((await mismatched.submit({ intent: intent(), action: "create", actor: BUYER })).error?.code, "transaction_not_ready");
});

test("deployed adapter persists only receipt-proven submissions and leaves unknowns reconcilable", async () => {
  let marked: string | null = null;
  const stored = intent();
  const writer = createViemAgonJobEscrowTransactionWriter({ enabled: true, escrowAddress: ESCROW, client: {
    async writeContract() { return TX; },
    async waitForTransactionReceipt() { return { status: "success", transactionHash: TX, to: ESCROW, logs: [{ address: ESCROW, topics: [eventTopic("JobCreated(uint256,bytes32,address,address,uint256,uint256,uint256,bytes32,bytes32,uint256,uint256,uint64,uint64)")] }] }; },
  } });
  const adapter = createAgonJobEscrowTransactionAdapter({ enabled: true, writer, repository: {
    async getAgonJobEscrowIntent() { return stored; },
    async markAgonJobEscrowSubmitted(input) { marked = input.transactionHash; return stored; },
  } });
  const result = await adapter.submit({ intentId: stored.intentId, action: "create", actor: BUYER });
  assert.equal(result.ok, true);
  assert.equal(marked, TX);
});
