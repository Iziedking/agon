import assert from "node:assert/strict";
import test from "node:test";
import {
  createDisabledX402ReceiptLookupAdapter,
  validateX402ReceiptLookupResult,
} from "../../src/agon/execution/x402-reconciliation.ts";

const TX = `0x${"ab".repeat(32)}` as `0x${string}`;
const request = { network: "eip155:5042002" as const, transaction: TX };

test("validates an Arc Testnet provider receipt against the requested transaction", () => {
  const result = validateX402ReceiptLookupResult(
    { ...request, status: "confirmed", blockNumber: "123" },
    request,
  );
  assert.equal(result.transaction, TX);
});

test("rejects a receipt from another network or transaction", () => {
  assert.throws(
    () => validateX402ReceiptLookupResult({ ...request, network: "eip155:1", status: "confirmed" } as never, request),
    /Arc Testnet/,
  );
  assert.throws(
    () => validateX402ReceiptLookupResult({ ...request, transaction: `0x${"cd".repeat(32)}`, status: "confirmed" } as never, request),
    /different transaction/,
  );
});

test("the default lookup adapter is disabled and performs no provider call", async () => {
  const adapter = createDisabledX402ReceiptLookupAdapter();
  assert.equal(adapter.enabled, false);
  await assert.rejects(adapter.lookup(request), /disabled by policy/);
});
