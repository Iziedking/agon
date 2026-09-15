import assert from "node:assert/strict";
import test from "node:test";

import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";

const network = "eip155:5042002";
const seller = "0x2222222222222222222222222222222222222222";
const payer = "0x1111111111111111111111111111111111111111";
const transaction = "11111111-1111-4111-8111-111111111111";

type TestResponse = { statusCode: number; headers: Record<string, string>; body: string; setHeader(name: string, value: string): void; end(value?: string): void };

function response(): TestResponse {
  return { statusCode: 200, headers: {}, body: "", setHeader(name, value) { this.headers[name.toLowerCase()] = String(value); }, end(value = "") { this.body += value; } };
}

test("Circle Gateway middleware performs request-specific verify/settle and PAYMENT-RESPONSE", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/supported")) return new Response(JSON.stringify({ kinds: [{ x402Version: 2, scheme: "exact", network, extra: { verifyingContract: "0x3333333333333333333333333333333333333333", assets: [{ symbol: "USDC", address: "0x3600000000000000000000000000000000000000" }] } }], extensions: [], signers: {} }), { status: 200 });
    const body = JSON.parse(String(init?.body)) as { paymentPayload?: unknown };
    if (path.endsWith("/verify")) return new Response(JSON.stringify({ isValid: true, payer }), { status: 200 });
    if (path.endsWith("/settle")) return new Response(JSON.stringify({ success: true, transaction, network, payer }), { status: 200 });
    throw new Error(`unexpected facilitator request: ${path} ${JSON.stringify(body)}`);
  }) as typeof fetch;
  try {
    const gateway = createGatewayMiddleware({ sellerAddress: seller, networks: [network], facilitatorUrl: "https://gateway-api-testnet.circle.com" });
    const req = { url: "https://provider.test/execute", headers: {} as Record<string, string>, payment: undefined as unknown } as any;
    const unpaid = response();
    await gateway.require("$0.001")(req, unpaid as any, () => undefined);
    assert.equal(unpaid.statusCode, 402);
    assert.ok(unpaid.headers["payment-required"]);
    const paid = response();
    req.headers["payment-signature"] = Buffer.from(JSON.stringify({ x402Version: 2, accepted: { network }, payload: { authorization: {}, signature: "0x" } })).toString("base64");
    let nextCalled = false;
    await gateway.require("$0.001")(req, paid as any, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(req.payment.verified, true);
    assert.equal(req.payment.network, network);
    assert.equal(paid.headers["payment-response"], Buffer.from(JSON.stringify({ success: true, transaction, network, payer })).toString("base64"));
  } finally { globalThis.fetch = originalFetch; }
});
