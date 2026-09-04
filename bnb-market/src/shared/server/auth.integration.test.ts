import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";
import { challenge, verify, currentSession, endSession, digest } from "./auth.ts";
import { database, closeDatabase } from "./store.ts";

// Isolated local test key: generated each run, never funded or broadcast.
const account = privateKeyToAccount(`0x${randomBytes(32).toString("hex")}`);
const origin = "https://agon.example";
if (process.argv.includes("--local-db")) process.env.BNB_DATABASE_URL = "postgres://nock:nock@127.0.0.1:15432/nock";
if (process.env.BNB_DATABASE_URL && !["localhost", "127.0.0.1"].includes(new URL(process.env.BNB_DATABASE_URL).hostname)) throw new Error("Integration tests require a local disposable database.");
const check = (address: `0x${string}`, message: string, signature: `0x${string}`) => verifyMessage({ address, message, signature });
const cookieRequest = (chain: number, token: string) => new Request(`${origin}/api/bnb/${chain}/auth/me`, { headers: { cookie: `agon_bnb_${chain}=${token}` } });
after(async () => {
  if (process.env.BNB_DATABASE_URL) { const db = await database(); await db.query("DELETE FROM bnb_auth_challenges WHERE address=$1", [account.address.toLowerCase()]); await db.query("DELETE FROM bnb_auth_sessions WHERE address=$1", [account.address.toLowerCase()]); }
  await closeDatabase();
});
test("real Postgres + real EOA signatures: scope, replay, race, logout and expiry", { skip: !process.env.BNB_DATABASE_URL }, async () => {
  const c = await challenge(97, account.address, origin);
  assert.match(c.message, /Chain ID: 97/); const signature = await account.signMessage({ message: c.message });
  await assert.rejects(verify(56, origin, c.nonce, signature, check), /expired|used/);
  await assert.rejects(verify(97, "https://evil.example", c.nonce, signature, check), /expired|used/);
  const outcomes = await Promise.allSettled([verify(97, origin, c.nonce, signature, check), verify(97, origin, c.nonce, signature, check)]);
  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
  const success = outcomes.find((o) => o.status === "fulfilled"); assert.ok(success && success.status === "fulfilled");
  const { token } = success.value;
  assert.equal((await currentSession(cookieRequest(97, token), 97))?.address, account.address.toLowerCase());
  assert.equal(await currentSession(cookieRequest(56, token), 56), null);
  const db = await database(); const raw = await db.query("SELECT token_hash FROM bnb_auth_sessions WHERE address=$1", [account.address.toLowerCase()]);
  assert.equal(raw.rows[0].token_hash, digest(token)); assert.notEqual(raw.rows[0].token_hash, token);
  await endSession(cookieRequest(97, token), 97); assert.equal(await currentSession(cookieRequest(97, token), 97), null);
  const expired = await challenge(97, account.address, origin);
  await db.query("UPDATE bnb_auth_challenges SET expires_at=now()-interval '1 second' WHERE nonce_hash=$1", [digest(expired.nonce)]);
  await assert.rejects(verify(97, origin, expired.nonce, await account.signMessage({ message: expired.message }), check), /expired/);
  const bad = await challenge(97, account.address, origin);
  await assert.rejects(verify(97, origin, bad.nonce, await account.signMessage({ message: "wrong message" }), check), /signature/);
  await assert.rejects(verify(97, origin, bad.nonce, await account.signMessage({ message: bad.message }), check), /expired|used/);
});
test("nonce rate limit stays bounded under concurrent requests", { skip: !process.env.BNB_DATABASE_URL }, async () => {
  const result = await Promise.allSettled(Array.from({ length: 12 }, () => challenge(97, account.address, origin)));
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 5);
  assert.equal(result.filter((r) => r.status === "rejected").length, 7);
});
