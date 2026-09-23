import assert from "node:assert/strict";
import test from "node:test";
import { probeX402RecoveryCandidate } from "../../src/agon/execution/x402-recovery.ts";
import type { X402ReceiptLookupAdapter } from "../../src/agon/execution/x402-reconciliation.ts";
import { PostgresAgonMarketService } from "../../src/agon/http/service.ts";
import type { StoredX402CallReceipt } from "../../src/agon/store/repository.ts";

const FROM = "0x1111111111111111111111111111111111111111";
const TO = "0x2222222222222222222222222222222222222222";
const TRANSFER = "11111111-1111-4111-8111-111111111111";

function receipt(): StoredX402CallReceipt {
  return {
    receiptId: "00000000-0000-4000-8000-000000000002",
    intentId: "00000000-0000-4000-8000-000000000001",
    state: "settlement_submitted",
    approvedAmountUSDC: "0.01",
    quoteHash: `0x${"01".repeat(32)}`,
    quoteSnapshot: { accepts: [{ network: "eip155:5042002", scheme: "exact", asset: "0x3600000000000000000000000000000000000000", amount: "1000", payTo: TO }] },
    authorizationPayloadHash: `0x${"cd".repeat(32)}`,
    authorizationPayload: { x402Version: 2, primaryType: "TransferWithAuthorization", domain: { name: "GatewayWalletBatched", version: "1", chainId: 5042002 }, message: { from: FROM, to: TO, value: "1000", nonce: `0x${"ab".repeat(32)}` } },
    authorizationHash: `0x${"ef".repeat(32)}`,
    settlementRef: `agon-x402:00000000-0000-4000-8000-000000000001:0x${"ee".repeat(32)}`,
    providerTransferId: null,
    serviceStatus: null,
    paymentResponseHash: null,
    chargedAmountUSDC: null,
    failureCode: null,
    failureMessage: null,
    createdAt: new Date("2026-09-23T12:00:00.000Z"),
    updatedAt: new Date("2026-09-23T12:00:01.000Z"),
  };
}

function lookup(overrides: Record<string, unknown> = {}): X402ReceiptLookupAdapter {
  return { enabled: true, async lookup() {
    return {
      network: "eip155:5042002",
      providerTransferId: TRANSFER,
      status: "confirmed",
      payer: FROM,
      recipient: TO,
      amountAtomicUnits: "1000",
      ...overrides,
    } as Awaited<ReturnType<X402ReceiptLookupAdapter["lookup"]>>;
  } };
}

test("a matching Circle transfer remains only an operator candidate", async () => {
  const stored = receipt();
  const result = await probeX402RecoveryCandidate({ receipt: stored, reference: { providerTransferId: TRANSFER }, lookup: lookup() });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.status, "confirmed");
    assert.equal(result.value.correlation, "terms_only");
    assert.equal(result.value.mayAutoFinalize, false);
    assert.equal(result.value.providerTransferId, TRANSFER);
  }
  assert.equal(stored.state, "settlement_submitted");
  assert.equal(stored.providerTransferId, null);
});

test("a candidate with a wrong payer, recipient, amount, or network is rejected", async () => {
  for (const wrong of [
    { payer: "0x3333333333333333333333333333333333333333" },
    { recipient: "0x3333333333333333333333333333333333333333" },
    { amountAtomicUnits: "2000" },
    { network: "eip155:1" },
  ]) {
    const result = await probeX402RecoveryCandidate({ receipt: receipt(), reference: { providerTransferId: TRANSFER }, lookup: lookup(wrong) });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "evidence_mismatch");
  }
});

test("pending or failed external status never resolves the local payment attempt", async () => {
  for (const status of ["pending", "failed"] as const) {
    const stored = receipt();
    const result = await probeX402RecoveryCandidate({ receipt: stored, reference: { providerTransferId: TRANSFER }, lookup: lookup({ status }) });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.status, status);
      assert.equal(result.value.mayAutoFinalize, false);
    }
    assert.equal(stored.state, "settlement_submitted");
  }
});

test("invalid or incomplete evidence does not trigger an external lookup", async () => {
  let calls = 0;
  const adapter: X402ReceiptLookupAdapter = { enabled: true, async lookup(input) { calls += 1; return lookup().lookup(input); } };
  const invalid = await probeX402RecoveryCandidate({ receipt: receipt(), reference: { providerTransferId: "not-a-uuid" }, lookup: adapter });
  assert.equal(invalid.ok, false);
  const incomplete = receipt();
  incomplete.authorizationPayload = {};
  const missing = await probeX402RecoveryCandidate({ receipt: incomplete, reference: { providerTransferId: TRANSFER }, lookup: adapter });
  assert.equal(missing.ok, false);
  assert.equal(calls, 0);
});

test("terminal or already referenced receipts refuse candidate recovery", async () => {
  const terminal = receipt();
  terminal.state = "reconciled";
  const recorded = receipt();
  recorded.providerTransferId = TRANSFER;
  for (const stored of [terminal, recorded]) {
    const result = await probeX402RecoveryCandidate({ receipt: stored, reference: { providerTransferId: TRANSFER }, lookup: lookup() });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "not_recoverable");
  }
});

test("lookup outage leaves the attempt unresolved", async () => {
  const result = await probeX402RecoveryCandidate({
    receipt: receipt(), reference: { providerTransferId: TRANSFER },
    lookup: { enabled: true, async lookup() { throw new Error("Circle unavailable"); } },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "lookup_unavailable");
});

test("the HTTP service scopes probes to the buyer and makes no repository writes", async () => {
  const stored = receipt();
  let reads = 0;
  let writes = 0;
  let lookups = 0;
  const repository = {
    getX402CallIntent: async () => ({ intentId: stored.intentId, actor: FROM }),
    getX402CallReceipt: async () => { reads += 1; return stored; },
    advanceX402CallReceipt: async () => { writes += 1; throw new Error("probe must not write"); },
  };
  const adapter: X402ReceiptLookupAdapter = {
    enabled: true,
    async lookup(input) { lookups += 1; return lookup().lookup(input); },
  };
  const service = new PostgresAgonMarketService(repository as never, { x402ReceiptLookup: adapter });
  const denied = await service.probeX402RecoveryCandidate(TO, stored.intentId, { providerTransferId: TRANSFER });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.error.code, "not_owner");
  assert.equal(reads, 0);
  assert.equal(lookups, 0);
  const result = await service.probeX402RecoveryCandidate(FROM, stored.intentId, { providerTransferId: TRANSFER });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.nextAction, "operator_review");
    assert.equal(result.value.correlation, "terms_only");
    assert.equal(result.value.mayAutoFinalize, false);
  }
  assert.equal(reads, 1);
  assert.equal(lookups, 1);
  assert.equal(writes, 0);
  assert.equal(stored.providerTransferId, null);
});
