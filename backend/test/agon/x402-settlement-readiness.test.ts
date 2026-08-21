import assert from "node:assert/strict";
import test from "node:test";
import type { PostgresAgonRepository, StoredX402CallIntent, StoredX402CallReceipt } from "../../src/agon/store/repository.ts";
import { PostgresAgonMarketService } from "../../src/agon/http/service.ts";

const ACTOR = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const INTENT_ID = "00000000-0000-4000-8000-000000000001";
const TX_HASH = `0x${"11".repeat(32)}`;

const intent: StoredX402CallIntent = {
  intentId: INTENT_ID,
  actor: ACTOR,
  idempotencyKey: "readiness-001",
  listingReference: "5042002:0x3333333333333333333333333333333333333333:1",
  chainId: 5042002n,
  serviceRegistry: "0x3333333333333333333333333333333333333333",
  listingId: 1n,
  agentId: 42n,
  version: 1n,
  method: "GET",
  input: {},
  inputHash: `0x${"22".repeat(32)}`,
  maxAmountUSDC: "0.01",
  targetUrl: "https://provider.example/x402",
  state: "prepared",
  createdAt: new Date("2026-08-21T10:00:00.000Z"),
  updatedAt: new Date("2026-08-21T10:00:00.000Z"),
};

function receipt(state: StoredX402CallReceipt["state"], settlementRef: string | null = null): StoredX402CallReceipt {
  return {
    receiptId: "00000000-0000-4000-8000-000000000002",
    intentId: INTENT_ID,
    state,
    approvedAmountUSDC: "0.01",
    quoteHash: null,
    quoteSnapshot: null,
    authorizationPayloadHash: null,
    authorizationPayload: null,
    authorizationHash: state === "authorization_submitted" ? `0x${"33".repeat(32)}` : null,
    settlementRef,
    serviceStatus: null,
    paymentResponseHash: null,
    chargedAmountUSDC: null,
    failureCode: null,
    failureMessage: null,
    createdAt: new Date("2026-08-21T10:00:00.000Z"),
    updatedAt: new Date("2026-08-21T10:01:00.000Z"),
  };
}

test("maps durable receipt states to explicit, fail-closed settlement readiness", async () => {
  let current = receipt("authorization_submitted");
  const repository = {
    getX402CallIntent: async () => intent,
    getX402CallReceipt: async () => current,
  } as unknown as PostgresAgonRepository;
  const service = new PostgresAgonMarketService(repository);

  const authorization = await service.getX402SettlementReadiness(ACTOR, INTENT_ID);
  assert.equal(authorization.ok, true);
  if (!authorization.ok) return;
  assert.deepEqual(
    {
      state: authorization.value.state,
      status: authorization.value.status,
      nextAction: authorization.value.nextAction,
      executionEnabled: authorization.value.executionEnabled,
    },
    {
      state: "authorization_submitted",
      status: "ready_but_disabled",
      nextAction: "execution_adapter_not_enabled",
      executionEnabled: false,
    },
  );

  current = receipt("unknown");
  const unknown = await service.getX402SettlementReadiness(ACTOR, INTENT_ID);
  assert.equal(unknown.ok, true);
  if (!unknown.ok) return;
  assert.equal(unknown.value.status, "reconciliation_required");
  assert.equal(unknown.value.nextAction, "reconcile_settlement");

  current = receipt("settlement_submitted", TX_HASH);
  const submitted = await service.getX402SettlementReadiness(ACTOR, INTENT_ID);
  assert.equal(submitted.ok, true);
  if (!submitted.ok) return;
  assert.equal(submitted.value.status, "service_delivery_pending");
  assert.equal(submitted.value.settlementRef, TX_HASH);
  assert.equal(submitted.value.nextAction, "deliver_service");

  current = receipt("reconciled", TX_HASH);
  const terminal = await service.getX402SettlementReadiness(ACTOR, INTENT_ID);
  assert.equal(terminal.ok, true);
  if (!terminal.ok) return;
  assert.equal(terminal.value.status, "terminal");
  assert.equal(terminal.value.nextAction, "none");
});

test("never exposes opaque settlement attempts and enforces intent ownership", async () => {
  let current = receipt("settlement_submitted", "attempt:approval-001");
  const repository = {
    getX402CallIntent: async () => intent,
    getX402CallReceipt: async () => current,
  } as unknown as PostgresAgonRepository;
  const service = new PostgresAgonMarketService(repository);

  const submitted = await service.getX402SettlementReadiness(ACTOR, INTENT_ID);
  assert.equal(submitted.ok, true);
  if (!submitted.ok) return;
  assert.equal(submitted.value.settlementRef, null);
  assert.match(submitted.value.reason, /trusted transaction receipt/i);

  const refused = await service.getX402SettlementReadiness("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", INTENT_ID);
  assert.deepEqual(refused, {
    ok: false,
    error: { code: "not_owner", message: "only the intent owner can inspect settlement readiness" },
  });
});
