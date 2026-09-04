import { test } from "node:test";
import assert from "node:assert/strict";
import { parseChain, parseAgentId } from "../types.ts";
import { parseIndexedAgent, registration } from "./catalog.ts";
import { publicAddress, httpsUrl, publicJson, body } from "./http.ts";
import { requestOrigin, sessionCookie, setSessionCookie } from "./auth.ts";
import { BNB_REGISTRIES } from "./network.ts";
import { handleBnb } from "./api.ts";

test("only explicit BNB chain IDs are accepted", () => {
  assert.equal(parseChain("97"), 97); assert.equal(parseChain(56), 56);
  for (const bad of [null, undefined, "", 5042002, "arc-testnet", 1, "0x61"]) assert.throws(() => parseChain(bad));
});
test("agent IDs stay precise across the full uint256 range", () => {
  const max = (2n ** 256n - 1n).toString(); assert.equal(parseAgentId(max), max);
  for (const bad of ["01", "-1", "1.5", "1e2", "../auth", (2n ** 256n).toString()]) assert.throws(() => parseAgentId(bad));
});
const row = { token_id: "2114", chain_id: 97, contract_address: BNB_REGISTRIES[97], owner_address: "0x1111111111111111111111111111111111111111", name: "Provider", description: "Provider service" };
test("index rows cannot cross chains or invent verification/category", () => {
  const agent = parseIndexedAgent({ ...row, is_verified: true, total_score: 100 }, 97);
  assert.equal(agent.category, null); assert.equal(agent.source, "8004scan"); assert.equal("verified" in agent, false);
  assert.throws(() => parseIndexedAgent(row, 56));
  assert.throws(() => parseIndexedAgent({ ...row, contract_address: row.owner_address }, 97));
  assert.throws(() => parseIndexedAgent({ ...row, owner_address: "bad" }, 97));
});
test("provider reads reject private, metadata, mapped IPv6 and unsafe URLs", async () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "172.16.0.2", "192.168.1.2", "100.64.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "2002:7f00:1::"]) assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress("8.8.8.8"), true);
  for (const uri of ["http://example.com", "https://user:pass@example.com", "https://example.com:8443", "https://example.com/#x", "file:///etc/passwd"]) assert.throws(() => httpsUrl(uri));
  await assert.rejects(publicJson("https://127.0.0.1/private"), /Private/);
});
test("registration parser rejects malformed/oversized inline data", async () => {
  const uri = `data:application/json;base64,${Buffer.from(JSON.stringify({ name: "Example" })).toString("base64")}`;
  assert.equal((await registration(uri)).name, "Example");
  await assert.rejects(registration("data:application/json;base64," + "a".repeat(700000)));
  await assert.rejects(registration("data:application/json;base64,%%%%"));
});
test("origin and cookie boundaries are network scoped", () => {
  assert.equal(requestOrigin(new Request("https://agon.surf/api/bnb/97/auth/nonce", { headers: { origin: "https://agon.surf" } })), "https://agon.surf");
  assert.throws(() => requestOrigin(new Request("https://agon.surf/api/bnb/97/auth/nonce", { headers: { origin: "https://evil.example" } })));
  assert.notEqual(sessionCookie(56), sessionCookie(97));
  const cookie = setSessionCookie(97, "token", true); assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /; Secure/);
});
test("body cap and malformed JSON fail before database access", async () => {
  await assert.rejects(body(new Request("https://agon.surf", { method: "POST", body: "x".repeat(20000) })), /large/);
  await assert.rejects(body(new Request("https://agon.surf", { method: "POST", body: "[]" })), /JSON object/);
});
test("API rejects Arc and cross-origin writes; public browsing has no auth requirement", async () => {
  assert.equal((await handleBnb(new Request("https://agon.surf/api/bnb/5042002/health"), "5042002", ["health"])).status, 400);
  assert.equal((await handleBnb(new Request("https://agon.surf/api/bnb/97/auth/nonce", { method: "POST", headers: { origin: "https://evil.example" }, body: "{}" }), "97", ["auth", "nonce"])).status, 403);
  const me = await handleBnb(new Request("https://agon.surf/api/bnb/97/auth/me"), "97", ["auth", "me"]);
  assert.deepEqual(await me.json(), { session: null });
  assert.equal((await handleBnb(new Request("https://agon.surf/api/bnb/97/agents?offset=-1"), "97", ["agents"])).status, 400);
});
