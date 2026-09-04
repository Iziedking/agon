import { test } from "node:test";
import assert from "node:assert/strict";
import { createBnbServer } from "./serve.ts";
import { proxyBnb } from "./proxy.ts";

test("HTTP bridge preserves cookies/origin and refuses Arc, large bodies and other methods", async () => {
  const server = createBnbServer(async (request, chain, path) => Response.json({ chain, path, origin: request.headers.get("origin"), cookie: request.headers.get("cookie"), input: await request.json() }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const result = await fetch(`${base}/api/bnb/97/auth/nonce`, { method: "POST", headers: { origin: "https://agon.surf", cookie: "agon_bnb_97=test" }, body: "{}" });
    assert.deepEqual(await result.json(), { chain: "97", path: ["auth", "nonce"], origin: "https://agon.surf", cookie: "agon_bnb_97=test", input: {} });
    assert.equal((await fetch(`${base}/api/bnb/5042002/auth/me`)).status, 404);
    assert.equal((await fetch(`${base}/api/bnb/56/auth/me`, { method: "DELETE" })).status, 405);
    assert.equal((await fetch(`${base}/api/bnb/97/auth/nonce`, { method: "POST", body: "x".repeat(17000) })).status, 413);
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
test("proxy forwards only active BNB cookie and never falls back on outage", async () => {
  const request = new Request("https://agon.surf/api/bnb/97/auth/me", { headers: { cookie: "arc_secret=private; agon_bnb_56=other; agon_bnb_97=current", authorization: "private" } });
  const send: typeof fetch = async (url, init) => {
    assert.equal(String(url), "https://api.agon.surf/api/bnb/97/auth/me");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("cookie"), "agon_bnb_97=current"); assert.equal(headers.get("authorization"), null);
    return Response.json({ ok: true }, { headers: { "set-cookie": "agon_bnb_97=new; HttpOnly; Secure; Path=/" } });
  };
  assert.match((await proxyBnb(request, "97", ["auth", "me"], "https://api.agon.surf", send)).headers.get("set-cookie")!, /agon_bnb_97=new/);
  assert.equal((await proxyBnb(request, "97", [".."], "https://api.agon.surf", send)).status, 400);
  assert.equal((await proxyBnb(request, "5042002", ["health"], "https://api.agon.surf", send)).status, 503);
  assert.equal((await proxyBnb(request, "97", ["health"], "https://api.agon.surf", async () => { throw new Error("credential must not leak"); })).status, 503);
});
