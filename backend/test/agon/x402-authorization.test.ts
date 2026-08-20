import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";

import { buildX402Authorization, validateX402AuthorizationSignature } from "../../src/agon/execution/x402-authorization.ts";
import type { X402QuoteSnapshot } from "../../src/agon/execution/x402-quote.ts";

const ACTOR = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const snapshot: X402QuoteSnapshot = {
  x402Version: 2,
  resource: { url: "https://provider.example/x402" },
  accepts: [{
    scheme: "exact", network: "eip155:5042002", asset: `0x${"11".repeat(20)}`,
    amount: "1000", maxTimeoutSeconds: 600, payTo: `0x${"22".repeat(20)}`,
    extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: `0x${"33".repeat(20)}` },
  }],
};

test("builds an unsigned Circle Gateway EIP-712 authorization payload", () => {
  const result = buildX402Authorization(ACTOR, "5042002", snapshot, 1_787_240_000);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.payload.domain.name, "GatewayWalletBatched");
    assert.equal(result.value.payload.primaryType, "TransferWithAuthorization");
    assert.equal(result.value.payload.message.value, "1000");
    assert.match(result.value.payload.message.nonce, /^0x[0-9a-f]{64}$/);
    assert.match(result.value.payloadHash, /^0x[0-9a-f]{64}$/);
  }
});

test("refuses malformed actor, chain, or missing Gateway metadata", () => {
  assert.equal(buildX402Authorization("not-an-address", "5042002", snapshot).ok, false);
  assert.equal(buildX402Authorization(ACTOR, "not-chain", snapshot).ok, false);
  assert.equal(buildX402Authorization(ACTOR, "5042002", { ...snapshot, accepts: [{ ...snapshot.accepts[0]!, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: undefined } }] }).ok, false);
});

test("accepts only a signature from the prepared authorization owner", async () => {
  const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
  const built = buildX402Authorization(account.address, "5042002", snapshot, 1_787_240_000);
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const signature = await account.signTypedData({
    domain: built.value.payload.domain,
    types: built.value.payload.types,
    primaryType: built.value.payload.primaryType,
    message: {
      ...built.value.payload.message,
      value: BigInt(built.value.payload.message.value),
      validAfter: BigInt(built.value.payload.message.validAfter),
      validBefore: BigInt(built.value.payload.message.validBefore),
    },
  });
  const checked = await validateX402AuthorizationSignature(built.value.payload, signature, account.address, 1_787_240_000);
  assert.equal(checked.ok, true);
  if (checked.ok) assert.match(checked.value.signatureHash, /^0x[0-9a-f]{64}$/);

  const wrongOwner = await validateX402AuthorizationSignature(built.value.payload, signature, ACTOR, 1_787_240_000);
  assert.equal(wrongOwner.ok, false);
});

test("rejects malformed and expired signatures before any settlement boundary", async () => {
  const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
  const built = buildX402Authorization(account.address, "5042002", snapshot, 1_787_240_000);
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const malformed = await validateX402AuthorizationSignature(built.value.payload, "0x12", account.address, 1_787_240_000);
  assert.equal(malformed.ok, false);
  const expired = await validateX402AuthorizationSignature(built.value.payload, `0x${"11".repeat(65)}`, account.address, 1_800_000_000);
  assert.equal(expired.ok, false);
});
