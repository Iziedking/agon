import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { AGON_ESCROW_NETWORK, AGON_ESCROW_USDC, hashAgonEscrowTerms, type AgonEscrowTerms } from "../../src/agon/escrow-policy.ts";
import { AGON_PRIZE_ESCROW_CONTROLLER_ROLE } from "../../src/agon/execution/escrow-reconciliation.ts";
import { AGON_ESCROW_TRANSACTION_APPROVAL_PHRASES } from "../../src/agon/execution/escrow-transaction-approval.ts";
import { buildAgonPrizeEscrowWriteIntent, PRIZE_ESCROW_REQUIRED_MUTATING_SIGNATURES } from "../../src/agon/execution/escrow-write-preflight.ts";
import { PostgresAgonMarketService, type PostgresAgonMarketServiceOptions } from "../../src/agon/http/service.ts";
import { PostgresAgonRepository } from "../../src/agon/store/repository.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

const ACTOR = `0x${"aa".repeat(20)}` as `0x${string}`;
const BENEFICIARY = `0x${"bb".repeat(20)}` as `0x${string}`;
const CONTRACT = `0x${"cc".repeat(20)}` as `0x${string}`;
const CONTROLLER = `0x${"dd".repeat(20)}` as `0x${string}`;
const REGISTRY = `0x${"ee".repeat(20)}` as `0x${string}`;
const INTENT_ID = "00000000-0000-4000-8000-000000000041";

const terms: AgonEscrowTerms = {
  network: AGON_ESCROW_NETWORK,
  asset: AGON_ESCROW_USDC,
  buyer: ACTOR,
  beneficiary: BENEFICIARY,
  listing: { serviceRegistry: REGISTRY, listingId: "7", agentId: "42", version: "1", manifestHash: `0x${"11".repeat(32)}` },
  amountBaseUnits: 1_000_000n,
  feeBps: 500,
  expiresAt: new Date("2027-01-01T00:00:00.000Z"),
};

let database: AgonTestDatabase;
let repository: PostgresAgonRepository;
let service: PostgresAgonMarketService;
let preflightCalls = 0;

function options(enabled = true): PostgresAgonMarketServiceOptions {
  return {
    escrowWritePreflightAdapter: {
      enabled,
      async preflight(input) {
        preflightCalls += 1;
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
    },
  };
}

before(async () => {
  database = await createAgonTestDatabase("escrow_transaction_approval");
  repository = new PostgresAgonRepository(database.pool);
  await repository.prepareAgonEscrowIntent({
    intentId: INTENT_ID,
    actor: ACTOR,
    idempotencyKey: "escrow-approval-intent-001",
    listingReference: `5042002:${REGISTRY}:7`,
    termsHash: hashAgonEscrowTerms(terms),
    terms,
    state: "prepared",
    providerReference: null,
    transaction: null,
    poolBinding: { contractAddress: CONTRACT, controller: CONTROLLER, poolId: "7" },
  });
  service = new PostgresAgonMarketService(repository, options());
});

after(async () => { if (database) await database.close(); });

test("persists an approval and reuses the exact row idempotently", async () => {
  preflightCalls = 0;
  const request = { operation: "fund" as const, approvalIdempotencyKey: "escrow-approval-001", confirmation: AGON_ESCROW_TRANSACTION_APPROVAL_PHRASES.fund };
  const first = await service.approveAgonEscrowTransaction(ACTOR, INTENT_ID, request);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.value.executionEnabled, false);
  assert.equal(first.value.status, "approved");
  assert.equal(preflightCalls, 1);
  const replay = await service.approveAgonEscrowTransaction(ACTOR, INTENT_ID, request);
  assert.equal(replay.ok, true);
  if (!replay.ok) return;
  assert.equal(replay.value.approvalHash, first.value.approvalHash);
  assert.equal(preflightCalls, 1);
  const readiness = await service.getAgonEscrowTransactionApproval(ACTOR, INTENT_ID);
  assert.equal(readiness.ok, true);
  if (readiness.ok) assert.equal(readiness.value.status, "approved");
});

test("rejects an approval idempotency key reused for another operation", async () => {
  const result = await service.approveAgonEscrowTransaction(ACTOR, INTENT_ID, {
    operation: "release",
    approvalIdempotencyKey: "escrow-approval-001",
    confirmation: AGON_ESCROW_TRANSACTION_APPROVAL_PHRASES.release,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "conflict");
});

test("disabled preflight refuses a new approval without creating a row", async () => {
  const disabled = new PostgresAgonMarketService(repository, options(false));
  const result = await disabled.approveAgonEscrowTransaction(ACTOR, INTENT_ID, {
    operation: "fund",
    approvalIdempotencyKey: "escrow-approval-002",
    confirmation: AGON_ESCROW_TRANSACTION_APPROVAL_PHRASES.fund,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "execution_not_ready");
  const row = await repository.getAgonEscrowTransactionApproval(INTENT_ID, "escrow-approval-002");
  assert.equal(row, null);
});
