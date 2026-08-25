import assert from "node:assert/strict";
import test from "node:test";

import { parseProviderPaymentChallenge, validateProviderHealth } from "../../src/agon/provider-contract.ts";

const endpoint = "https://provider.example/execute";
const expected = { serviceKey: "code-review", version: "0.1.0", endpoint, chainId: "5042002", maxAmountUSDC: "0.01" };
const asset = "0x3600000000000000000000000000000000000000";
const payTo = "0x0000000000000000000000000000000000000001";

function header(overrides: Record<string, unknown> = {}): string {
  return Buffer.from(JSON.stringify({
    x402Version: 2,
    resource: { url: endpoint },
    accepts: [{
      scheme: "exact", network: "eip155:5042002", asset, amount: "1000", payTo, maxTimeoutSeconds: 60,
      extra: { name: "GatewayWalletBatched", version: "1", serviceKey: "code-review", serviceVersion: "0.1.0", verifyingContract: payTo },
      ...overrides,
    }],
  })).toString("base64");
}

test("validates the provider health contract", () => {
  const result = validateProviderHealth({ ok: true, service: "agon-provider", serviceKey: "code-review", version: "0.1.0", status: "ready", runtime: "node" }, expected);
  assert.equal(result.ok, true);
});

test("rejects health with a wrong service or version", () => {
  assert.equal(validateProviderHealth({ ok: true, service: "agon-provider", serviceKey: "other", version: "0.1.0", status: "ready", runtime: "node" }, expected).ok, false);
  assert.equal(validateProviderHealth({ ok: true, service: "agon-provider", serviceKey: "code-review", version: "0.2.0", status: "ready", runtime: "node" }, expected).ok, false);
});

test("parses a matching x402 provider challenge", () => {
  const result = parseProviderPaymentChallenge(header(), expected);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.snapshot.accepts[0]?.extra.serviceKey, "code-review");
});

test("rejects malformed, oversized, and mismatched payment challenges", () => {
  assert.equal(parseProviderPaymentChallenge("not-json", expected).ok, false);
  assert.equal(parseProviderPaymentChallenge(header({ extra: { name: "GatewayWalletBatched", version: "1", serviceKey: "other", serviceVersion: "0.1.0", verifyingContract: payTo } }), expected).ok, false);
  assert.equal(parseProviderPaymentChallenge("x".repeat(70_000), expected).ok, false);
  assert.equal(parseProviderPaymentChallenge(header({ network: "eip155:1" }), expected).ok, false);
});
