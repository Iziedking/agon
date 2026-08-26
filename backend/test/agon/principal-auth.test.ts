import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";

import { createAgonPrincipalMiddleware } from "../../src/agon/http/principal-auth.ts";

const operator = "0xa045e8104bc066fff5bfc673abf354871edc03c5";
const linkedCircle = "0x3bafa3a0987699391a2003c3aa06d41b0209c397";

function app() {
  const instance = new Hono<{ Variables: { address: string } }>();
  const session = async (context: Parameters<ReturnType<typeof createAgonPrincipalMiddleware>>[0], next: () => Promise<void>) => {
    context.set("address", operator);
    await next();
  };
  const principal = createAgonPrincipalMiddleware(async (sessionAddress, requestedAddress) =>
    sessionAddress === operator && requestedAddress === linkedCircle,
  );
  instance.get("/protected", session, principal, (context) => context.json({ actor: context.get("address") }));
  return instance;
}

test("uses a linked wallet principal as the authenticated Agon actor", async () => {
  const response = await app().request("/protected", { headers: { "x-agon-principal": linkedCircle } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { actor: linkedCircle });
});

test("refuses an unlinked wallet principal", async () => {
  const response = await app().request("/protected", {
    headers: { "x-agon-principal": "0x1111111111111111111111111111111111111111" },
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "wallet principal is not linked to this operator" });
});

test("uses the primary session actor when no principal is selected", async () => {
  const response = await app().request("/protected");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { actor: operator });
});
