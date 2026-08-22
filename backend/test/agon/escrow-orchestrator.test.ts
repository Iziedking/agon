import assert from "node:assert/strict";
import test from "node:test";
import {
  AGON_ESCROW_NETWORK,
  AGON_ESCROW_USDC,
  isAgonEscrowTransitionAllowed,
  type AgonEscrowAdapter,
} from "../../src/agon/escrow-policy.ts";
import { createAgonEscrowLifecycleOrchestrator, type AgonEscrowLifecycleStore } from "../../src/agon/execution/escrow-orchestrator.ts";
import type { StoredAgonEscrowIntent } from "../../src/agon/store/repository.ts";

const BUYER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`;
const BENEFICIARY = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as `0x${string}`;
const REGISTRY = "0xcccccccccccccccccccccccccccccccccccccccc" as `0x${string}`;
const NOW = new Date("2026-08-22T12:00:00.000Z");

function intent(state: StoredAgonEscrowIntent["state"] = "prepared"): StoredAgonEscrowIntent {
  return {
    intentId: "00000000-0000-4000-8000-000000000001",
    actor: BUYER,
    idempotencyKey: "escrow-orch-001",
    listingReference: `5042002:${REGISTRY}:7`,
    termsHash: `0x${"11".repeat(32)}`,
    terms: {
      network: AGON_ESCROW_NETWORK,
      asset: AGON_ESCROW_USDC,
      buyer: BUYER,
      beneficiary: BENEFICIARY,
      listing: {
        serviceRegistry: REGISTRY,
        listingId: "7",
        agentId: "42",
        version: "3",
        manifestHash: `0x${"22".repeat(32)}`,
      },
      amountBaseUnits: 1_000_000n,
      feeBps: 500,
      expiresAt: new Date("2026-08-23T12:00:00.000Z"),
    },
    state,
    providerReference: null,
    transaction: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function store(initial: StoredAgonEscrowIntent) {
  let current = initial;
  const transitions: string[] = [];
  return {
    transitions,
    store: {
      async getAgonEscrowIntent() { return current; },
      async advanceAgonEscrowIntent(input: Parameters<AgonEscrowLifecycleStore["advanceAgonEscrowIntent"]>[0]) {
        if (!isAgonEscrowTransitionAllowed(current.state, input.state)) throw new Error(`cannot transition from ${current.state} to ${input.state}`);
        transitions.push(input.state);
        current = {
          ...current,
          state: input.state,
          providerReference: input.providerReference ?? current.providerReference,
          transaction: input.transaction ?? current.transaction,
          updatedAt: new Date("2026-08-22T12:01:00.000Z"),
        };
        return current;
      },
    },
    current: () => current,
  };
}

function adapter(overrides: Partial<AgonEscrowAdapter> = {}): AgonEscrowAdapter {
  const result = { ok: true as const, value: { providerReference: "transfer-001", transaction: null } };
  return {
    enabled: true,
    fund: async () => result,
    release: async () => result,
    refund: async () => result,
    ...overrides,
  };
}

test("disabled orchestration performs no adapter call or state mutation", async () => {
  let calls = 0;
  const memory = store(intent());
  const orchestrator = createAgonEscrowLifecycleOrchestrator({
    enabled: false,
    store: memory.store,
    adapter: adapter({ fund: async () => { calls += 1; return { ok: true, value: { providerReference: "never", transaction: null } }; } }),
  });
  const result = await orchestrator.fund(intent().intentId);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "escrow_disabled");
  assert.equal(calls, 0);
  assert.deepEqual(memory.transitions, []);
  assert.equal(memory.current().state, "prepared");
});

test("funding writes the pending marker before a successful adapter call", async () => {
  const memory = store(intent());
  const observed: string[] = [];
  const orchestrator = createAgonEscrowLifecycleOrchestrator({
    enabled: true,
    store: memory.store,
    adapter: adapter({ fund: async () => {
      observed.push(memory.current().state);
      return { ok: true, value: { providerReference: "transfer-001", transaction: null } };
    } }),
  });
  const result = await orchestrator.fund(intent().intentId);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.state, "funded");
  assert.deepEqual(observed, ["funding"]);
  assert.deepEqual(memory.transitions, ["funding", "funded"]);
  assert.equal(memory.current().providerReference, "transfer-001");
});

test("ambiguous funding becomes unknown and blocks an automatic retry", async () => {
  const memory = store(intent());
  let calls = 0;
  const orchestrator = createAgonEscrowLifecycleOrchestrator({
    enabled: true,
    store: memory.store,
    adapter: adapter({ fund: async () => {
      calls += 1;
      throw new Error("provider timeout");
    } }),
  });
  const first = await orchestrator.fund(intent().intentId);
  assert.equal(first.ok, false);
  if (!first.ok) assert.equal(first.error.code, "escrow_unknown");
  assert.equal(memory.current().state, "unknown");
  const retry = await orchestrator.fund(intent().intentId);
  assert.equal(retry.ok, false);
  if (!retry.ok) assert.equal(retry.error.code, "escrow_unknown");
  assert.equal(calls, 1);
  assert.deepEqual(memory.transitions, ["funding", "unknown"]);
});

test("release and refund use the funded state and are idempotent after completion", async () => {
  const releaseMemory = store(intent("funded"));
  const release = createAgonEscrowLifecycleOrchestrator({ enabled: true, store: releaseMemory.store, adapter: adapter() });
  const released = await release.release(intent().intentId);
  assert.equal(released.ok, true);
  assert.equal(releaseMemory.current().state, "released");
  const replay = await release.release(intent().intentId);
  assert.equal(replay.ok, true);
  assert.deepEqual(releaseMemory.transitions, ["release_pending", "released"]);

  const refundMemory = store(intent("funded"));
  const refund = createAgonEscrowLifecycleOrchestrator({ enabled: true, store: refundMemory.store, adapter: adapter() });
  const refunded = await refund.refund(intent().intentId);
  assert.equal(refunded.ok, true);
  assert.equal(refundMemory.current().state, "refunded");
  assert.deepEqual(refundMemory.transitions, ["refund_pending", "refunded"]);
});

test("successful adapter output without provider evidence becomes unknown", async () => {
  const memory = store(intent());
  const orchestrator = createAgonEscrowLifecycleOrchestrator({
    enabled: true,
    store: memory.store,
    adapter: adapter({ fund: async () => ({ ok: true, value: { providerReference: null, transaction: null } }) }),
  });
  const result = await orchestrator.fund(intent().intentId);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "escrow_unknown");
  assert.equal(memory.current().state, "unknown");
});

test("a proven transaction revert becomes a durable terminal failure", async () => {
  const memory = store(intent());
  const orchestrator = createAgonEscrowLifecycleOrchestrator({
    enabled: true,
    store: memory.store,
    adapter: adapter({ fund: async () => ({ ok: false, error: { code: "escrow_reverted", message: "PrizeEscrow transaction reverted" } }) }),
  });
  const result = await orchestrator.fund(intent().intentId);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "escrow_failed");
  assert.equal(memory.current().state, "failed");
  assert.deepEqual(memory.transitions, ["funding", "failed"]);
});
