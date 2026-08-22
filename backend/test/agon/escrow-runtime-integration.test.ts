import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { AGON_ESCROW_NETWORK, AGON_ESCROW_USDC, hashAgonEscrowTerms, type AgonEscrowTerms } from "../../src/agon/escrow-policy.ts";
import { AGON_PRIZE_ESCROW_CONTROLLER_ROLE, type AgonPrizeEscrowReadAdapter } from "../../src/agon/execution/escrow-reconciliation.ts";
import { AGON_ESCROW_TRANSACTION_APPROVAL_PHRASES } from "../../src/agon/execution/escrow-transaction-approval.ts";
import { buildAgonPrizeEscrowWriteIntent, PRIZE_ESCROW_REQUIRED_MUTATING_SIGNATURES, type AgonPrizeEscrowWritePreflightAdapter } from "../../src/agon/execution/escrow-write-preflight.ts";
import { createViemAgonEscrowTransactionWriter, type AgonEscrowTransactionWriteClient } from "../../src/agon/execution/escrow-transaction-writer.ts";
import { PostgresAgonMarketService } from "../../src/agon/http/service.ts";
import { PostgresAgonRepository } from "../../src/agon/store/repository.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

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
  expiresAt: new Date(Date.now() + 300_000),
};

let database: AgonTestDatabase;
let repository: PostgresAgonRepository;

before(async () => {
  database = await createAgonTestDatabase("escrow_runtime_integration");
  repository = new PostgresAgonRepository(database.pool);
});

after(async () => { if (database) await database.close(); });

async function seedIntent(intentId: string) {
  return repository.prepareAgonEscrowIntent({
    intentId,
    actor: ACTOR,
    idempotencyKey: `runtime-${intentId.slice(-8)}`,
    listingReference: `5042002:${REGISTRY}:7`,
    termsHash: hashAgonEscrowTerms(terms),
    terms,
    state: "prepared",
    providerReference: null,
    transaction: null,
    poolBinding: { contractAddress: CONTRACT, controller: CONTROLLER, poolId: "7" },
  });
}

function readAdapter(): AgonPrizeEscrowReadAdapter {
  return {
    enabled: true,
    async inspect(input) {
      return {
        network: input.network,
        escrowAddress: input.escrowAddress,
        asset: AGON_ESCROW_USDC,
        controller: input.controller,
        poolId: input.poolId,
        balanceBaseUnits: terms.amountBaseUnits.toString(),
        controllerRole: AGON_PRIZE_ESCROW_CONTROLLER_ROLE,
        controllerAuthorized: true,
        checkedAt: new Date().toISOString(),
      };
    },
  };
}

function preflightAdapter(): AgonPrizeEscrowWritePreflightAdapter {
  return {
    enabled: true,
    async preflight(input) {
      const intent = buildAgonPrizeEscrowWriteIntent({
        network: input.network,
        escrowAddress: input.escrowAddress,
        controller: input.controller,
        operation: input.operation,
        poolId: input.poolId,
        amountBaseUnits: input.amountBaseUnits,
        participant: input.participant,
        expectedAsset: input.expectedAsset,
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
    },
  };
}

function service(mode: "success" | "timeout", executionEnabled = true) {
  let writes = 0;
  const client: AgonEscrowTransactionWriteClient = {
    async writeContract() { writes += 1; return TX; },
    async waitForTransactionReceipt() {
      if (mode === "timeout") throw new Error("receipt timeout");
      return { status: "success" as const, transactionHash: TX, to: CONTRACT };
    },
  };
  const writer = createViemAgonEscrowTransactionWriter({ enabled: true, escrowAddress: CONTRACT, client });
  const value = new PostgresAgonMarketService(repository, {
    escrowExecutionEnabled: executionEnabled,
    escrowPoolContract: CONTRACT,
    escrowReadAdapter: readAdapter(),
    escrowWritePreflightAdapter: preflightAdapter(),
    escrowTransactionWriter: writer,
  });
  return { value, writes: () => writes };
}

async function approve(intentId: string, value: PostgresAgonMarketService) {
  const result = await value.approveAgonEscrowTransaction(ACTOR, intentId, {
    operation: "fund",
    approvalIdempotencyKey: `runtime-approval-${intentId.slice(-8)}`,
    confirmation: AGON_ESCROW_TRANSACTION_APPROVAL_PHRASES.fund,
  });
  assert.equal(result.ok, true);
}

test("runs prepare, durable approval, fresh preflight, and fake receipt to funded", async () => {
  const id = "00000000-0000-4000-8000-000000000061";
  await seedIntent(id);
  const runtime = service("success");
  await approve(id, runtime.value);
  const result = await runtime.value.fundAgonEscrow(ACTOR, id, "FUND_ARC_TESTNET_ESCROW");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.state, "funded");
    assert.equal(result.value.transaction, TX);
  }
  assert.equal(runtime.writes(), 1);
});

test("keeps the lifecycle unknown after a fake receipt timeout", async () => {
  const id = "00000000-0000-4000-8000-000000000062";
  await seedIntent(id);
  const runtime = service("timeout");
  await approve(id, runtime.value);
  const result = await runtime.value.fundAgonEscrow(ACTOR, id, "FUND_ARC_TESTNET_ESCROW");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "conflict");
  const stored = await repository.getAgonEscrowIntent(id);
  assert.equal(stored?.state, "unknown");
  assert.equal(runtime.writes(), 1);
});

test("execution flag disables the integrated writer before any fake client call", async () => {
  const id = "00000000-0000-4000-8000-000000000063";
  await seedIntent(id);
  const runtime = service("success", false);
  const result = await runtime.value.fundAgonEscrow(ACTOR, id, "FUND_ARC_TESTNET_ESCROW");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "escrow_disabled");
  assert.equal(runtime.writes(), 0);
  const stored = await repository.getAgonEscrowIntent(id);
  assert.equal(stored?.state, "prepared");
});

