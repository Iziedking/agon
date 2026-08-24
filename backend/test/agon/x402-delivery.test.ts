import assert from "node:assert/strict";
import test from "node:test";
import { validateX402DeliveryEvidence } from "../../src/agon/execution/x402-delivery.ts";

const NOW = new Date("2026-08-24T10:00:00.000Z");
const base = {
  deliveryId: "00000000-0000-4000-8000-000000000021",
  intentId: "00000000-0000-4000-8000-000000000022",
  receiptId: "00000000-0000-4000-8000-000000000023",
  provider: "0x1111111111111111111111111111111111111111",
  listingReference: "5042002:0x2222222222222222222222222222222222222222:1",
  serviceStatus: 200,
  latencyMs: 148,
  responseHash: `0x${"aa".repeat(32)}`,
  resultAttestationHash: `0x${"bb".repeat(32)}`,
  chargedAmountUSDC: "0.010000",
  deliveredAt: NOW,
};

test("canonicalizes provider delivery evidence and normalizes economic fields", () => {
  const evidence = validateX402DeliveryEvidence(base, NOW);
  assert.equal(evidence.provider, "0x1111111111111111111111111111111111111111");
  assert.equal(evidence.chargedAmountUSDC, "0.01");
  assert.match(evidence.evidenceHash, /^0x[0-9a-f]{64}$/);
  assert.equal(validateX402DeliveryEvidence({ ...base, provider: `0x${base.provider.slice(2).toUpperCase()}` }, NOW).evidenceHash, evidence.evidenceHash);
});

test("rejects delivery evidence that could falsely finalize a payment", () => {
  assert.throws(() => validateX402DeliveryEvidence({ ...base, serviceStatus: 402 }, NOW), /successful HTTP status/);
  assert.throws(() => validateX402DeliveryEvidence({ ...base, latencyMs: 900001 }, NOW), /latency/);
  assert.throws(() => validateX402DeliveryEvidence({ ...base, deliveredAt: new Date(NOW.getTime() + 60001) }, NOW), /future/);
  assert.throws(() => validateX402DeliveryEvidence({ ...base, responseHash: "0x1234" }, NOW), /response hash/);
});
