import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  type Log,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { ViemAgonWriteAdapter } from "../../src/agon/write/adapter.ts";
import { agonProfileRegistryAbi, agonServiceRegistryAbi } from "../../src/agon/write/abi.ts";
import type { AgonReadiness } from "../../src/agon/write/readiness.ts";
import type {
  AgonOperationStore,
  ConfirmAgonOperation,
  PrepareAgonOperation,
  StoredAgonWriteOperation,
} from "../../src/agon/write/repository.ts";
import type { AgonDeployment } from "../../src/config/deployments.ts";

const ACTOR = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const PROFILE = "0x1111111111111111111111111111111111111111";
const SERVICE = "0x2222222222222222222222222222222222222222";
const IDENTITY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const TX_HASH = `0x${"33".repeat(32)}` as `0x${string}`;
const BLOCK_HASH = `0x${"44".repeat(32)}` as `0x${string}`;
const SERVICE_KEY = `0x${"55".repeat(32)}` as `0x${string}`;
const MANIFEST_HASH = `0x${"66".repeat(32)}` as `0x${string}`;

const deployment: AgonDeployment = {
  chainId: 5_042_002,
  contracts: { AgonProfileRegistry: PROFILE, AgonServiceRegistry: SERVICE },
  external: { IdentityRegistry: { address: IDENTITY, chainId: 5_042_002 } },
};

const ready: AgonReadiness = { ready: true, checkedAt: new Date(0).toISOString(), reasons: [] };

class MemoryOperations implements AgonOperationStore {
  rows = new Map<string, StoredAgonWriteOperation>();
  byPayload = new Map<string, string>();

  async prepare(input: PrepareAgonOperation): Promise<StoredAgonWriteOperation> {
    const key = `${input.actor}:${input.kind}:${input.payloadHash}`;
    const existingId = this.byPayload.get(key);
    if (existingId) return this.rows.get(existingId)!;
    const operation: StoredAgonWriteOperation = {
      ...input,
      operationId: `op-${this.rows.size + 1}`,
      state: "prepared",
      txHash: null,
      resultReference: null,
      blockNumber: null,
      logIndex: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    this.rows.set(operation.operationId, operation);
    this.byPayload.set(key, operation.operationId);
    return operation;
  }

  async getForActor(operationId: string, actor: string): Promise<StoredAgonWriteOperation | null> {
    const row = this.rows.get(operationId);
    return row?.actor === actor ? row : null;
  }

  async getByPayload(actor: string, kind: PrepareAgonOperation["kind"], payloadHash: string) {
    const operationId = this.byPayload.get(`${actor.toLowerCase()}:${kind}:${payloadHash.toLowerCase()}`);
    return operationId ? this.rows.get(operationId) ?? null : null;
  }

  async confirm(input: ConfirmAgonOperation): Promise<StoredAgonWriteOperation> {
    const row = await this.getForActor(input.operationId, input.actor);
    if (!row) throw new Error("not found");
    if (row.state === "confirmed" && row.txHash !== input.txHash) throw new Error("different transaction");
    const confirmed: StoredAgonWriteOperation = {
      ...row,
      state: "confirmed",
      txHash: input.txHash,
      resultReference: input.resultReference,
      blockNumber: input.blockNumber,
      logIndex: input.logIndex,
      updatedAt: new Date(1),
    };
    this.rows.set(input.operationId, confirmed);
    return confirmed;
  }
}

function receipt(logs: Log[], status: "success" | "reverted" = "success"): TransactionReceipt {
  return { status, logs, blockNumber: 123n, blockHash: BLOCK_HASH } as TransactionReceipt;
}

function profileLog(agentId = 42n, owner = ACTOR, metadataURI = "ipfs://profile"): Log {
  return {
    address: PROFILE,
    topics: encodeEventTopics({
      abi: agonProfileRegistryAbi,
      eventName: "ProfileBound",
      args: { agentId, owner },
    }),
    data: encodeAbiParameters([{ type: "string" }], [metadataURI]),
    logIndex: 7,
  } as Log;
}

function listingLog(overrides: { actor?: `0x${string}`; manifestHash?: `0x${string}` } = {}): Log {
  const actor = overrides.actor ?? ACTOR;
  const manifestHash = overrides.manifestHash ?? MANIFEST_HASH;
  return {
    address: SERVICE,
    topics: encodeEventTopics({
      abi: agonServiceRegistryAbi,
      eventName: "ListingPublished",
      args: { listingId: 9n, agentId: 42n, serviceKey: SERVICE_KEY },
    }),
    data: encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "string" },
        { type: "uint256" },
        { type: "uint8" },
        { type: "uint256" },
        { type: "address" },
        { type: "uint8" },
        { type: "uint8" },
      ],
      [manifestHash, "ipfs://manifest", 3n, 0, 1n, actor, 0, 0],
    ),
    logIndex: 8,
  } as Log;
}

