import assert from "node:assert/strict";
import test from "node:test";

import { parsePaymentRequiredHeader } from "../../src/agon/execution/x402-quote.ts";

const target = "https://provider.example/x402";
const asset = `0x${"11".repeat(20)}`;
const payTo = `0x${"22".repeat(20)}`;

function header(overrides: Record<string, unknown> = {}) {
  const payload = {
    x402Version: 2,
    resource: { url: target, description: "test", mimeType: "application/json" },
    accepts: [{
      scheme: "exact", network: "eip155:5042002", asset, amount: "1000",
      maxTimeoutSeconds: 600, payTo, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: asset },
    }],
    ...overrides,
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

test("parses and hashes a Circle Gateway x402 v2 quote", () => {
  const first = parsePaymentRequiredHeader(header(), target, "5042002", "0.01");
  const second = parsePaymentRequiredHeader(header(), target, "5042002", "0.01");
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (first.ok && second.ok) {
    assert.equal(first.value.quoteHash, second.value.quoteHash);
    assert.equal(first.value.snapshot.accepts[0]?.extra.name, "GatewayWalletBatched");
  }
});

test("fails closed for wrong network, missing Gateway metadata, or over-limit amount", () => {
  assert.equal(parsePaymentRequiredHeader(header({ accepts: [{ scheme: "exact", network: "eip155:1" }] }), target, "5042002", "0.01").ok, false);
  assert.equal(parsePaymentRequiredHeader(header({ accepts: [{ scheme: "exact", network: "eip155:5042002", asset, amount: "1000", maxTimeoutSeconds: 600, payTo, extra: {} }] }), target, "5042002", "0.01").ok, false);
  assert.equal(parsePaymentRequiredHeader(header({ accepts: [{ scheme: "exact", network: "eip155:5042002", asset, amount: "10001", maxTimeoutSeconds: 600, payTo, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: asset } }] }), target, "5042002", "0.01").ok, false);
});

test("rejects missing, malformed, and mismatched resource quotes", () => {
  assert.equal(parsePaymentRequiredHeader(null, target, "5042002", "0.01").ok, false);
  assert.equal(parsePaymentRequiredHeader("not-json", target, "5042002", "0.01").ok, false);
  assert.equal(parsePaymentRequiredHeader(header({ resource: { url: "https://other.example/x402" } }), target, "5042002", "0.01").ok, false);
});
