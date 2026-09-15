import assert from "node:assert/strict";
import test from "node:test";

import { createProviderHandler, ProviderHandlerError } from "../../src/agon/provider-handler.ts";

const payment = { payer: "0x1111111111111111111111111111111111111111" as const, network: "eip155:5042002" as const, transaction: "0x" + "ab".repeat(32) };

test("provider handler parses JSON, bounds output, and records delivery evidence separately", async () => {
  const handler = createProviderHandler({ handler: async (input) => ({ echo: input }) });
  const first = await handler.execute({ requestId: "req-1", body: JSON.stringify({ ok: true }), idempotencyKey: "request-1234", payment });
  assert.equal(first.replay, false);
  assert.equal(first.result.echo.ok, true);
  assert.equal(first.evidence.serviceStatus, 200);
  assert.match(first.evidence.responseHash, /^0x[0-9a-f]{64}$/);
  const replay = await handler.execute({ requestId: "req-2", body: JSON.stringify({ ok: true }), idempotencyKey: "request-1234", payment });
  assert.equal(replay.replay, true);
  assert.equal(replay.evidence.responseHash, first.evidence.responseHash);
});

test("provider handler rejects malformed JSON, conflicts, oversized input, oversized output, and timeout", async () => {
  const handler = createProviderHandler({ handler: async () => ({ value: "x".repeat(20) }), limits: { maxRequestBytes: 8, maxResponseBytes: 8, timeoutMs: 250 } });
  await assert.rejects(() => handler.execute({ requestId: "req-1", body: "{bad", idempotencyKey: "request-1234", payment }), (error: unknown) => error instanceof ProviderHandlerError && error.code === "invalid_json");
  await assert.rejects(() => handler.execute({ requestId: "req-1", body: "123456789", idempotencyKey: "request-5678", payment }), (error: unknown) => error instanceof ProviderHandlerError && error.code === "request_too_large");
  const normal = createProviderHandler({ handler: async () => ({ value: "x".repeat(20) }), limits: { maxResponseBytes: 8 } });
  await assert.rejects(() => normal.execute({ requestId: "req-1", body: "{}", idempotencyKey: "request-1234", payment }), (error: unknown) => error instanceof ProviderHandlerError && error.code === "response_too_large");
  const conflict = createProviderHandler({ handler: async (value) => value });
  await conflict.execute({ requestId: "req-1", body: "{\"a\":1}", idempotencyKey: "request-1234", payment });
  await assert.rejects(() => conflict.execute({ requestId: "req-2", body: "{\"a\":2}", idempotencyKey: "request-1234", payment }), (error: unknown) => error instanceof ProviderHandlerError && error.code === "idempotency_conflict");
  const slow = createProviderHandler({ handler: async () => new Promise((resolve) => setTimeout(resolve, 300)), limits: { timeoutMs: 250 } });
  await assert.rejects(() => slow.execute({ requestId: "req-1", body: "{}", idempotencyKey: "request-1234", payment }), (error: unknown) => error instanceof ProviderHandlerError && error.code === "handler_timeout");
});
