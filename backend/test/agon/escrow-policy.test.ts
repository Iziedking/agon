import assert from "node:assert/strict";
import test from "node:test";
import {
  AGON_ESCROW_NETWORK,
  AGON_ESCROW_USDC,
  AgonEscrowIntentLedger,
  allocateAgonPrizePool,
  createDisabledAgonEscrowAdapter,
  evaluateAgonEscrowTerms,
  hashAgonEscrowTerms,
} from "../../src/agon/escrow-policy.ts";

const SERVICE = "0x1111111111111111111111111111111111111111" as const;
const PROVIDER = "0x2222222222222222222222222222222222222222" as const;
const BUYER = "0x3333333333333333333333333333333333333333" as const;
const MANIFEST = `0x${"aa".repeat(32)}` as const;
const NOW = new Date("2026-08-22T12:00:00.000Z");
const EXPIRY = new Date("2026-08-23T12:00:00.000Z");

function listing(overrides: Record<string, unknown> = {}) {
  return {
    serviceRegistry: SERVICE,
    listingId: "7",
    agentId: "42",
    version: "3",
    manifestHash: MANIFEST,
    providerSnapshot: PROVIDER,
    status: "Listed" as const,
    verification: "Verified" as const,
    paymentRail: "Escrow" as const,
    ...overrides,
  };
}

function terms() {
  const result = evaluateAgonEscrowTerms({ listing: listing(), buyer: BUYER, amountBaseUnits: 1_000_000n, feeBps: 500, now: NOW, expiresAt: EXPIRY });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

test("accepts only listed, verified Escrow listings on Arc Testnet USDC", () => {
  const accepted = terms();
  assert.equal(accepted.network, AGON_ESCROW_NETWORK);
  assert.equal(accepted.asset, AGON_ESCROW_USDC);
  assert.equal(accepted.beneficiary, PROVIDER);
  assert.equal(hashAgonEscrowTerms(accepted), hashAgonEscrowTerms({ ...accepted, expiresAt: new Date(EXPIRY) }));
  assert.deepEqual(evaluateAgonEscrowTerms({ listing: listing({ verification: "Unverified" }), buyer: BUYER, amountBaseUnits: 1n, feeBps: 0, now: NOW, expiresAt: EXPIRY }), {
    ok: false,
    error: { code: "escrow_not_eligible", message: "escrow requires a listed, verified listing whose payment rail is Escrow" },
  });
  assert.deepEqual(evaluateAgonEscrowTerms({ listing: listing({ paymentRail: "X402" }), buyer: BUYER, amountBaseUnits: 1n, feeBps: 0, now: NOW, expiresAt: EXPIRY }), {
    ok: false,
    error: { code: "escrow_not_eligible", message: "escrow requires a listed, verified listing whose payment rail is Escrow" },
  });
  assert.deepEqual(evaluateAgonEscrowTerms({ listing: listing({ quarantineReason: "manifest mismatch" }), buyer: BUYER, amountBaseUnits: 1n, feeBps: 0, now: NOW, expiresAt: EXPIRY }), {
    ok: false,
    error: { code: "escrow_not_eligible", message: "escrow requires a listed, verified listing whose payment rail is Escrow" },
  });
});

test("rejects malformed amounts, fees, addresses, and expired terms", () => {
  assert.deepEqual(evaluateAgonEscrowTerms({ listing: listing(), buyer: BUYER, amountBaseUnits: "0", feeBps: 0, now: NOW, expiresAt: EXPIRY }), {
    ok: false,
    error: { code: "invalid_escrow_terms", message: "escrow amount must be a positive integer base-unit value" },
  });
  assert.deepEqual(evaluateAgonEscrowTerms({ listing: listing(), buyer: BUYER, amountBaseUnits: 1n, feeBps: 1001, now: NOW, expiresAt: EXPIRY }), {
    ok: false,
    error: { code: "invalid_escrow_terms", message: "escrow fee is fixed at 500 basis points" },
  });
  assert.deepEqual(evaluateAgonEscrowTerms({ listing: listing(), buyer: BUYER, amountBaseUnits: 1n, feeBps: 500, now: NOW, expiresAt: NOW }), {
    ok: false,
    error: { code: "invalid_escrow_terms", message: "escrow expiry must be in the future" },
  });
  assert.deepEqual(evaluateAgonEscrowTerms({ listing: listing(), buyer: "0x12", amountBaseUnits: 1n, feeBps: 500, now: NOW, expiresAt: EXPIRY }), {
    ok: false,
    error: { code: "invalid_escrow_terms", message: "escrow addresses are invalid" },
  });
});

test("prepares escrow idempotently and binds the exact terms", () => {
  const ledger = new AgonEscrowIntentLedger();
  const first = ledger.prepare({ intentId: "intent-001", idempotencyKey: "escrow-001", terms: terms(), now: NOW });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.value.decision, "prepared");
  const replay = ledger.prepare({ intentId: "intent-001", idempotencyKey: "escrow-001", terms: terms(), now: NOW });
  assert.equal(replay.ok, true);
  if (replay.ok) assert.equal(replay.value.decision, "idempotent_replay");
  assert.deepEqual(ledger.prepare({ intentId: "intent-002", idempotencyKey: "escrow-001", terms: { ...terms(), amountBaseUnits: 2_000_000n }, now: NOW }), {
    ok: false,
    error: { code: "idempotency_conflict", message: "escrow idempotency key is bound to different terms" },
  });
});

