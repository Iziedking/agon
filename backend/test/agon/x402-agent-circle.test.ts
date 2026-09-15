import assert from "node:assert/strict";
import test from "node:test";

import { createCircleX402AgentWalletAdapter } from "../../src/agon/execution/x402-agent-circle.ts";

const recipient = "0x1111111111111111111111111111111111111111" as const;

test("disabled Circle agent adapter never calls the provider", async () => {
  let calls = 0;
  const adapter = createCircleX402AgentWalletAdapter({
    enabled: false,
    transfer: async () => {
      calls += 1;
      return { id: "00000000-0000-4000-8000-000000000000", state: "INITIATED" };
    },
  });
  const result = await adapter.settle({ agentId: "agent-1", walletId: "wallet-1", recipient, amountBaseUnits: 1000n, idempotencyKey: "spend-1234" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "wallet_disabled");
  assert.equal(calls, 0);
});

test("enabled adapter submits exact amount and stable Circle idempotency key", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const adapter = createCircleX402AgentWalletAdapter({
    enabled: true,
    transfer: async (request) => {
      requests.push(request as unknown as Record<string, unknown>);
      return { id: "11111111-1111-4111-8111-111111111111", state: "INITIATED" };
    },
  });
  const input = { agentId: "agent-1", walletId: "wallet-1", recipient, amountBaseUnits: 1_234_567n, idempotencyKey: "spend-1234" };
  const first = await adapter.settle(input);
  const second = await adapter.settle(input);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(requests.length, 2);
  assert.equal(requests[0]!.amountBaseUnits, 1_234_567n);
  assert.match(String(requests[0]!.idempotencyKey), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(requests[0]!.idempotencyKey, requests[1]!.idempotencyKey);
  assert.equal(requests[0]!.refId, "agon-agent:agent-1:spend-1234");
});

test("adapter maps provider failure and invalid provider ids to wallet_unavailable", async () => {
  const failed = createCircleX402AgentWalletAdapter({ enabled: true, transfer: async () => { throw new Error("timeout"); } });
  const failedResult = await failed.settle({ agentId: "agent-1", walletId: "wallet-1", recipient, amountBaseUnits: 1000n, idempotencyKey: "spend-1234" });
  assert.equal(failedResult.ok, false);
  assert.equal(failedResult.error.code, "wallet_unavailable");

  const malformed = createCircleX402AgentWalletAdapter({ enabled: true, transfer: async () => ({ id: "not-a-uuid", state: "INITIATED" }) });
  const malformedResult = await malformed.settle({ agentId: "agent-1", walletId: "wallet-1", recipient, amountBaseUnits: 1000n, idempotencyKey: "spend-1234" });
  assert.equal(malformedResult.ok, false);
  assert.equal(malformedResult.error.code, "wallet_unavailable");
});
