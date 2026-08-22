import assert from "node:assert/strict";
import test from "node:test";
import { AGON_ESCROW_NETWORK, AGON_ESCROW_USDC, type AgonEscrowTerms } from "../../src/agon/escrow-policy.ts";
import { AGON_PRIZE_ESCROW_CONTROLLER_ROLE } from "../../src/agon/execution/escrow-reconciliation.ts";
import { buildAgonPrizeEscrowWriteIntent, PRIZE_ESCROW_REQUIRED_MUTATING_SIGNATURES, type AgonPrizeEscrowWritePreflightResult } from "../../src/agon/execution/escrow-write-preflight.ts";
import { createApprovalBoundAgonEscrowTransactionAdapter } from "../../src/agon/execution/escrow-transaction-adapter.ts";
import type { StoredAgonEscrowIntent, StoredAgonEscrowTransactionApproval } from "../../src/agon/store/repository.ts";

const INTENT_ID = "00000000-0000-4000-8000-000000000051";
const ACTOR = `0x${"aa".repeat(20)}` as `0x${string}`;
const CONTROLLER = `0x${"bb".repeat(20)}` as `0x${string}`;
const BENEFICIARY = `0x${"cc".repeat(20)}` as `0x${string}`;
const CONTRACT = `0x${"dd".repeat(20)}` as `0x${string}`;
const REGISTRY = `0x${"ee".repeat(20)}` as `0x${string}`;
const TX = `0x${"12".repeat(32)}` as `0x${string}`;

const terms: AgonEscrowTerms = {
  network: AGON_ESCROW_NETWORK,
  asset: AGON_ESCROW_USDC,
  buyer: ACTOR,
  beneficiary: BENEFICIARY,
  listing: { serviceRegistry: REGISTRY, listingId: "7", agentId: "42", version: "1", manifestHash: `0x${"11".repeat(32)}` },
  amountBaseUnits: 1_000_000n,
  feeBps: 500,
  expiresAt: new Date(Date.now() + 60_000),
};

const intent: StoredAgonEscrowIntent = {
  intentId: INTENT_ID,
  actor: ACTOR,
  idempotencyKey: "adapter-intent-001",
  listingReference: `5042002:${REGISTRY}:7`,
  termsHash: `0x${"21".repeat(32)}`,
  terms,
  state: "prepared",
  providerReference: null,
  transaction: null,
  poolBinding: { contractAddress: CONTRACT, controller: CONTROLLER, poolId: "7" },
  createdAt: new Date(),
  updatedAt: new Date(),
};

function approval(expiresAt = new Date(Date.now() + 60_000)): StoredAgonEscrowTransactionApproval {
  return {
    approvalHash: `0x${"31".repeat(32)}`,
    intentId: INTENT_ID,
    actor: ACTOR,
    operation: "fund",
    intentHash: `0x${"41".repeat(32)}`,
    approvalIdempotencyKey: "adapter-approval-001",
    approvedAt: new Date(Date.now() - 1_000),
    expiresAt,
    createdAt: new Date(),
  };
}

function preflight(): AgonPrizeEscrowWritePreflightResult {
  const writeIntent = buildAgonPrizeEscrowWriteIntent({
    network: AGON_ESCROW_NETWORK,
    escrowAddress: CONTRACT,
    controller: CONTROLLER,
    operation: "fund",
    poolId: "7",
    amountBaseUnits: terms.amountBaseUnits,
    participant: ACTOR,
    expectedAsset: AGON_ESCROW_USDC,
  });
  return {
    status: "preflight_passed",
    codePresent: true,
    controllerAuthorized: true,
    controllerRole: AGON_PRIZE_ESCROW_CONTROLLER_ROLE,
    requiredMutatingSignatures: PRIZE_ESCROW_REQUIRED_MUTATING_SIGNATURES,
    requiredMutatingSelectors: [],
    intent: writeIntent,
  };
}

test("disabled integration adapter performs no preflight or writer call", async () => {
  let preflightCalls = 0;
  let writerCalls = 0;
  const adapter = createApprovalBoundAgonEscrowTransactionAdapter({
    enabled: false,
    store: { getAgonEscrowIntent: async () => intent, getAgonEscrowTransactionApproval: async () => approval() },
    preflight: { enabled: true, preflight: async () => { preflightCalls += 1; return preflight(); } },
    writer: { enabled: true, submit: async () => { writerCalls += 1; return { ok: true, value: { providerReference: null, transaction: TX } }; } },
  });
  const result = await adapter.fund({ intentId: INTENT_ID, terms });
  assert.equal(adapter.enabled, false);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "escrow_disabled");
  assert.equal(preflightCalls, 0);
  assert.equal(writerCalls, 0);
});

test("requires a non-expired, operation-matching durable approval", async () => {
  let writerCalls = 0;
  const adapter = createApprovalBoundAgonEscrowTransactionAdapter({
    enabled: true,
    store: { getAgonEscrowIntent: async () => intent, getAgonEscrowTransactionApproval: async () => null },
    preflight: { enabled: true, preflight: async () => preflight() },
    writer: { enabled: true, submit: async () => { writerCalls += 1; return { ok: true, value: { providerReference: null, transaction: TX } }; } },
  });
  const missing = await adapter.fund({ intentId: INTENT_ID, terms });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.error.message, /durable transaction approval/);
  assert.equal(writerCalls, 0);

  const expired = createApprovalBoundAgonEscrowTransactionAdapter({
    enabled: true,
    store: { getAgonEscrowIntent: async () => intent, getAgonEscrowTransactionApproval: async () => approval(new Date(Date.now() - 1)) },
    preflight: { enabled: true, preflight: async () => preflight() },
    writer: { enabled: true, submit: async () => { writerCalls += 1; return { ok: true, value: { providerReference: null, transaction: TX } }; } },
  });
  const expiredResult = await expired.fund({ intentId: INTENT_ID, terms });
  assert.equal(expiredResult.ok, false);
  if (!expiredResult.ok) assert.match(expiredResult.error.message, /expired/);
  assert.equal(writerCalls, 0);
});

test("passes exact intent, approval actor, and fresh preflight to the writer", async () => {
  let received: Record<string, unknown> | null = null;
  const adapter = createApprovalBoundAgonEscrowTransactionAdapter({
    enabled: true,
    store: { getAgonEscrowIntent: async () => intent, getAgonEscrowTransactionApproval: async () => approval() },
    preflight: { enabled: true, preflight: async (request) => { assert.equal(request.operation, "fund"); assert.equal(request.poolId, "7"); assert.equal(request.participant, ACTOR); return preflight(); } },
    writer: {
      enabled: true,
      submit: async (input) => { received = input as unknown as Record<string, unknown>; return { ok: true, value: { providerReference: null, transaction: TX } }; },
    },
  });
  const result = await adapter.fund({ intentId: INTENT_ID, terms });
  assert.equal(result.ok, true);
  assert.equal(received?.intentId, INTENT_ID);
  assert.equal(received?.actor, ACTOR);
  const durableApproval = received?.approval as { executionEnabled: boolean; testnetOnly: boolean; operation: string };
  assert.equal(durableApproval.executionEnabled, false);
  assert.equal(durableApproval.testnetOnly, true);
  assert.equal(durableApproval.operation, "fund");
});