test("revalidates pinned terms before creating an intent", () => {
  const ledger = new AgonEscrowIntentLedger();
  assert.deepEqual(ledger.prepare({
    intentId: "intent-006",
    idempotencyKey: "escrow-006",
    terms: { ...terms(), network: "eip155:1" as never },
    now: NOW,
  }), {
    ok: false,
    error: { code: "invalid_escrow_terms", message: "escrow terms are not pinned to the approved network, asset, identities, or economics" },
  });
});

test("keeps unknown escrow outcomes from being silently retried", () => {
  const ledger = new AgonEscrowIntentLedger();
  assert.equal(ledger.prepare({ intentId: "intent-003", idempotencyKey: "escrow-003", terms: terms(), now: NOW }).ok, true);
  assert.equal(ledger.transition({ idempotencyKey: "escrow-003", state: "funding", now: NOW }).ok, true);
  assert.equal(ledger.transition({ idempotencyKey: "escrow-003", state: "unknown", now: NOW }).ok, true);
  assert.deepEqual(ledger.transition({ idempotencyKey: "escrow-003", state: "funding", now: NOW }), {
    ok: false,
    error: { code: "invalid_transition", message: "cannot transition escrow intent from unknown to funding" },
  });
  assert.deepEqual(ledger.transition({ idempotencyKey: "escrow-003", state: "released", now: NOW }), {
    ok: false,
    error: { code: "invalid_transition", message: "cannot transition escrow intent from unknown to released" },
  });
});

test("enforces guarded funding, release, and refund transitions", () => {
  const ledger = new AgonEscrowIntentLedger();
  ledger.prepare({ intentId: "intent-004", idempotencyKey: "escrow-004", terms: terms(), now: NOW });
  assert.equal(ledger.transition({ idempotencyKey: "escrow-004", state: "funding", now: NOW }).ok, true);
  assert.equal(ledger.transition({ idempotencyKey: "escrow-004", state: "funded", providerReference: "provider-1", transaction: `0x${"bb".repeat(32)}`, now: NOW }).ok, true);
  assert.equal(ledger.transition({ idempotencyKey: "escrow-004", state: "release_pending", now: NOW }).ok, true);
  assert.equal(ledger.transition({ idempotencyKey: "escrow-004", state: "released", transaction: `0x${"cc".repeat(32)}`, now: NOW }).ok, true);
  assert.deepEqual(ledger.transition({ idempotencyKey: "escrow-004", state: "refund_pending", now: NOW }), {
    ok: false,
    error: { code: "invalid_transition", message: "cannot transition escrow intent from released to refund_pending" },
  });
});

test("conserves prize pool value and assigns integer remainder to the top rank", () => {
  const result = allocateAgonPrizePool({
    poolBaseUnits: 101n,
    platformFeeBps: 0,
    winners: [
      { beneficiary: PROVIDER, rank: 1, weightBps: 5_000 },
      { beneficiary: BUYER, rank: 2, weightBps: 5_000 },
    ],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.shares[0]?.amountBaseUnits, 51n);
  assert.equal(result.value.shares[1]?.amountBaseUnits, 50n);
  assert.equal(result.value.shares.reduce((sum, share) => sum + share.amountBaseUnits, 0n) + result.value.platformFeeBaseUnits, 101n);
});

test("rejects duplicate winners and weights that do not conserve the distribution", () => {
  assert.deepEqual(allocateAgonPrizePool({ poolBaseUnits: 100n, platformFeeBps: 0, winners: [{ beneficiary: PROVIDER, rank: 1, weightBps: 5_000 }] }), {
    ok: false,
    error: { code: "invalid_escrow_terms", message: "prize winner weights must total 10000 basis points" },
  });
  assert.deepEqual(allocateAgonPrizePool({ poolBaseUnits: 100n, platformFeeBps: 0, winners: [{ beneficiary: PROVIDER, rank: 1, weightBps: 5_000 }, { beneficiary: PROVIDER, rank: 2, weightBps: 5_000 }] }), {
    ok: false,
    error: { code: "invalid_escrow_terms", message: "prize winners must have unique addresses, positive ranks, and positive weights" },
  });
});

test("disabled escrow adapter performs no provider operation", async () => {
  const adapter = createDisabledAgonEscrowAdapter();
  assert.equal(adapter.enabled, false);
  const escrowTerms = terms();
  assert.deepEqual(await adapter.fund({ intentId: "intent-005", terms: escrowTerms }), {
    ok: false,
    error: { code: "escrow_disabled", message: "Agon escrow execution is disabled by policy" },
  });
  assert.deepEqual(await adapter.release({ intentId: "intent-005", beneficiary: PROVIDER, amountBaseUnits: 1n }), {
    ok: false,
    error: { code: "escrow_disabled", message: "Agon escrow execution is disabled by policy" },
  });
});
