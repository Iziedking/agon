import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";

import { createAgonAuthMiddleware } from "../../src/agon/http/admin-auth.ts";

const ADMIN_TOKEN = "test-admin-token-with-enough-entropy";
const ACTOR = "0x1111111111111111111111111111111111111111";

function app() {
  const instance = new Hono<{ Variables: { address: string } }>();
  const fallback = (() => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } })) as Parameters<typeof createAgonAuthMiddleware>[1];
  instance.get("/protected", createAgonAuthMiddleware(ADMIN_TOKEN, fallback), (context) => context.json({ actor: context.get("address") }));
  return instance;
}

test("admin token binds an explicit actor without a user session", async () => {
  const response = await app().request("/protected", { headers: { "x-admin-token": ADMIN_TOKEN, "x-agon-actor": ACTOR.toUpperCase().replace("0X", "0x") } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { actor: ACTOR });
});

test("admin token refuses a missing or malformed actor", async () => {
  const missing = await app().request("/protected", { headers: { "x-admin-token": ADMIN_TOKEN } });
  assert.equal(missing.status, 400);
  const malformed = await app().request("/protected", { headers: { "x-admin-token": ADMIN_TOKEN, "x-agon-actor": "not-an-address" } });
  assert.equal(malformed.status, 400);
});

test("wrong admin token cannot bypass normal authentication", async () => {
  const response = await app().request("/protected", { headers: { "x-admin-token": `${ADMIN_TOKEN}-wrong`, "x-agon-actor": ACTOR } });
  assert.equal(response.status, 401);
});
