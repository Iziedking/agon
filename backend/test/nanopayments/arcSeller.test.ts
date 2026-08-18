import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { createArcX402SellerHandler } from "../../src/nanopayments/arcSeller.ts";

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

test("serves public health and keeps market intel behind the x402 middleware", async () => {
  let paymentChecks = 0;
  const handler = createArcX402SellerHandler({
    price: "$0.001",
    sellerAddress: "0x0000000000000000000000000000000000000042",
    requirePayment(req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) {
      paymentChecks += 1;
      if (req.headers["x-test-paid"] !== "1") {
        res.writeHead(402, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "payment required" }));
        return;
      }
      Object.assign(req, {
        payment: {
          verified: true,
          payer: "0x0000000000000000000000000000000000000007",
          amount: "0.001",
          network: "eip155:5042002",
        },
      });
      next();
    },
    loadMarketIntel: async (topic) => ({ topic, source: "test", markets: [] }),
  });
  const server = createServer(handler);
  const port = await listen(server);

  try {
    const health = await fetch(`http://127.0.0.1:${port}/x402/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      ok: true,
      chain: "eip155:5042002",
      price: "$0.001",
      seller: "0x0000000000000000000000000000000000000042",
    });
    assert.equal(paymentChecks, 0);

    const unpaid = await fetch(`http://127.0.0.1:${port}/x402/market-intel`);
    assert.equal(unpaid.status, 402);
    assert.equal(paymentChecks, 1);

    const paid = await fetch(`http://127.0.0.1:${port}/x402/market-intel?topic=crypto`, {
      headers: { "x-test-paid": "1" },
    });
    assert.equal(paid.status, 200);
    const paidBody = await paid.json() as {
      topic: string;
      source: string;
      payment: { verified: boolean; amount: string };
    };
    assert.equal(paidBody.topic, "crypto");
    assert.equal(paidBody.source, "test");
    assert.equal(paidBody.payment.verified, true);
    assert.equal(paidBody.payment.amount, "0.001");
    assert.equal(paymentChecks, 2);

    const missing = await fetch(`http://127.0.0.1:${port}/not-found`);
    assert.equal(missing.status, 404);
    assert.equal(paymentChecks, 2);
  } finally {
    await close(server);
  }
});

