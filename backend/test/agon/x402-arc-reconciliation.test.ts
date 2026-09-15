import assert from "node:assert/strict";
import test from "node:test";

import { createAgonTestnetReceiptLookupAdapter, createArcTestnetReceiptLookupAdapter } from "../../src/agon/execution/x402-reconciliation.ts";

const tx = (`0x${"ab".repeat(32)}`) as `0x${string}`;
const payer = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";
const topicAddress = (address: string) => `0x${address.slice(2).padStart(64, "0")}`;

function rpcFetch(overrides: Record<string, unknown> = {}): typeof fetch {
  return (async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { method: string };
    const result = body.method === "eth_chainId" ? "0x4cef52" : body.method === "eth_getTransactionReceipt" ? {
      status: "0x1", blockNumber: "0x10", transactionHash: tx,
      logs: [{ address: "0x3600000000000000000000000000000000000000", topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a9df523b3ef", topicAddress(payer), topicAddress(recipient)], data: "0x3e8" }],
    } : body.method === "eth_getTransactionByHash" ? { hash: tx, from: payer } : body.method === "eth_blockNumber" ? "0x11" : null;
    const chosen = Object.prototype.hasOwnProperty.call(overrides, body.method) ? overrides[body.method] : result;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: chosen }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

test("Arc receipt adapter confirms only final matching USDC evidence", async () => {
  const adapter = createArcTestnetReceiptLookupAdapter({ enabled: true, fetchImpl: rpcFetch() });
  const result = await adapter.lookup({ network: "eip155:5042002", transaction: tx, expected: { payer, recipient, amountAtomicUnits: "1000" } });
  assert.equal(result.status, "confirmed");
  assert.equal(result.recipient?.toLowerCase(), recipient);
  assert.equal(result.amountAtomicUnits, "1000");
});

test("unknown Arc receipt evidence remains pending and mismatches fail", async () => {
  const pending = createArcTestnetReceiptLookupAdapter({ enabled: true, fetchImpl: rpcFetch({ eth_getTransactionReceipt: null }) });
  assert.equal((await pending.lookup({ network: "eip155:5042002", transaction: tx })).status, "pending");
  const mismatch = createArcTestnetReceiptLookupAdapter({ enabled: true, fetchImpl: rpcFetch() });
  const result = await mismatch.lookup({ network: "eip155:5042002", transaction: tx, expected: { recipient: "0x3333333333333333333333333333333333333333", amountAtomicUnits: "1000" } });
  assert.equal(result.status, "failed");
});

test("configured reconciliation selects Arc RPC for transaction references", async () => {
  const adapter = createAgonTestnetReceiptLookupAdapter({ enabled: true, fetchImpl: rpcFetch() });
  const result = await adapter.lookup({ network: "eip155:5042002", transaction: tx, expected: { recipient, amountAtomicUnits: "1000" } });
  assert.equal(result.status, "confirmed");
});
