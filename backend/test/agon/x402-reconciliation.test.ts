import assert from "node:assert/strict";
import test from "node:test";
import {
  createCircleTestnetX402ReceiptLookupAdapter,
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

test("looks up a Circle transfer UUID read-only and maps finality states", async () => {
  const transferId = "3c90c3cc-0d44-4b50-8888-8dd25736052a";
  let called = 0;
  const adapter = createCircleTestnetX402ReceiptLookupAdapter({
    enabled: true,
    fetchImpl: async (url) => {
      called += 1;
      assert.equal(url, `https://gateway-api-testnet.circle.com/v1/x402/transfers/${transferId}`);
      return new Response(JSON.stringify({
        id: transferId,
        status: "confirmed",
        token: "USDC",
        sendingNetwork: "eip155:5042002",
        recipientNetwork: "eip155:5042002",
        fromAddress: "0x1111111111111111111111111111111111111111",
        toAddress: "0x2222222222222222222222222222222222222222",
        amount: "10000",
        createdAt: "2026-08-22T10:00:00.000Z",
        updatedAt: "2026-08-22T10:00:01.000Z",
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const result = await adapter.lookup({
    network: "eip155:5042002",
    providerTransferId: transferId,
    expected: {
      payer: "0x1111111111111111111111111111111111111111",
      recipient: "0x2222222222222222222222222222222222222222",
      amountAtomicUnits: "10000",
    },
  });
  assert.equal(called, 1);
  assert.equal(result.providerTransferId, transferId);
  assert.equal(result.transaction, null);
  assert.equal(result.status, "confirmed");
});

test("fails closed on Circle network mismatch and opens its circuit after repeated failures", async () => {
  const transferId = "3c90c3cc-0d44-4b50-8888-8dd25736052a";
  let called = 0;
  const adapter = createCircleTestnetX402ReceiptLookupAdapter({
    enabled: true,
    failureThreshold: 2,
    cooldownMs: 60_000,
    fetchImpl: async () => {
      called += 1;
      return new Response(JSON.stringify({
        id: transferId,
        status: "completed",
        token: "USDC",
        sendingNetwork: "eip155:1",
        recipientNetwork: "eip155:1",
        fromAddress: "0x1111111111111111111111111111111111111111",
        toAddress: "0x2222222222222222222222222222222222222222",
        amount: "10000",
        createdAt: "2026-08-22T10:00:00.000Z",
        updatedAt: "2026-08-22T10:00:01.000Z",
      }), { status: 200 });
    },
  });
  const input = { network: "eip155:5042002" as const, providerTransferId: transferId };
  await assert.rejects(adapter.lookup(input), /Arc Testnet/);
  await assert.rejects(adapter.lookup(input), /Arc Testnet/);
  await assert.rejects(adapter.lookup(input), /circuit is open/);
  assert.equal(called, 2);
});

test("rejects a transfer whose recipient network is not Arc Testnet", async () => {
  const transferId = "3c90c3cc-0d44-4b50-8888-8dd25736052a";
  const adapter = createCircleTestnetX402ReceiptLookupAdapter({
    enabled: true,
    fetchImpl: async () => new Response(JSON.stringify({
      id: transferId,
      status: "confirmed",
      token: "USDC",
      sendingNetwork: "eip155:5042002",
      recipientNetwork: "eip155:1",
      fromAddress: "0x1111111111111111111111111111111111111111",
      toAddress: "0x2222222222222222222222222222222222222222",
      amount: "10000",
      createdAt: "2026-08-22T10:00:00.000Z",
      updatedAt: "2026-08-22T10:00:01.000Z",
    }), { status: 200 }),
  });
  await assert.rejects(
    adapter.lookup({ network: "eip155:5042002", providerTransferId: transferId }),
    /both be Arc Testnet/,
  );
});

test("rejects an oversized Circle response before parsing it", async () => {
  const transferId = "3c90c3cc-0d44-4b50-8888-8dd25736052a";
  let bodyRead = false;
  const adapter = createCircleTestnetX402ReceiptLookupAdapter({
    enabled: true,
    fetchImpl: async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          bodyRead = true;
          controller.enqueue(new Uint8Array(65 * 1024));
          controller.close();
        },
      });
      return new Response(body, { status: 200 });
    },
  });
  await assert.rejects(
    adapter.lookup({ network: "eip155:5042002", providerTransferId: transferId }),
    /exceeds 64 KiB/,
  );
  assert.equal(bodyRead, true);
});
