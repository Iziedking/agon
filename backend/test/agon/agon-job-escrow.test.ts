import assert from "node:assert/strict";
import test from "node:test";
import {
  AGON_JOB_ESCROW_ABI,
  buildAgonJobEscrowWritePlan,
  createDisabledAgonJobEscrowReadAdapter,
  createViemAgonJobEscrowReadAdapter,
  validateAgonJobEscrowReceipt,
} from "../../src/agon/execution/agon-job-escrow.ts";
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
    feeBps: 100,
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
  assert.throws(() => buildAgonJobEscrowWritePlan({ contractAddress: ESCROW, action: "create", clientReference: TERMS, listingId: "1", termsHash: TERMS, amountBaseUnits: "1", feeBps: 1001, reviewHours: 1 }), /fee bps/);
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
