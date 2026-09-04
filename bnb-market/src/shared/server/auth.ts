import { createHash, randomBytes } from "node:crypto";
import { getAddress, isAddress } from "viem";
import { createSiweMessage } from "viem/siwe";
import type { BnbChain, BnbSession } from "../types.ts";
import { checkedClient } from "./network.ts";
import { database } from "./store.ts";
import { HttpError } from "./http.ts";

// viem 2.50.4 createSiweMessage and publicClient.verifyMessage; EIP-4361.
// This is AGON account authentication, not a BNB marketplace prerequisite.
// Browsing does not invoke it. No key custody or spending authority is granted.
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export function requestOrigin(request: Request): string {
  const actual = new URL(request.url).origin;
  const configured = process.env.BNB_APP_ORIGIN;
  const expected = configured ? new URL(configured).origin : actual;
  if (request.headers.get("origin") !== expected) throw new HttpError(403, "Open sign-in from this AGON site and try again.");
  return expected;
}
export function sessionCookie(chainId: BnbChain) { return `agon_bnb_${chainId}`; }
export function cookieValue(request: Request, key: string) {
  return request.headers.get("cookie")?.split(";").map((v) => v.trim()).find((v) => v.startsWith(`${key}=`))?.slice(key.length + 1) ?? "";
}
export function setSessionCookie(chainId: BnbChain, token: string, secure: boolean, maxAge = 28800) {
  return `${sessionCookie(chainId)}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}
export async function challenge(chainId: BnbChain, address: unknown, origin: string) {
  if (typeof address !== "string" || !isAddress(address)) throw new HttpError(400, "Connect a valid BNB wallet.");
  const db = await database();
  const nonce = randomBytes(24).toString("hex"); const expiresAt = new Date(Date.now() + 300000);
  const message = createSiweMessage({ address: getAddress(address), chainId, domain: new URL(origin).host,
    uri: origin, version: "1", nonce, issuedAt: new Date(), expirationTime: expiresAt,
    statement: `Sign in to AGON on BNB ${chainId === 97 ? "Testnet" : "Mainnet"}. This does not authorize payments or agent actions.` });
  const connection = await db.connect();
  try {
    await connection.query("BEGIN");
    await connection.query("SELECT pg_advisory_xact_lock(818300,$1)", [chainId]);
    await connection.query("DELETE FROM bnb_auth_challenges WHERE expires_at<now()");
    const pending = await connection.query<{ total: string; own: string }>("SELECT count(*) AS total, count(*) FILTER(WHERE address=$1) AS own FROM bnb_auth_challenges WHERE chain_id=$2", [address.toLowerCase(), chainId]);
    if (Number(pending.rows[0].own) >= 5 || Number(pending.rows[0].total) >= 500) throw new HttpError(429, "Too many sign-in requests. Wait five minutes and try again.");
    await connection.query("INSERT INTO bnb_auth_challenges(nonce_hash,chain_id,address,origin,message,expires_at) VALUES($1,$2,$3,$4,$5,$6)", [digest(nonce), chainId, address.toLowerCase(), origin, message, expiresAt]);
    await connection.query("COMMIT");
  } catch (error) { await connection.query("ROLLBACK"); throw error; }
  finally { connection.release(); }
  return { nonce, message, chainId, expiresAt: expiresAt.toISOString() };
}
export type VerifySignature = (address: `0x${string}`, message: string, signature: `0x${string}`) => Promise<boolean>;
export async function verify(chainId: BnbChain, origin: string, nonce: unknown, signature: unknown, verifySignature?: VerifySignature) {
  if (typeof nonce !== "string" || !/^[a-f0-9]{48}$/.test(nonce) || typeof signature !== "string" || !/^0x[0-9a-fA-F]{130,8192}$/.test(signature)) throw new HttpError(400, "Invalid sign-in response.");
  const db = await database();
  // DELETE RETURNING consumes a nonce atomically even when two verifications race.
  const consumed = await db.query<{ address: `0x${string}`; message: string }>(
    "DELETE FROM bnb_auth_challenges WHERE nonce_hash=$1 AND chain_id=$2 AND origin=$3 AND expires_at>now() RETURNING address,message", [digest(nonce), chainId, origin]);
  const row = consumed.rows[0]; if (!row) throw new HttpError(401, "This sign-in request expired or was already used. Start again.");
  const verifier = verifySignature ?? (async (address, message, sig) => (await checkedClient(chainId)).verifyMessage({ address, message, signature: sig }));
  if (!await verifier(row.address, row.message, signature as `0x${string}`)) throw new HttpError(401, "The signature does not match this wallet.");
  const token = randomBytes(32).toString("hex"); const expiresAt = new Date(Date.now() + 28800000);
  await db.query("DELETE FROM bnb_auth_sessions WHERE expires_at<now()");
  await db.query("INSERT INTO bnb_auth_sessions(token_hash,chain_id,address,expires_at) VALUES($1,$2,$3,$4)", [digest(token), chainId, row.address, expiresAt]);
  return { token, session: { address: row.address, chainId, expiresAt: expiresAt.toISOString() } satisfies BnbSession };
}
export async function currentSession(request: Request, chainId: BnbChain): Promise<BnbSession | null> {
  const token = cookieValue(request, sessionCookie(chainId)); if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const db = await database();
  const result = await db.query<{ address: string; expires_at: Date }>("SELECT address,expires_at FROM bnb_auth_sessions WHERE token_hash=$1 AND chain_id=$2 AND expires_at>now()", [digest(token), chainId]);
  const row = result.rows[0]; return row ? { address: row.address, chainId, expiresAt: row.expires_at.toISOString() } : null;
}
export async function endSession(request: Request, chainId: BnbChain) {
  const token = cookieValue(request, sessionCookie(chainId));
  if (token) await (await database()).query("DELETE FROM bnb_auth_sessions WHERE token_hash=$1 AND chain_id=$2", [digest(token), chainId]);
}