function listingVersionLog(overrides: { actor?: `0x${string}`; manifestHash?: `0x${string}` } = {}): Log {
  const actor = overrides.actor ?? ACTOR;
  const manifestHash = overrides.manifestHash ?? MANIFEST_HASH;
  return {
    address: SERVICE,
    topics: encodeEventTopics({
      abi: agonServiceRegistryAbi,
      eventName: "ListingVersionPublished",
      args: { listingId: 9n, version: 2n, manifestHash },
    }),
    data: encodeAbiParameters(
      [{ type: "string" }, { type: "uint8" }, { type: "address" }],
      ["https://agent.example.com/manifest-v2.json", 0, actor],
    ),
    logIndex: 9,
  } as Log;
}

function setup(options: {
  owner?: `0x${string}`;
  readiness?: AgonReadiness;
  transactionReceipt?: TransactionReceipt;
} = {}) {
  const operations = new MemoryOperations();
  let simulations = 0;
  const client = {
    readContract: async ({ functionName }: { functionName?: string }) => functionName === "getListing"
      ? { agentId: 42n }
      : options.owner ?? ACTOR,
    simulateContract: async () => { simulations += 1; return { request: {}, result: undefined }; },
    getTransactionReceipt: async () => options.transactionReceipt ?? receipt([]),
  } as unknown as Pick<PublicClient, "readContract" | "simulateContract" | "getTransactionReceipt">;
  const adapter = new ViemAgonWriteAdapter({
    deployment,
    client,
    readiness: { get: async () => options.readiness ?? ready },
    operations,
  });
  return { adapter, operations, simulations: () => simulations };
}

test("does not read ownership or simulate when readiness is false", async () => {
  const { adapter, simulations } = setup({
    readiness: { ready: false, checkedAt: new Date(0).toISOString(), reasons: ["writes_disabled"] },
  });
  const result = await adapter.bindProfile(ACTOR, {
    chainId: "5042002",
    agentId: "42",
    metadataUri: "ipfs://profile",
  });
  assert.equal(result.ok, false);
  assert.equal(simulations(), 0);
});

