import assert from "node:assert/strict";
import test from "node:test";

import { createHttpAgonEndpointQaRunner } from "../../src/agon/endpoint-qa.ts";

const provider = {
  agentId: "886270",
  serviceKey: `0x${"11".repeat(32)}`,
  listingReference: `5042002:0x${"22".repeat(20)}:2`,
  listingVersion: "3",
};

test("endpoint QA accepts a payment challenge without submitting payment", async () => {
  let request: Request | null = null;
  const runner = createHttpAgonEndpointQaRunner(
    { [`${provider.listingReference}@${provider.listingVersion}`]: "https://provider.example/x402/analyze" },
    {
      fetch: async (input, init) => {
        request = new Request(input, init);
        return new Response("payment required", { status: 402, headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify({ accepts: [{ scheme: "exact" }] })).toString("base64url") } });
      },
    },
  );
  const result = await runner.run({ provider });
  assert.equal(result.passed, true);
  assert.equal(result.evidence.checks.x402_payment.passed, true);
  assert.equal(request?.method, "POST");
  assert.equal(request?.headers.get("payment-signature"), null);
});

test("endpoint QA records a failed preflight when the provider does not challenge", async () => {
  const runner = createHttpAgonEndpointQaRunner(
    { [`${provider.listingReference}@${provider.listingVersion}`]: "https://provider.example/x402/analyze" },
    { fetch: async () => new Response("ok", { status: 200 }) },
  );
  const result = await runner.run({ provider });
  assert.equal(result.passed, false);
  assert.equal(result.evidence.endpointStatus, 200);
  assert.equal(result.evidence.checks.x402_payment.header, null);
});

test("endpoint QA rejects private or non-HTTPS endpoint maps", () => {
  assert.throws(
    () => createHttpAgonEndpointQaRunner({ [`${provider.listingReference}@${provider.listingVersion}`]: "http://127.0.0.1/x402" }),
    /public HTTPS/,
  );
});
