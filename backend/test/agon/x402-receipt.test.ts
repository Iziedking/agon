import assert from "node:assert/strict";
import test from "node:test";

import { transitionX402Receipt, X402ReceiptInvariantError } from "../../src/agon/execution/x402-receipt.ts";

const hash = `0x${"11".repeat(32)}`;

test("requires explicit approval before a payment requirement can be recorded", () => {
  assert.equal(transitionX402Receipt("prepared", { type: "approve", approvedAmountUSDC: "0.01" }).to, "approved");
  assert.throws(() => transitionX402Receipt("prepared", { type: "payment_required", quoteHash: hash }), X402ReceiptInvariantError);
});

test("models the Circle x402 lifecycle without treating settlement as final", () => {
  let state = transitionX402Receipt("prepared", { type: "approve", approvedAmountUSDC: "0.01" });
  state = transitionX402Receipt(state.to, { type: "payment_required", quoteHash: hash, quoteSnapshot: { x402Version: 2, accepts: [] } });
  state = transitionX402Receipt(state.to, { type: "authorization_submitted", authorizationHash: `0x${"22".repeat(32)}` });
  state = transitionX402Receipt(state.to, { type: "settlement_submitted", settlementRef: "gateway-settlement-123" });
  assert.equal(state.to, "settlement_submitted");
  state = transitionX402Receipt(state.to, { type: "service_delivered", serviceStatus: 200, paymentResponseHash: `0x${"33".repeat(32)}` });
  assert.equal(state.to, "service_delivered");
  assert.equal(transitionX402Receipt(state.to, { type: "reconcile" }).to, "reconciled");
});

test("keeps terminal failures immutable and rejects invalid evidence", () => {
  assert.throws(() => transitionX402Receipt("reconciled", { type: "fail", failureCode: "late", failureMessage: "late" }), /cannot move/);
  assert.throws(() => transitionX402Receipt("approved", { type: "payment_required", quoteHash: "0x00", quoteSnapshot: {} }), /bytes32/);
  assert.throws(() => transitionX402Receipt("settlement_submitted", { type: "service_delivered", serviceStatus: 402, paymentResponseHash: hash }), /successful HTTP/);
});
