import assert from "node:assert/strict";
import test from "node:test";
import { PostgresAgonMarketService } from "../../src/agon/http/service.ts";
import type { StoredAgonEscrowIntent } from "../../src/agon/store/repository.ts";
import { AGON_PRIZE_ESCROW_CONTROLLER_ROLE } from "../../src/agon/execution/escrow-reconciliation.ts";

const ACTOR = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const CONTRACT = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const CONTROLLER = "0x2222222222222222222222222222222222222222" as `0x${string}`;
const USDC = "0x3600000000000000000000000000000000000000" as `0x${string}`;

function intent(): StoredAgonEscrowIntent {
  const now = new Date("2026-08-22T12:00:00.000Z");
  return {
    intentId: "00000000-0000-4000-8000-000000000009",
    actor: ACTOR,
    idempotencyKey: "escrow-readiness-001",
    listingReference: "5042002:0xcccccccccccccccccccccccccccccccccccccccc:7",
    termsHash: `0x${"11".repeat(32)}`,
    terms: {
      network: "eip155:5042002",
      asset: USDC,
      buyer: ACTOR as `0x${string}`,
      beneficiary: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      listing: {
        serviceRegistry: "0xcccccccccccccccccccccccccccccccccccccccc",
        listingId: "7",
        agentId: "42",
        version: "3",
        manifestHash: `0x${"22".repeat(32)}`,
      },
      amountBaseUnits: 1_000_000n,
      feeBps: 500,
      expiresAt: new Date("2026-08-23T12:00:00.000Z"),
    },
    state: "prepared",
    providerReference: null,
    transaction: null,
    poolBinding: { contractAddress: CONTRACT, controller: CONTROLLER, poolId: "7" },
    createdAt: now,
    updatedAt: now,
  };
}

function repository(current: StoredAgonEscrowIntent) {
  return { getAgonEscrowIntent: async () => current };
}

test("reports a bound pool as lookup-disabled without calling an adapter", async () => {
  let calls = 0;
  const service = new PostgresAgonMarketService(repository(intent()) as never, {
    escrowReadAdapter: { enabled: false, inspect: async () => { calls += 1; throw new Error("must not call"); } },
  });
  const result = await service.getAgonEscrowReadiness(ACTOR, intent().intentId);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.pool.status, "lookup_disabled");
  assert.equal(result.value.pool.contractAddress, CONTRACT);
  assert.equal(calls, 0);
});

test("reports an exact on-chain pool match without enabling execution", async () => {
  const service = new PostgresAgonMarketService(repository(intent()) as never, {
    escrowReadAdapter: {
      enabled: true,
      inspect: async (request) => ({
        network: request.network,
        escrowAddress: request.escrowAddress,
        asset: USDC,
        controller: request.controller,
        poolId: request.poolId,
        balanceBaseUnits: request.expectedBalanceBaseUnits!,
        controllerRole: AGON_PRIZE_ESCROW_CONTROLLER_ROLE,
        controllerAuthorized: true,
        checkedAt: "2026-08-22T12:01:00.000Z",
      }),
    },
  });
  const result = await service.getAgonEscrowReadiness(ACTOR, intent().intentId);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.pool.status, "match");
  assert.equal(result.value.pool.balanceBaseUnits, "1000000");
  assert.equal(result.value.executionEnabled, false);
});

test("classifies a strict pool identity or amount mismatch without mutating state", async () => {
  const service = new PostgresAgonMarketService(repository(intent()) as never, {
    escrowReadAdapter: { enabled: true, inspect: async () => { throw new Error("pool balance does not match the escrow intent"); } },
  });
  const result = await service.getAgonEscrowReadiness(ACTOR, intent().intentId);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.pool.status, "mismatch");
  assert.equal(result.value.state, "prepared");
});

test("reports an unapproved controller separately from a balance mismatch", async () => {
  const service = new PostgresAgonMarketService(repository(intent()) as never, {
    escrowReadAdapter: {
      enabled: true,
      inspect: async (request) => ({
        network: request.network,
        escrowAddress: request.escrowAddress,
        asset: USDC,
        controller: request.controller,
        poolId: request.poolId,
        balanceBaseUnits: request.expectedBalanceBaseUnits!,
        controllerRole: AGON_PRIZE_ESCROW_CONTROLLER_ROLE,
        controllerAuthorized: false,
      }),
    },
  });
  const result = await service.getAgonEscrowReadiness(ACTOR, intent().intentId);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.pool.status, "controller_unapproved");
});