test("refuses a wallet that is not the current ERC-8004 owner", async () => {
  const { adapter } = setup({ owner: OTHER });
  const result = await adapter.publishListing(ACTOR, {
    chainId: "5042002",
    agentId: "42",
    serviceKey: SERVICE_KEY,
    manifestHash: MANIFEST_HASH,
    manifestUri: "ipfs://manifest",
    category: "3",
    paymentRail: "X402",
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "not_owner");
});

test("prepares an exact simulated transaction idempotently without broadcasting", async () => {
  const { adapter, simulations } = setup();
  const request = { chainId: "5042002", agentId: "42", metadataUri: "ipfs://profile" };
  const first = await adapter.bindProfile(ACTOR, request);
  const second = await adapter.bindProfile(ACTOR, request);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(first.value.operationId, second.value.operationId);
  assert.equal(first.value.state, "prepared");
  assert.equal(first.value.transaction.to, PROFILE);
  assert.equal(first.value.transaction.functionName, "bindProfile");
  assert.equal(simulations(), 2);
});

test("confirms profile binding only from the exact canonical event", async () => {
  const { adapter } = setup({ transactionReceipt: receipt([profileLog()]) });
  const prepared = await adapter.bindProfile(ACTOR, {
    chainId: "5042002",
    agentId: "42",
    metadataUri: "ipfs://profile",
  });
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const confirmed = await adapter.confirmOperation(ACTOR, prepared.value.operationId, TX_HASH);
  assert.equal(confirmed.ok, true);
  if (!confirmed.ok) return;
  assert.equal(confirmed.value.state, "confirmed");
  assert.deepEqual(confirmed.value.proof, { blockNumber: "123", logIndex: 7 });
  assert.equal(confirmed.value.resultReference, null);
});

test("returns an already confirmed operation without simulating a duplicate write", async () => {
  const { adapter, simulations } = setup({ transactionReceipt: receipt([profileLog()]) });
  const request = { chainId: "5042002", agentId: "42", metadataUri: "ipfs://profile" };
  const prepared = await adapter.bindProfile(ACTOR, request);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const confirmed = await adapter.confirmOperation(ACTOR, prepared.value.operationId, TX_HASH);
  assert.equal(confirmed.ok, true);
  const replay = await adapter.bindProfile(ACTOR, request);
  assert.equal(replay.ok, true);
  if (!replay.ok) return;
  assert.equal(replay.value.state, "confirmed");
  assert.equal(replay.value.txHash, TX_HASH);
  assert.equal(simulations(), 1);
});

test("confirms listing publication and returns its canonical reference", async () => {
  const { adapter } = setup({ transactionReceipt: receipt([listingLog()]) });
  const prepared = await adapter.publishListing(ACTOR, {
    chainId: "5042002",
    agentId: "42",
    serviceKey: SERVICE_KEY,
    manifestHash: MANIFEST_HASH,
    manifestUri: "ipfs://manifest",
    category: "3",
    paymentRail: "X402",
  });
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const confirmed = await adapter.confirmOperation(ACTOR, prepared.value.operationId, TX_HASH);
  assert.equal(confirmed.ok, true);
  if (!confirmed.ok) return;
  assert.equal(confirmed.value.resultReference, `5042002:${SERVICE}:9`);
});

test("confirms listing version publication from its canonical event", async () => {
  const { adapter } = setup({ transactionReceipt: receipt([listingVersionLog()]) });
  const prepared = await adapter.publishListingVersion(ACTOR, {
    chainId: "5042002",
    listingId: "9",
    manifestHash: MANIFEST_HASH,
    manifestUri: "https://agent.example.com/manifest-v2.json",
    paymentRail: "X402",
  });
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const confirmed = await adapter.confirmOperation(ACTOR, prepared.value.operationId, TX_HASH);
  assert.equal(confirmed.ok, true);
  if (!confirmed.ok) return;
  assert.equal(confirmed.value.resultReference, `5042002:${SERVICE}:9`);
  assert.deepEqual(confirmed.value.proof, { blockNumber: "123", logIndex: 9 });
});

test("rejects reverted, mismatched, or duplicate matching receipt evidence", async () => {
  for (const transactionReceipt of [
    receipt([profileLog()], "reverted"),
    receipt([profileLog(42n, OTHER)]),
    receipt([profileLog(), profileLog()]),
  ]) {
    const { adapter } = setup({ transactionReceipt });
    const prepared = await adapter.bindProfile(ACTOR, {
      chainId: "5042002",
      agentId: "42",
      metadataUri: "ipfs://profile",
    });
    assert.equal(prepared.ok, true);
    if (!prepared.ok) continue;
    const confirmed = await adapter.confirmOperation(ACTOR, prepared.value.operationId, TX_HASH);
    assert.equal(confirmed.ok, false);
    if (!confirmed.ok) assert.equal(confirmed.error.code, "receipt_invalid");
  }
});
