import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { deleteCookie, setCookie } from "hono/cookie";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { generateSiweNonce, parseSiweMessage } from "viem/siwe";

import { config } from "../config/index.js";
import { publicClient } from "../chain/arc.js";
import { query } from "../db/pool.js";
import { logEvent } from "../events.js";
import { notify } from "../notifications/index.js";
import { setTierGate, getTierGate, type GateSurface } from "../lib/tierGate.js";
import { merkleProof, payoutLeaf } from "../coordinator/merkle.js";
import { redis } from "../redis.js";
import { issueToken, requireAuth, SESSION_COOKIE } from "./jwt.js";
import {
  DAILY_POOL_MAX,
  nextResetMs,
  rollMystery,
  RUG_CHANCE,
  sameUtcDay,
  TRAITS,
  traitById,
  type Trait,
} from "./traits.js";
import {
  STATS,
  MAX_STAT_LEVEL,
  cyclesCost,
  maxSpeedupSteps,
  secondsCost,
  speedupParams,
  flushTrainingQueue,
  type Stat,
} from "../coordinator/training.js";
import {
  circleDevConfigured,
  createUserWallet,
  seedTestnetUsdc,
  executeContractCall,
  getTxState,
} from "../chain/circleDev.js";
import {
  listCredentialsForEmail,
  beginRegistration,
  finishRegistration,
  beginAuthentication,
  finishAuthentication,
} from "./webauthn.js";
import {
  consumeEmailVerification,
  isEmailVerified,
  OtpError,
  startEmailOtp,
  verifyEmailOtp,
} from "../lib/emailOtp.js";
import {
  MAX_EQUIPPED,
  validateLoadout,
  setLoadout,
  getLoadout,
  ownedTraitPool,
  TRAIT_CATALOGUE,
  liveEntryCount,
  liveEntryCountForSurface,
  hasAgentInEvent,
} from "./loadouts.js";
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from "@simplewebauthn/server";

const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 days, matches issueToken expiry

/// Auth service: SIWE wallet login plus optional X (Twitter) OAuth2 linking.
/// The wallet is the identity, so X is not required to enter contests; it is a
/// social link, and Discord can be added the same way later.

const app = new Hono<{ Variables: { address: string } }>();

// Allow the frontend origin to call the auth API from the browser. Credentials
// are on so the httpOnly session cookie is sent on cross-origin fetches from
// the Next.js app to this service.
app.use(
  "*",
  cors({
    origin: config.auth.appUrl,
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);

const NONCE_TTL = 300; // seconds
const STATE_TTL = 600;
const b64url = (b: Buffer) => b.toString("base64url");

app.get("/health", (c) => c.json({ ok: true, service: "auth" }));

// ----- SIWE wallet login -----

app.post("/auth/wallet/nonce", async (c) => {
  const { address } = await c.req.json<{ address?: string }>();
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return c.json({ error: "valid address required" }, 400);
  }
  const nonce = generateSiweNonce();
  await redis.set(`siwe:nonce:${nonce}`, address.toLowerCase(), "EX", NONCE_TTL);
  return c.json({ nonce });
});

app.post("/auth/wallet/verify", async (c) => {
  const { message, signature } = await c.req.json<{ message?: string; signature?: `0x${string}` }>();
  if (!message || !signature) return c.json({ error: "message and signature required" }, 400);

  const fields = parseSiweMessage(message);
  if (!fields.address || !fields.nonce) return c.json({ error: "malformed SIWE message" }, 400);

  // One-time nonce: consume it and confirm it was issued for this address.
  const issuedFor = await redis.getdel(`siwe:nonce:${fields.nonce}`);
  if (!issuedFor || issuedFor !== fields.address.toLowerCase()) {
    return c.json({ error: "invalid or expired nonce" }, 401);
  }
  if (fields.domain !== config.auth.domain) return c.json({ error: "bad domain" }, 401);
  if (fields.chainId !== config.chainId) return c.json({ error: "wrong chain" }, 401);
  if (fields.expirationTime && new Date(fields.expirationTime) < new Date()) {
    return c.json({ error: "message expired" }, 401);
  }

  // verifyMessage handles EOAs and EIP-1271 smart accounts (Arc Modular Wallets)
  // through the Arc public client.
  const valid = await publicClient.verifyMessage({ address: fields.address, message, signature });
  if (!valid) return c.json({ error: "bad signature" }, 401);

  const address = fields.address.toLowerCase();
  await query("insert into operators (address) values ($1) on conflict (address) do nothing", [address]);
  const token = await issueToken(address);

  // Persist the session in an httpOnly cookie so XSS cannot lift it. The token
  // is also returned in the JSON body for back-compat with any non-browser
  // caller (scripts, server-to-server), but the frontend should ignore it.
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });

  void logEvent({ kind: "login", address, source: "auth" });
  return c.json({ token, address });
});

// Sign out: clears the server-side session cookie. The frontend has no token to
// clear because it never stored one. Returns 200 even when no session exists.
app.post("/auth/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

// ----- Email login with WebAuthn passkey (Circle Developer-Controlled wallets) -----

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readEmail(body: unknown): string | null {
  const b = body as { email?: unknown };
  const email = (typeof b?.email === "string" ? b.email : "").trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email) || email.length > 254) return null;
  return email;
}

function setSessionCookie(c: Parameters<typeof setCookie>[0], token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

/// Email OTP: step 1. Generate a 6-digit code, persist its hash with a
/// 10-minute TTL, and email it to the address. Required at first-time
/// signup so an attacker can't claim someone else's email and mint a
/// Circle wallet under it. Opt-in via EMAIL_OTP_ENABLED=true.
app.post("/auth/email/otp/start", async (c) => {
  if (!config.auth.emailOtp.enabled) {
    return c.json({ error: "email otp is disabled on this server" }, 503);
  }
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "bad json" }, 400); }
  const email = readEmail(body);
  if (!email) return c.json({ error: "valid email required" }, 400);
  try {
    await startEmailOtp(email);
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof OtpError) return c.json({ error: err.message, code: err.code }, err.status as 400);
    const message = err instanceof Error ? err.message : String(err);
    void logEvent({ level: "error", kind: "otp_start_error", message, context: { email }, source: "auth" });
    return c.json({ error: "could not send the code, try again" }, 500);
  }
});

/// Email OTP: step 2. Verify the 6-digit code. On success the email is
/// flagged as verified for VERIFY_TTL (15 min); the next
/// /auth/email/begin call within that window passes the first-time
/// signup gate. The verification is consumed once /auth/email/finish
/// completes so a token can't be replayed for two signups.
app.post("/auth/email/otp/verify", async (c) => {
  if (!config.auth.emailOtp.enabled) {
    return c.json({ error: "email otp is disabled on this server" }, 503);
  }
  let body: { email?: string; code?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: "bad json" }, 400); }
  const email = readEmail(body);
  if (!email) return c.json({ error: "valid email required" }, 400);
  if (typeof body.code !== "string") return c.json({ error: "code required" }, 400);
  try {
    await verifyEmailOtp(email, body.code);
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof OtpError) return c.json({ error: err.message, code: err.code }, err.status as 400);
    const message = err instanceof Error ? err.message : String(err);
    void logEvent({ level: "error", kind: "otp_verify_error", message, context: { email }, source: "auth" });
    return c.json({ error: "could not verify the code" }, 500);
  }
});

/// Email passkey flow, step 1. The client posts an email; we decide whether
/// this email needs a fresh passkey registration ("register") or can prove
/// itself with an existing passkey ("login"), and return the matching
/// WebAuthn challenge for the browser ceremony.
app.post("/auth/email/begin", async (c) => {
  if (!circleDevConfigured()) {
    return c.json(
      { error: "email login is not configured on this server; ask the operator to set CIRCLE_API_KEY / CIRCLE_ENTITY_SECRET / CIRCLE_WALLET_SET_ID" },
      503,
    );
  }

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "bad json" }, 400); }
  const email = readEmail(body);
  if (!email) return c.json({ error: "valid email required" }, 400);

  try {
    const credentials = await listCredentialsForEmail(email);
    if (credentials.length > 0) {
      const options = await beginAuthentication(email);
      return c.json({ mode: "login", options });
    }
    // First-time signup gate. EMAIL_OTP_ENABLED=true requires the
    // caller to have completed /auth/email/otp/verify within the past
    // 15 minutes before we hand out a registration challenge. Once a
    // passkey is enrolled this branch is unreachable on subsequent
    // logins (the credentials check above catches them).
    if (config.auth.emailOtp.enabled) {
      const verified = await isEmailVerified(email);
      if (!verified) {
        return c.json(
          {
            error: "verify your email first",
            code: "otp_required",
            otpRequired: true,
          },
          403,
        );
      }
    }
    const options = await beginRegistration(email);
    return c.json({ mode: "register", options });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void logEvent({
      level: "error",
      kind: "email_begin_error",
      message,
      context: { email },
      source: "auth",
    });
    return c.json({ error: `email begin failed: ${message}` }, 500);
  }
});

/// Email passkey flow, step 2. The client posts the email, the mode it ran
/// (matching what /begin returned), and the browser's attestation or
/// assertion. We verify, mint a Circle wallet if this is a fresh registration,
/// store the credential, and set the session cookie.
app.post("/auth/email/finish", async (c) => {
  if (!circleDevConfigured()) {
    return c.json({ error: "email login is not configured on this server" }, 503);
  }

  let body: { email?: string; mode?: string; response?: unknown };
  try { body = await c.req.json(); } catch { return c.json({ error: "bad json" }, 400); }
  const email = readEmail(body);
  if (!email) return c.json({ error: "valid email required" }, 400);
  if (body.mode !== "register" && body.mode !== "login") {
    return c.json({ error: "mode must be register or login" }, 400);
  }
  if (!body.response || typeof body.response !== "object") {
    return c.json({ error: "missing webauthn response" }, 400);
  }

  if (body.mode === "register") {
    // Either resume an existing operator row (e.g. they signed up under the
    // earlier passkey-less flow and are enrolling a passkey now) or mint a
    // fresh Circle wallet for a never-seen email.
    let address: string;
    let walletId: string | null;
    let seeded = false;
    let createdNow = false;

    const existing = await query<{ address: string; circle_wallet_id: string | null }>(
      "select address, circle_wallet_id from operators where email = $1",
      [email],
    );

    if (existing.rows[0]) {
      address = existing.rows[0].address;
      walletId = existing.rows[0].circle_wallet_id;
    } else {
      const created = await createUserWallet(email).catch((err) => {
        console.error("[auth/email/finish] createUserWallet failed:", err);
        return null;
      });
      if (!created) return c.json({ error: "could not create wallet, try again in a moment" }, 502);
      address = created.address;
      walletId = created.walletId;

      await query(
        `insert into operators (address, email, circle_wallet_id)
           values ($1, $2, $3)
           on conflict (address) do update set email = excluded.email, circle_wallet_id = excluded.circle_wallet_id`,
        [address, email, walletId],
      );
      createdNow = true;
      const seed = await seedTestnetUsdc(address as `0x${string}`).catch(() => ({ requested: false }));
      seeded = seed.requested;
    }

    try {
      await finishRegistration(email, address, body.response as RegistrationResponseJSON);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "registration verification failed" }, 401);
    }

    // Consume any verified OTP so the token can't be replayed against a
    // second signup attempt. Safe to call when OTP wasn't used (the row
    // doesn't exist and DELETE is a no-op).
    await consumeEmailVerification(email).catch(() => {});

    const token = await issueToken(address);
    setSessionCookie(c, token);
    void logEvent({
      kind: createdNow ? "email_signup" : "passkey_enroll",
      address,
      context: { email, walletId, seeded },
      source: "auth",
    });
    return c.json({ address, walletId, seeded, isNew: createdNow });
  }

  // login mode
  let resolved: { operatorAddress: string };
  try {
    const out = await finishAuthentication(email, body.response as AuthenticationResponseJSON);
    resolved = { operatorAddress: out.operatorAddress };
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "authentication verification failed" }, 401);
  }
  const token = await issueToken(resolved.operatorAddress);
  setSessionCookie(c, token);

  const { rows } = await query<{ circle_wallet_id: string | null }>(
    "select circle_wallet_id from operators where address = $1",
    [resolved.operatorAddress],
  );
  void logEvent({ kind: "email_login", address: resolved.operatorAddress, context: { email }, source: "auth" });
  return c.json({
    address: resolved.operatorAddress,
    walletId: rows[0]?.circle_wallet_id ?? null,
    seeded: false,
    isNew: false,
  });
});

/// Email login WITHOUT a passkey: complete sign-in from a verified OTP alone.
/// Signup is just email + code; passkeys become optional and are enrolled
/// later from settings (and offered automatically on return once enrolled).
/// Gated on a recent OTP verification so a session can't be claimed for an
/// email the caller doesn't control.
app.post("/auth/email/session", async (c) => {
  if (!circleDevConfigured()) {
    return c.json({ error: "email login is not configured on this server" }, 503);
  }
  if (!config.auth.emailOtp.enabled) {
    return c.json({ error: "code-based email login is not enabled" }, 400);
  }

  let body: { email?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: "bad json" }, 400); }
  const email = readEmail(body);
  if (!email) return c.json({ error: "valid email required" }, 400);

  if (!(await isEmailVerified(email))) {
    return c.json({ error: "verify your email code first", code: "otp_required" }, 401);
  }

  let address: string;
  let walletId: string | null;
  let seeded = false;
  let createdNow = false;

  const existing = await query<{ address: string; circle_wallet_id: string | null }>(
    "select address, circle_wallet_id from operators where email = $1",
    [email],
  );
  if (existing.rows[0]) {
    address = existing.rows[0].address;
    walletId = existing.rows[0].circle_wallet_id;
  } else {
    const created = await createUserWallet(email).catch((err) => {
      console.error("[auth/email/session] createUserWallet failed:", err);
      return null;
    });
    if (!created) return c.json({ error: "could not create wallet, try again in a moment" }, 502);
    address = created.address;
    walletId = created.walletId;
    await query(
      `insert into operators (address, email, circle_wallet_id)
         values ($1, $2, $3)
         on conflict (address) do update set email = excluded.email, circle_wallet_id = excluded.circle_wallet_id`,
      [address, email, walletId],
    );
    createdNow = true;
    const seed = await seedTestnetUsdc(address as `0x${string}`).catch(() => ({ requested: false }));
    seeded = seed.requested;
  }

  await consumeEmailVerification(email).catch(() => {});
  const token = await issueToken(address);
  setSessionCookie(c, token);
  void logEvent({
    kind: createdNow ? "email_signup" : "email_login",
    address,
    context: { email, walletId, seeded, method: "otp" },
    source: "auth",
  });
  return c.json({ address, walletId, seeded, isNew: createdNow });
});

// ----- Passkey enrollment from inside a live session -----
//
// Lets a signed-in user attach a passkey to their existing operator row so
// the next login requires the passkey ceremony. Different from /auth/email/
// begin+finish, which expects no session and creates one. This pair runs
// against the live session's address and uses the operator row's email as
// the WebAuthn user handle.

app.post("/auth/passkey/enroll/begin", requireAuth, async (c) => {
  const address = c.get("address");
  const { rows } = await query<{ email: string | null }>(
    "select email from operators where address = $1",
    [address],
  );
  const email = rows[0]?.email;
  if (!email) {
    return c.json(
      { error: "this session is not an email account; passkeys are only for email logins" },
      400,
    );
  }
  const options = await beginRegistration(email);
  return c.json({ options });
});

/// Lists the current session's registered passkeys with device hints so
/// the profile settings can show "you have 2 passkeys" with a per-row
/// summary (device type, when added). Read-only.
app.get("/auth/passkey/list", requireAuth, async (c) => {
  const address = c.get("address");
  const { rows } = await query<{
    credential_id: string;
    device_type: string | null;
    backed_up: boolean | null;
    transports: string[] | null;
    created_at: Date;
  }>(
    `select credential_id, device_type, backed_up, transports, created_at
       from webauthn_credentials
      where operator_address = $1
      order by created_at asc`,
    [address],
  );
  return c.json({
    passkeys: rows.map((r) => ({
      id: r.credential_id,
      deviceType: r.device_type,
      backedUp: r.backed_up ?? false,
      transports: r.transports ?? [],
      createdAt: r.created_at,
    })),
  });
});

app.post("/auth/passkey/enroll/finish", requireAuth, async (c) => {
  const address = c.get("address");
  const { rows } = await query<{ email: string | null }>(
    "select email from operators where address = $1",
    [address],
  );
  const email = rows[0]?.email;
  if (!email) return c.json({ error: "this session is not an email account" }, 400);

  let body: { response?: unknown };
  try { body = await c.req.json(); } catch { return c.json({ error: "bad json" }, 400); }
  if (!body.response || typeof body.response !== "object") {
    return c.json({ error: "missing webauthn response" }, 400);
  }

  try {
    await finishRegistration(email, address, body.response as RegistrationResponseJSON);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "passkey enrollment failed" }, 401);
  }

  void logEvent({ kind: "passkey_enroll", address, context: { email }, source: "auth" });
  return c.json({ ok: true });
});

// ----- Circle wallet execute (server-signed contract calls) -----

// The four ArcRun contracts + USDC are the only addresses /wallet/execute will
// sign for. This blocks the endpoint from being weaponized into a generic
// signing oracle.
const WRITE_ALLOWLIST = new Set<string>(
  [
    config.contracts.ContestEngine,
    config.contracts.ChallengeArena,
    config.contracts.AgentRegistry,
    config.contracts.PrizeEscrow,
    config.contracts.SyndicateFactory,
    config.contracts.PointsLedger,
    config.external.USDC,
  ].map((a) => a.toLowerCase()),
);

const executeBodySchema = {
  parse(body: unknown): {
    contractAddress: `0x${string}`;
    abiFunctionSignature: string;
    abiParameters: ReadonlyArray<string | number | boolean | string[]>;
    amount?: string;
    refId?: string;
  } {
    if (!body || typeof body !== "object") throw new Error("body must be an object");
    const b = body as Record<string, unknown>;
    if (typeof b.contractAddress !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(b.contractAddress)) {
      throw new Error("contractAddress must be a 0x address");
    }
    if (typeof b.abiFunctionSignature !== "string" || !b.abiFunctionSignature.includes("(")) {
      throw new Error("abiFunctionSignature must look like name(types,...)");
    }
    if (!Array.isArray(b.abiParameters)) throw new Error("abiParameters must be an array");
    const amount = typeof b.amount === "string" ? b.amount : undefined;
    const refId = typeof b.refId === "string" ? b.refId : undefined;
    return {
      contractAddress: b.contractAddress.toLowerCase() as `0x${string}`,
      abiFunctionSignature: b.abiFunctionSignature,
      abiParameters: b.abiParameters as ReadonlyArray<string | number | boolean | string[]>,
      amount,
      refId,
    };
  },
};

app.post("/wallet/execute", requireAuth, async (c) => {
  if (!circleDevConfigured()) {
    return c.json({ error: "Circle Dev-Controlled wallets are not configured on this server" }, 503);
  }

  const operator = c.get("address");
  const { rows } = await query<{ circle_wallet_id: string | null }>(
    "select circle_wallet_id from operators where address = $1",
    [operator],
  );
  const walletId = rows[0]?.circle_wallet_id;
  if (!walletId) {
    return c.json(
      { error: "this session is not a Circle-managed wallet; connect an injected wallet and sign client-side" },
      400,
    );
  }

  let body: ReturnType<typeof executeBodySchema.parse>;
  try {
    body = executeBodySchema.parse(await c.req.json());
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }

  if (!WRITE_ALLOWLIST.has(body.contractAddress.toLowerCase())) {
    return c.json({ error: "contract address is not part of ArcRun" }, 400);
  }

  // Enforce the 6-agent profile cap for Circle wallet users at the
  // backend's signing layer. Wagmi users sign client-side and bypass
  // this check, but the cap also stays enforced on-chain once the
  // mainnet AgentRegistry redeploy lands. Off-chain we just refuse to
  // sign a seventh createAgent call so Circle users can't race past the
  // frontend gate.
  if (
    body.contractAddress.toLowerCase() === config.contracts.AgentRegistry.toLowerCase() &&
    body.abiFunctionSignature.startsWith("createAgent")
  ) {
    const { rows: countRows } = await query<{ n: string }>(
      "select count(*)::text as n from agents where owner = $1",
      [operator],
    );
    const owned = Number(countRows[0]?.n ?? "0");
    if (owned >= 6) {
      return c.json({ error: "6 agent cap reached; no more claims allowed" }, 403);
    }
  }

  try {
    const tx = await executeContractCall({
      walletId,
      contractAddress: body.contractAddress,
      abiFunctionSignature: body.abiFunctionSignature,
      abiParameters: body.abiParameters,
      amount: body.amount,
      refId: body.refId,
    });
    void logEvent({
      kind: "wallet_execute",
      address: operator,
      context: { circleTxId: tx.id, state: tx.state, fn: body.abiFunctionSignature, contract: body.contractAddress },
      source: "auth",
    });
    return c.json({ id: tx.id, state: tx.state });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void logEvent({
      level: "error",
      kind: "wallet_execute_error",
      address: operator,
      message,
      context: { fn: body.abiFunctionSignature, contract: body.contractAddress },
      source: "auth",
    });
    return c.json({ error: message }, 502);
  }
});

/// CCTPv2 bridge for email users. Their Dev-Controlled wallet on Arc signs the
/// approve + burn server-side; Circle's Forwarder Service mints to the
/// recipient on the destination chain. The frontend posts (destChain, amount,
/// recipientAddress) and gets back the same step-array shape the wagmi bridge
/// UI renders, so the UI can light up approve / burn / attest / mint live.
const bridgeBodySchema = {
  parse(body: unknown): {
    destChain: string;
    amount: string;
    recipientAddress: `0x${string}`;
  } {
    if (!body || typeof body !== "object") throw new Error("body must be an object");
    const b = body as Record<string, unknown>;
    if (typeof b.destChain !== "string" || b.destChain.length === 0) {
      throw new Error("destChain required (e.g. Base_Sepolia)");
    }
    if (typeof b.amount !== "string" || !/^\d+(\.\d+)?$/.test(b.amount) || Number(b.amount) <= 0) {
      throw new Error("amount must be a positive decimal string");
    }
    if (typeof b.recipientAddress !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(b.recipientAddress)) {
      throw new Error("recipientAddress must be a 0x address");
    }
    return {
      destChain: b.destChain,
      amount: b.amount,
      recipientAddress: b.recipientAddress as `0x${string}`,
    };
  },
};

app.post("/wallet/bridge", requireAuth, async (c) => {
  if (!circleDevConfigured()) {
    return c.json({ error: "Circle Dev-Controlled wallets are not configured on this server" }, 503);
  }

  const operator = c.get("address");
  const { rows } = await query<{ circle_wallet_id: string | null }>(
    "select circle_wallet_id from operators where address = $1",
    [operator],
  );
  const walletId = rows[0]?.circle_wallet_id;
  if (!walletId) {
    return c.json(
      { error: "this session is not a Circle-managed wallet; web3 wallet users bridge through the frontend SDK." },
      400,
    );
  }

  let body: ReturnType<typeof bridgeBodySchema.parse>;
  try {
    body = bridgeBodySchema.parse(await c.req.json());
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }

  try {
    const { circleBridge } = await import("../chain/circleBridge.js");
    const result = await circleBridge({
      sourceChain: "Arc_Testnet",
      destChain: body.destChain,
      amount: body.amount,
      recipientAddress: body.recipientAddress,
    });
    void logEvent({
      kind: "wallet_bridge",
      address: operator,
      context: {
        destChain: body.destChain,
        amount: body.amount,
        recipient: body.recipientAddress,
        state: result.state,
      },
      source: "auth",
    });
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void logEvent({
      kind: "wallet_bridge_failed",
      level: "error",
      address: operator,
      message,
      source: "auth",
    });
    return c.json({ error: message }, 502);
  }
});

app.get("/wallet/tx/:id", requireAuth, async (c) => {
  if (!circleDevConfigured()) {
    return c.json({ error: "Circle Dev-Controlled wallets are not configured on this server" }, 503);
  }
  const id = c.req.param("id");
  if (!id) return c.json({ error: "id required" }, 400);
  try {
    const state = await getTxState(id);
    return c.json(state);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

app.get("/auth/me", requireAuth, async (c) => {
  const address = c.get("address");
  const { rows } = await query<{
    address: string;
    x_handle: string | null;
    current_syndicate_id: string | null;
    email: string | null;
    circle_wallet_id: string | null;
    cycles: string;
  }>(
    "select address, x_handle, current_syndicate_id, email, circle_wallet_id, cycles from operators where address = $1",
    [address],
  );
  const op =
    rows[0] ?? {
      address,
      x_handle: null,
      current_syndicate_id: null,
      email: null,
      circle_wallet_id: null,
      cycles: "0",
    };
  // The wallet is the identity; any authenticated operator can compete. X is an
  // optional social link, not a gate. `walletKind` lets the frontend pick the
  // write path: "circle" => POST /wallet/execute, "wagmi" => useWriteContract.
  const walletKind: "circle" | "wagmi" = op.circle_wallet_id ? "circle" : "wagmi";

  // Count this address's enrolled passkeys so the settings UI can show "ADD
  // A PASSKEY" vs "PASSKEY ENABLED" without a separate round-trip.
  const credCount = await query<{ n: string }>(
    "select count(*)::text as n from webauthn_credentials where operator_address = $1",
    [op.address],
  );
  const hasPasskey = Number(credCount.rows[0]?.n ?? "0") > 0;

  // PointsLedger qualification gate. Off-chain check: the indexer
  // mirrors PointsLedger credits into operators.cycles, and entry is
  // refused below the configured floor. Default 0 = open to everyone
  // (matches the contract's "qualification enforced off-chain at
  // scoring time" note). On-chain enforcement on registerEntry needs a
  // contract redeploy.
  const minCycles = Number(process.env.QUALIFY_MIN_POINTS ?? "0");
  const cycles = Number(op.cycles ?? "0");
  const canEnterContests = minCycles <= 0 || cycles >= minCycles;

  return c.json({
    address: op.address,
    x_handle: op.x_handle,
    current_syndicate_id: op.current_syndicate_id,
    email: op.email,
    walletKind,
    hasPasskey,
    canEnterContests,
    cycles,
    cyclesRequired: minCycles,
  });
});

// ----- Activity and error log -----

// Open ingest: clients and services append events here. The friendly message is
// shown to the user; the raw error and context land here for the admin.
app.post("/events", async (c) => {
  let body: { level?: string; kind?: string; message?: string; context?: unknown; address?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad json" }, 400);
  }
  if (!body.kind || typeof body.kind !== "string") return c.json({ error: "kind required" }, 400);
  const level = body.level === "error" || body.level === "warn" ? body.level : "info";
  await logEvent({
    level,
    kind: body.kind,
    message: typeof body.message === "string" ? body.message : undefined,
    context: body.context,
    address: typeof body.address === "string" ? body.address : undefined,
    source: "web",
  });
  return c.json({ ok: true });
});

// Read: token-gated, admin only. Send the token as the x-admin-token header.
app.get("/admin/events", async (c) => {
  const adminToken = config.adminToken;
  if (!adminToken) return c.json({ error: "admin log disabled (set ADMIN_TOKEN)" }, 503);
  if (c.req.header("x-admin-token") !== adminToken) return c.json({ error: "unauthorized" }, 401);

  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 100), 1), 500);
  const level = c.req.query("level");
  const { rows } = level
    ? await query("select * from events where level = $1 order by id desc limit $2", [level, limit])
    : await query("select * from events order by id desc limit $1", [limit]);
  return c.json({ events: rows });
});

// Set the scoring_mode for a contest or challenge after creation. Called
// by the create-modal once the on-chain tx confirms. Accepts one of:
// pnl_mtm | pnl_realized | volume. Falls through to pnl_mtm if anything
// else is provided. Auth-gated so only the creator can set their event.
app.post("/events/:source/:id/scoring-mode", requireAuth, async (c) => {
  const operator = (c.get("address") as string).toLowerCase();
  const source = c.req.param("source");
  const id = Number(c.req.param("id"));
  if (!["contest", "challenge"].includes(source) || !Number.isFinite(id)) {
    return c.json({ error: "bad source or id" }, 400);
  }
  const body = await c.req.json<{ mode?: string }>();
  const allowed = ["pnl_mtm", "pnl_realized", "volume"];
  const mode = body.mode && allowed.includes(body.mode) ? body.mode : "pnl_mtm";

  if (source === "contest") {
    const { rows } = await query<{ sponsor: string }>(
      "select sponsor from contests where id = $1",
      [id],
    );
    if (!rows[0]) return c.json({ error: "contest not found" }, 404);
    if (rows[0].sponsor.toLowerCase() !== operator) {
      return c.json({ error: "not the sponsor" }, 403);
    }
    await query("update contests set scoring_mode = $1 where id = $2", [mode, id]);
  } else {
    const { rows } = await query<{ creator: string }>(
      "select creator from challenges where id = $1",
      [id],
    );
    if (!rows[0]) return c.json({ error: "challenge not found" }, 404);
    if (rows[0].creator.toLowerCase() !== operator) {
      return c.json({ error: "not the creator" }, 403);
    }
    await query("update challenges set scoring_mode = $1 where id = $2", [mode, id]);
  }
  return c.json({ ok: true, mode });
});

// Read the scoring_mode for a contest or challenge so the live page can
// show "scored by mark-to-market PnL" or similar in the eyebrow.
app.get("/events/:source/:id/scoring-mode", async (c) => {
  const source = c.req.param("source");
  const id = Number(c.req.param("id"));
  if (!["contest", "challenge"].includes(source) || !Number.isFinite(id)) {
    return c.json({ mode: "pnl_mtm" });
  }
  const table = source === "contest" ? "contests" : "challenges";
  const { rows } = await query<{ scoring_mode: string | null }>(
    `select scoring_mode from ${table} where id = $1`,
    [id],
  );
  const mode = rows[0]?.scoring_mode ?? "pnl_mtm";
  return c.json({ mode });
});

// Pinned Arcana markets for a specific event (contest or challenge). Returns
// the market list the coordinator pinned at open so the live page can show
// the round's menu before any agent has placed a trade. Works for both
// contests and challenges because contest_arcana_markets is id-agnostic
// (contest_id column holds either kind).
app.get("/events/:source/:id/arcana-pins", async (c) => {
  const source = c.req.param("source");
  const id = Number(c.req.param("id"));
  if (!["contest", "challenge"].includes(source) || !Number.isFinite(id)) {
    return c.json({ markets: [] });
  }
  const { rows } = await query<{
    market_id: string;
    title: string;
    category: string;
    end_time: string;
  }>(
    `select market_id, title, category, extract(epoch from end_time)::bigint::text as end_time
       from contest_arcana_markets where contest_id = $1 order by market_id asc`,
    [id],
  );
  return c.json({
    markets: rows.map((r) => ({
      id: Number(r.market_id),
      title: r.title,
      category: r.category,
      endTime: Number(r.end_time),
    })),
  });
});

// Recent Arcana events feed. Returns the latest N rows from arcana_events
// for the WHAT'S HAPPENING line and any future debug/admin surface. Public
// read (events are already on chain).
app.get("/arcana/feed", async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 20), 1), 100);
  const { rows } = await query<{
    event_kind: string;
    market_id: string;
    args: Record<string, unknown>;
    tx_hash: string;
    block_number: string;
    created_at: string;
  }>(
    `select event_kind, market_id, args, tx_hash, block_number::text, created_at::text
       from arcana_events order by id desc limit $1`,
    [limit],
  );
  return c.json({
    events: rows.map((r) => ({
      kind: r.event_kind,
      market_id: Number(r.market_id),
      tx_hash: r.tx_hash,
      block_number: Number(r.block_number),
      created_at: r.created_at,
      args: r.args,
    })),
  });
});

// Arcana Markets heartbeat. Read-only public surface (no admin token needed)
// so the live page can render an "Arcana status" pip without privileged auth.
// Returns: contract address, indexer cursor, last reconcile timestamp, open
// market count, last 5 markets summary. Always responds in under 50ms because
// everything reads from arcana_markets + arcana_indexer_state (no chain calls).
app.get("/admin/arcana/state", async (c) => {
  const [cursorRows, openRows, latestRows, eventCountRows] = await Promise.all([
    query<{ last_block: string; updated_at: string }>(
      "select last_block, updated_at from arcana_indexer_state where id = 1",
    ),
    query<{ open_count: string }>(
      `select count(*)::text as open_count from arcana_markets
        where resolved = false and cancelled = false and end_time > now()`,
    ),
    query<{
      market_id: string;
      title: string;
      category: string;
      end_time: string;
      yes_pool: string;
      no_pool: string;
      resolved: boolean;
      cancelled: boolean;
      outcome: boolean | null;
    }>(
      `select market_id, title, category, end_time, yes_pool, no_pool, resolved, cancelled, outcome
         from arcana_markets order by market_id desc limit 5`,
    ),
    query<{ total: string; last_event_at: string | null }>(
      `select count(*)::text as total, max(created_at)::text as last_event_at from arcana_events`,
    ),
  ]);

  return c.json({
    address: config.arcana.address,
    indexing: config.arcana.indexing,
    cursor: cursorRows.rows[0]
      ? {
          last_block: cursorRows.rows[0].last_block,
          updated_at: cursorRows.rows[0].updated_at,
        }
      : null,
    open_markets: Number(openRows.rows[0]?.open_count ?? 0),
    latest: latestRows.rows.map((r) => ({
      market_id: Number(r.market_id),
      title: r.title,
      category: r.category,
      end_time: r.end_time,
      yes_pool_usdc: Number(r.yes_pool) / 1e6,
      no_pool_usdc: Number(r.no_pool) / 1e6,
      resolved: r.resolved,
      cancelled: r.cancelled,
      outcome: r.outcome,
    })),
    events: {
      total: Number(eventCountRows.rows[0]?.total ?? 0),
      last_event_at: eventCountRows.rows[0]?.last_event_at ?? null,
    },
  });
});

// ----- Claim proofs -----

// Returns the (amount, proof) a winner needs to call claimPrize, rebuilt from
// the stored payout tree. Public read: a proof is only useful to the operator
// it pays, and the contract verifies it on-chain.
app.get("/contests/:id/payout", async (c) => {
  const contestId = Number(c.req.param("id"));
  const operator = (c.req.query("operator") ?? "").toLowerCase();
  if (!Number.isFinite(contestId) || !/^0x[a-f0-9]{40}$/.test(operator)) {
    return c.json({ amount: null });
  }

  const { rows } = await query<{ rank: number; operator: string; amount: string }>(
    "select rank, operator, amount from payouts where contest_id = $1 order by rank",
    [contestId],
  );
  if (rows.length === 0) return c.json({ amount: null });

  const leaves = rows.map((r) => payoutLeaf(r.operator as `0x${string}`, BigInt(r.amount)));
  const idx = rows.findIndex((r) => r.operator.toLowerCase() === operator);
  if (idx === -1) return c.json({ amount: null });

  return c.json({ amount: rows[idx]!.amount, proof: merkleProof(leaves, idx) });
});

// The (amount, proof) a challenge winner needs for claimChallengePayout, rebuilt
// from the stored challenge payout tree. Same shape as the contest endpoint.
app.get("/challenges/:id/payout", async (c) => {
  const challengeId = Number(c.req.param("id"));
  const operator = (c.req.query("operator") ?? "").toLowerCase();
  if (!Number.isFinite(challengeId) || !/^0x[a-f0-9]{40}$/.test(operator)) {
    return c.json({ amount: null });
  }

  const { rows } = await query<{ rank: number; operator: string; amount: string }>(
    "select rank, operator, amount from challenge_payouts where challenge_id = $1 order by rank",
    [challengeId],
  );
  if (rows.length === 0) return c.json({ amount: null });

  const leaves = rows.map((r) => payoutLeaf(r.operator as `0x${string}`, BigInt(r.amount)));
  const idx = rows.findIndex((r) => r.operator.toLowerCase() === operator);
  if (idx === -1) return c.json({ amount: null });

  return c.json({ amount: rows[idx]!.amount, proof: merkleProof(leaves, idx) });
});

// ----- Results boards -----

// The full field for a contest: every entrant and, once settled, the ranked
// payouts. Public read, drives the contest detail page's results board.
app.get("/contests/:id/results", async (c) => {
  const contestId = Number(c.req.param("id"));
  if (!Number.isFinite(contestId)) return c.json({ entrants: [], winners: [] });

  const entrants = await query<{ agent_id: string; operator: string }>(
    "select agent_id, operator from entries where contest_id = $1 order by agent_id",
    [contestId],
  );
  const winners = await query<{ rank: number; operator: string; amount: string }>(
    "select rank, operator, amount from payouts where contest_id = $1 order by rank",
    [contestId],
  );
  return c.json({
    entrants: entrants.rows.map((r) => ({ agentId: Number(r.agent_id), operator: r.operator })),
    winners: winners.rows.map((r) => ({ rank: r.rank, operator: r.operator, amount: r.amount })),
  });
});

// Same board for a peer challenge, from the challenge entry and payout tables.
app.get("/challenges/:id/results", async (c) => {
  const challengeId = Number(c.req.param("id"));
  if (!Number.isFinite(challengeId)) return c.json({ entrants: [], winners: [] });

  const entrants = await query<{ agent_id: string; operator: string }>(
    "select agent_id, operator from challenge_entries where challenge_id = $1 order by agent_id",
    [challengeId],
  );
  const winners = await query<{ rank: number; operator: string; amount: string }>(
    "select rank, operator, amount from challenge_payouts where challenge_id = $1 order by rank",
    [challengeId],
  );
  return c.json({
    entrants: entrants.rows.map((r) => ({ agentId: Number(r.agent_id), operator: r.operator })),
    winners: winners.rows.map((r) => ({ rank: r.rank, operator: r.operator, amount: r.amount })),
  });
});

// ----- Traits and mystery claims -----

// The pool of awardable traits, public read so the UI can render chip labels
// without duplicating the source of truth. The legendary entries are visible
// here even when no agent owns one yet so rarity is visible up front. The
// `rugChance` is surfaced too so the UI can show the odds.
app.get("/traits/pool", (c) => c.json({ traits: TRAITS, rugChance: RUG_CHANCE }));

// How many mystery boxes are left in today's global pool and when the next
// batch opens. Public read so the dashboard card can show the live count.
app.get("/mystery/pool", async (c) => {
  // Same UTC+1 day key as the claim writer above. The pool slot lives at
  // (((now at UTC) + 1 hour))::date so the read and the write agree.
  const { rows } = await query<{ claimed: string | null }>(
    "select claimed::text from mystery_pool_daily where day = (((now() at time zone 'utc') - interval '1 hour'))::date",
  );
  const claimed = Number(rows[0]?.claimed ?? 0);
  const remaining = Math.max(0, DAILY_POOL_MAX - claimed);
  return c.json({
    max: DAILY_POOL_MAX,
    claimed,
    remaining,
    resetsAt: nextResetMs(),
  });
});

// Traits an agent currently owns, in award order (oldest first). Public read.
// ----- Agent nicknames -----
//
// Names are stored on `agents.nickname` and shown to everyone, so renaming an
// agent in one place propagates to every surface that reads agents (live
// standings, contest stages, leaderboards, the picker, the profile pages).
// The localStorage path that used to back the rename UI is dead.

const NICK_RE = /^[\w .\-]{1,24}$/;

/// Set or clear the nickname for an agent. Requires a SIWE session and that
/// the connected wallet owns the agent on chain (we use the indexer's `agents`
/// table; if the agent isn't there yet, the rename is refused so we never
/// claim a name we couldn't verify).
app.post("/agents/:id/name", requireAuth, async (c) => {
  const operator = c.get("address");
  const agentId = Number(c.req.param("id"));
  if (!Number.isFinite(agentId)) return c.json({ error: "invalid agent id" }, 400);

  const { name } = await c.req.json<{ name?: string }>();
  const trimmed = (name ?? "").trim();
  if (trimmed && !NICK_RE.test(trimmed)) {
    return c.json({ error: "name must be 1-24 chars: letters, numbers, space, dot, dash, underscore" }, 400);
  }

  const { rows } = await query<{ owner: string }>("select owner from agents where id = $1", [agentId]);
  const owner = rows[0]?.owner;
  if (!owner) return c.json({ error: "agent not found" }, 404);
  if (owner.toLowerCase() !== operator.toLowerCase()) {
    return c.json({ error: "you do not own this agent" }, 403);
  }

  await query("update agents set nickname = $2 where id = $1", [agentId, trimmed || null]);
  return c.json({ id: agentId, nickname: trimmed || null });
});

// ----- Agent skins -----
//
// Custom image per agent. Stored as a base64 data URL in agents.skin (capped
// at 256KB encoded so a few rows don't bloat the operator profile response).
// Client downscales to 256x256 before upload so the column stays small.

const SKIN_MIME = /^data:image\/(png|jpeg|jpg|webp|gif);base64,/;
const SKIN_MAX_LEN = 256 * 1024;

app.post("/agents/:id/skin", requireAuth, async (c) => {
  const operator = c.get("address");
  const agentId = Number(c.req.param("id"));
  if (!Number.isFinite(agentId)) return c.json({ error: "invalid agent id" }, 400);

  const { image } = await c.req.json<{ image?: string }>();
  if (!image || typeof image !== "string") return c.json({ error: "image required" }, 400);
  if (!SKIN_MIME.test(image)) {
    return c.json({ error: "image must be a base64 data URL: png, jpeg, webp, or gif" }, 400);
  }
  if (image.length > SKIN_MAX_LEN) {
    return c.json({ error: `image too large (max ${SKIN_MAX_LEN / 1024}KB encoded)` }, 413);
  }

  const { rows } = await query<{ owner: string }>("select owner from agents where id = $1", [agentId]);
  const owner = rows[0]?.owner;
  if (!owner) return c.json({ error: "agent not found" }, 404);
  if (owner.toLowerCase() !== operator.toLowerCase()) {
    return c.json({ error: "you do not own this agent" }, 403);
  }

  await query("update agents set skin = $2 where id = $1", [agentId, image]);
  return c.json({ id: agentId, ok: true });
});

app.delete("/agents/:id/skin", requireAuth, async (c) => {
  const operator = c.get("address");
  const agentId = Number(c.req.param("id"));
  if (!Number.isFinite(agentId)) return c.json({ error: "invalid agent id" }, 400);

  const { rows } = await query<{ owner: string }>("select owner from agents where id = $1", [agentId]);
  const owner = rows[0]?.owner;
  if (!owner) return c.json({ error: "agent not found" }, 404);
  if (owner.toLowerCase() !== operator.toLowerCase()) {
    return c.json({ error: "you do not own this agent" }, 403);
  }

  await query("update agents set skin = null where id = $1", [agentId]);
  return c.json({ id: agentId, ok: true });
});

// ----- Agent display identity -----
//
// Which name + avatar an agent shows everywhere it appears:
//   'default' -> robot mascot + #id
//   'x'       -> owner's X handle + X avatar
//   'custom'  -> uploaded skin + nickname
// Resolved with graceful fallback to 'default' when the chosen source is
// missing (e.g. mode 'x' but the wallet never linked X).

const DISPLAY_MODES = new Set(["default", "x", "custom"]);

/// Switch an agent's display identity. Owner-gated like the name/skin routes.
app.post("/agents/:id/display-mode", requireAuth, async (c) => {
  const operator = c.get("address");
  const agentId = Number(c.req.param("id"));
  if (!Number.isFinite(agentId)) return c.json({ error: "invalid agent id" }, 400);

  const { mode } = await c.req.json<{ mode?: string }>();
  if (!mode || !DISPLAY_MODES.has(mode)) {
    return c.json({ error: "mode must be default, x, or custom" }, 400);
  }

  const { rows } = await query<{ owner: string }>("select owner from agents where id = $1", [agentId]);
  const owner = rows[0]?.owner;
  if (!owner) return c.json({ error: "agent not found" }, 404);
  if (owner.toLowerCase() !== operator.toLowerCase()) {
    return c.json({ error: "you do not own this agent" }, 403);
  }

  await query("update agents set display_mode = $2 where id = $1", [agentId, mode]);
  return c.json({ id: agentId, mode });
});

/// Bulk resolved display identity for agents. Public, like /agents/names and
/// /agents/skins. For each id returns { kind, name, avatar }: avatar is an
/// image URL (X) or data URL (custom), or null to render the robot mascot;
/// name is null to use the frontend's default (#id).
app.get("/agents/identities", async (c) => {
  const ids = (c.req.query("ids") ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (ids.length === 0) return c.json({ identities: {} });

  const { rows } = await query<{
    id: string;
    display_mode: string | null;
    nickname: string | null;
    skin: string | null;
    x_handle: string | null;
    x_avatar: string | null;
  }>(
    `select a.id, a.display_mode, a.nickname, a.skin, o.x_handle, o.x_avatar
       from agents a
       left join operators o on lower(o.address) = lower(a.owner)
      where a.id = any($1::bigint[])`,
    [ids],
  );

  const identities: Record<string, { kind: string; name: string | null; avatar: string | null }> = {};
  for (const r of rows) {
    const mode = r.display_mode ?? "x";
    if (mode === "x" && r.x_handle) {
      // Prefer the avatar captured at link time; fall back to unavatar.io so an
      // X-linked agent always shows a picture even if it linked before we
      // started storing the profile image.
      const avatar = r.x_avatar ?? `https://unavatar.io/x/${r.x_handle}`;
      identities[r.id] = { kind: "x", name: `@${r.x_handle}`, avatar };
    } else if (mode === "custom" && r.skin) {
      identities[r.id] = { kind: "custom", name: r.nickname ?? null, avatar: r.skin };
    } else {
      identities[r.id] = { kind: "default", name: null, avatar: null };
    }
  }
  return c.json({ identities });
});

/// Bulk raw display modes for agents (the chosen mode, not the resolved one).
/// Used by the owner's management view so the switcher shows the real
/// selection even when the chosen source isn't set yet. Public; harmless.
app.get("/agents/modes", async (c) => {
  const ids = (c.req.query("ids") ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (ids.length === 0) return c.json({ modes: {} });
  const { rows } = await query<{ id: string; display_mode: string | null }>(
    "select id, display_mode from agents where id = any($1::bigint[])",
    [ids],
  );
  const modes: Record<string, string> = {};
  for (const r of rows) modes[r.id] = r.display_mode ?? "x";
  return c.json({ modes });
});

// ----- Admin: soft burn (delist) -----
//
// Hide an agent id from every public listing without touching the chain. The
// on-chain ERC-8004 NFT keeps existing on Arc; we just stop returning it from
// /agents/delisted (the frontend filter set) and every surface that calls
// fetchAgents drops it. Users see nothing. Reversible by DELETE on the same id.

app.post("/admin/agents/:id/delist", async (c) => {
  const adminToken = config.adminToken;
  if (!adminToken) return c.json({ error: "admin disabled (set ADMIN_TOKEN)" }, 503);
  if (c.req.header("x-admin-token") !== adminToken) return c.json({ error: "unauthorized" }, 401);

  const agentId = Number(c.req.param("id"));
  if (!Number.isFinite(agentId)) return c.json({ error: "invalid agent id" }, 400);
  const body = await c.req.json<{ reason?: string }>().catch(() => ({} as { reason?: string }));
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 200) : null;

  await query(
    `insert into delisted_agents (agent_id, reason) values ($1, $2)
       on conflict (agent_id) do update set delisted_at = now(), reason = excluded.reason`,
    [agentId, reason],
  );
  return c.json({ id: agentId, delisted: true });
});

app.delete("/admin/agents/:id/delist", async (c) => {
  const adminToken = config.adminToken;
  if (!adminToken) return c.json({ error: "admin disabled (set ADMIN_TOKEN)" }, 503);
  if (c.req.header("x-admin-token") !== adminToken) return c.json({ error: "unauthorized" }, 401);

  const agentId = Number(c.req.param("id"));
  if (!Number.isFinite(agentId)) return c.json({ error: "invalid agent id" }, 400);
  await query("delete from delisted_agents where agent_id = $1", [agentId]);
  return c.json({ id: agentId, delisted: false });
});

/// Public read of the delist set. The frontend caches this and filters
/// fetchAgents results before returning. Returns an id array, ordered for
/// deterministic etag-friendly responses. No leak of reason or timestamp.
app.get("/agents/delisted", async (c) => {
  const { rows } = await query<{ agent_id: string }>(
    "select agent_id from delisted_agents order by agent_id asc",
  );
  return c.json({ ids: rows.map((r) => Number(r.agent_id)) });
});

/// Bulk skin lookup. Public, like /agents/names. Returns a map of id to data
/// URL for the agents in the query that have a skin set.
app.get("/agents/skins", async (c) => {
  const ids = (c.req.query("ids") ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (ids.length === 0) return c.json({ skins: {} });
  const { rows } = await query<{ id: string; skin: string | null }>(
    "select id, skin from agents where id = any($1::bigint[]) and skin is not null",
    [ids],
  );
  const skins: Record<string, string> = {};
  for (const r of rows) {
    if (r.skin) skins[r.id] = r.skin;
  }
  return c.json({ skins });
});

// ----- Agent training -----
//
// Six numeric stats per agent, each 0..20, each level adds 1% to scoring
// through the coordinator's training multiplier pipeline. Funded by Cycles,
// time-gated. One active training slot per agent. See coordinator/training.ts
// for the multiplier math and combined cap.

async function ensureAgentOwnership(operator: string, agentId: number): Promise<string | null> {
  const { rows } = await query<{ owner: string }>("select owner from agents where id = $1", [agentId]);
  const owner = rows[0]?.owner;
  if (!owner) return "agent not found";
  if (owner.toLowerCase() !== operator.toLowerCase()) return "you do not own this agent";
  return null;
}

async function readAgentStats(agentId: number): Promise<Record<Stat, number>> {
  const { rows } = await query<{ stat: string; level: number }>(
    "select stat, level from agent_stats where agent_id = $1",
    [agentId],
  );
  const out: Record<string, number> = {};
  for (const s of STATS) out[s] = 0;
  for (const r of rows) {
    if (STATS.includes(r.stat as Stat)) out[r.stat] = r.level;
  }
  return out as Record<Stat, number>;
}

/// Read the agent's current training state: all six stat levels, plus the
/// active queue row if any. Lazy-promotes any expired queue row first so
/// reads always reflect the truth.
app.get("/agents/:id/training", async (c) => {
  const agentId = Number(c.req.param("id"));
  if (!Number.isFinite(agentId)) return c.json({ error: "invalid agent id" }, 400);

  await flushTrainingQueue(agentId).catch(() => 0);

  const stats = await readAgentStats(agentId);

  const queue = await query<{
    stat: string;
    from_level: number;
    to_level: number;
    cycles_spent: string;
    started_at: Date;
    completes_at: Date;
  }>(
    `select stat, from_level, to_level, cycles_spent::text, started_at, completes_at
       from training_queue where agent_id = $1`,
    [agentId],
  );

  const active = queue.rows[0]
    ? {
        stat: queue.rows[0].stat,
        fromLevel: queue.rows[0].from_level,
        toLevel: queue.rows[0].to_level,
        cyclesSpent: queue.rows[0].cycles_spent,
        startedAt: queue.rows[0].started_at.toISOString(),
        completesAt: queue.rows[0].completes_at.toISOString(),
      }
    : null;

  return c.json({
    id: agentId,
    stats,
    active,
    maxLevel: MAX_STAT_LEVEL,
    speedup: speedupParams(),
  });
});

/// Start training a stat. Atomically: validate, debit Cycles from the
/// operator's row (refused if balance is short), insert into the queue.
/// `speedupSteps` is optional (default 0): each step adds
/// TRAINING_SPEEDUP_CYCLES_PER_STEP cycles to the cost and shaves
/// TRAINING_SPEEDUP_SECONDS_PER_STEP seconds off the wait.
app.post("/agents/:id/training/start", requireAuth, async (c) => {
  const operator = c.get("address");
  const agentId = Number(c.req.param("id"));
  if (!Number.isFinite(agentId)) return c.json({ error: "invalid agent id" }, 400);

  const body = await c.req.json<{ stat?: string; speedupSteps?: number }>();
  const stat = body.stat;
  if (!stat || !STATS.includes(stat as Stat)) {
    return c.json({ error: `stat must be one of: ${STATS.join(", ")}` }, 400);
  }
  const rawSpeedup = Number(body.speedupSteps ?? 0);
  if (!Number.isFinite(rawSpeedup) || rawSpeedup < 0) {
    return c.json({ error: "speedupSteps must be a non-negative integer" }, 400);
  }

  const ownerErr = await ensureAgentOwnership(operator, agentId);
  if (ownerErr) return c.json({ error: ownerErr }, ownerErr === "agent not found" ? 404 : 403);

  // Promote any expired queue row first so the next checks are consistent.
  await flushTrainingQueue(agentId).catch(() => 0);

  // Reject if already training.
  const existing = await query("select 1 from training_queue where agent_id = $1", [agentId]);
  if (existing.rows.length > 0) {
    return c.json({ error: "agent is already training; cancel or finish-early first" }, 409);
  }

  const stats = await readAgentStats(agentId);
  const fromLevel = stats[stat as Stat];
  if (fromLevel >= MAX_STAT_LEVEL) {
    return c.json({ error: `${stat} is already at max level (${MAX_STAT_LEVEL})` }, 400);
  }

  // Clamp speedup to whatever still reduces wall-clock at this level. Beyond
  // the cap, extra cycles only burn budget without improving the time.
  const cap = maxSpeedupSteps(fromLevel);
  const speedupSteps = Math.min(Math.floor(rawSpeedup), cap);
  const cost = cyclesCost(fromLevel, speedupSteps);
  const secs = secondsCost(fromLevel, speedupSteps);

  // Atomic conditional decrement of Cycles. Refused if balance < cost.
  const debit = await query<{ cycles: string }>(
    `update operators
       set cycles = cycles - $1
       where address = $2 and cycles >= $1
       returning cycles::text`,
    [cost.toString(), operator],
  );
  if (debit.rows.length === 0) {
    return c.json({ error: `not enough cycles (need ${cost.toString()})` }, 402);
  }

  await query(
    `insert into training_queue (agent_id, stat, from_level, to_level, cycles_spent, completes_at)
       values ($1, $2, $3, $4, $5, now() + ($6 || ' seconds')::interval)`,
    [agentId, stat, fromLevel, fromLevel + 1, cost.toString(), secs],
  );

  return c.json({
    id: agentId,
    stat,
    fromLevel,
    toLevel: fromLevel + 1,
    cyclesSpent: cost.toString(),
    cyclesBalance: debit.rows[0]!.cycles,
    secondsTotal: secs,
    speedupStepsApplied: speedupSteps,
    speedupCapAtLevel: cap,
  });
});

/// Cancel an active training. Refunds 50% of Cycles (rounded down).
app.post("/agents/:id/training/cancel", requireAuth, async (c) => {
  const operator = c.get("address");
  const agentId = Number(c.req.param("id"));
  if (!Number.isFinite(agentId)) return c.json({ error: "invalid agent id" }, 400);

  const ownerErr = await ensureAgentOwnership(operator, agentId);
  if (ownerErr) return c.json({ error: ownerErr }, ownerErr === "agent not found" ? 404 : 403);

  const { rows } = await query<{ cycles_spent: string }>(
    "delete from training_queue where agent_id = $1 returning cycles_spent::text",
    [agentId],
  );
  if (rows.length === 0) return c.json({ error: "no active training to cancel" }, 404);

  const spent = BigInt(rows[0]!.cycles_spent);
  const refund = spent / 2n;
  await query("update operators set cycles = cycles + $1 where address = $2", [refund.toString(), operator]);
  return c.json({ id: agentId, refunded: refund.toString() });
});

/// Finish the active training immediately. Charges 2x the remaining time
/// fraction of the original cost.
app.post("/agents/:id/training/finish-early", requireAuth, async (c) => {
  const operator = c.get("address");
  const agentId = Number(c.req.param("id"));
  if (!Number.isFinite(agentId)) return c.json({ error: "invalid agent id" }, 400);

  const ownerErr = await ensureAgentOwnership(operator, agentId);
  if (ownerErr) return c.json({ error: ownerErr }, ownerErr === "agent not found" ? 404 : 403);

  const { rows } = await query<{
    stat: string;
    from_level: number;
    to_level: number;
    cycles_spent: string;
    started_at: Date;
    completes_at: Date;
  }>(
    `select stat, from_level, to_level, cycles_spent::text, started_at, completes_at
       from training_queue where agent_id = $1`,
    [agentId],
  );
  if (rows.length === 0) return c.json({ error: "no active training to finish" }, 404);
  const row = rows[0]!;

  const now = Date.now();
  const started = row.started_at.getTime();
  const ends = row.completes_at.getTime();
  const remainingFrac = Math.max(0, Math.min(1, (ends - now) / Math.max(1, ends - started)));
  const original = BigInt(row.cycles_spent);
  // 2x the un-served fraction. Round up so we never charge less than 1.
  const surchargeNum = original * BigInt(Math.ceil(remainingFrac * 200));
  const surcharge = surchargeNum / 100n;

  if (surcharge > 0n) {
    const debit = await query<{ cycles: string }>(
      `update operators set cycles = cycles - $1 where address = $2 and cycles >= $1 returning cycles::text`,
      [surcharge.toString(), operator],
    );
    if (debit.rows.length === 0) {
      return c.json({ error: `not enough cycles for early finish (need ${surcharge.toString()})` }, 402);
    }
  }

  // Force completes_at into the past then flush.
  await query("update training_queue set completes_at = now() - interval '1 second' where agent_id = $1", [agentId]);
  await flushTrainingQueue(agentId);

  return c.json({ id: agentId, surcharge: surcharge.toString(), newLevel: row.to_level, stat: row.stat });
});

/// Bulk name lookup for surfaces that only know agent ids (live standings,
/// contest stages, anywhere a broadcast frame lacks names). Pass a comma-
/// separated id list; returns a name map (missing entries are simply absent).
app.get("/agents/names", async (c) => {
  const ids = (c.req.query("ids") ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (ids.length === 0) return c.json({ names: {} });
  const { rows } = await query<{ id: string; nickname: string | null }>(
    "select id, nickname from agents where id = any($1::bigint[]) and nickname is not null",
    [ids],
  );
  const names: Record<string, string> = {};
  for (const r of rows) {
    if (r.nickname) names[r.id] = r.nickname;
  }
  return c.json({ names });
});

app.get("/agents/:id/traits", async (c) => {
  const agentId = Number(c.req.param("id"));
  if (!Number.isFinite(agentId)) return c.json({ traits: [] });
  const { rows } = await query<{ trait_id: string; source: string; source_ref: string | null; awarded_at: Date }>(
    "select trait_id, source, source_ref, awarded_at from agent_traits where agent_id = $1 order by awarded_at",
    [agentId],
  );
  return c.json({
    traits: rows.map((r) => {
      const def = traitById(r.trait_id);
      return {
        id: r.trait_id,
        name: def?.name ?? r.trait_id,
        rarity: def?.rarity ?? "common",
        body: def?.body ?? "",
        source: r.source,
        sourceRef: r.source_ref,
        awardedAt: r.awarded_at,
      };
    }),
  });
});

// Whether the connected operator can roll the mystery in the current UTC cycle.
// Returns `ready: true` when they haven't claimed today.
app.get("/mystery/cooldown", requireAuth, async (c) => {
  const operator = c.get("address");
  const { rows } = await query<{ last_claim: Date; total_claims: string }>(
    "select last_claim, total_claims from mystery_claims where operator = $1",
    [operator],
  );
  const last = rows[0]?.last_claim ? new Date(rows[0].last_claim) : null;
  const ready = !last || !sameUtcDay(last);
  return c.json({
    ready,
    lastClaim: last ? last.toISOString() : null,
    nextAvailable: nextResetMs(),
    totalClaims: Number(rows[0]?.total_claims ?? 0),
  });
});

// Roll the mystery. Picks a random trait weighted by rarity that the agent
// doesn't already own, binds it to the agent, and updates the cooldown row.
app.post("/mystery/claim", requireAuth, async (c) => {
  const operator = c.get("address");

  let agentId: number;
  try {
    const body = await c.req.json<{ agentId?: number }>();
    agentId = Number(body.agentId);
  } catch {
    return c.json({ error: "agentId required" }, 400);
  }
  if (!Number.isFinite(agentId) || agentId <= 0) return c.json({ error: "agentId required" }, 400);

  // Ownership check via the indexer's agents table. The indexer writes the
  // owner on AgentCreated, so any agent the operator owns is recorded.
  const ownerRow = await query<{ owner: string }>(
    "select owner from agents where id = $1",
    [String(agentId)],
  );
  const owner = ownerRow.rows[0]?.owner?.toLowerCase();
  if (!owner || owner !== operator.toLowerCase()) {
    return c.json({ error: "you don't own that agent" }, 403);
  }

  // Per-operator daily cap: one box per UTC day.
  const cd = await query<{ last_claim: Date }>(
    "select last_claim from mystery_claims where operator = $1",
    [operator],
  );
  const last = cd.rows[0]?.last_claim ? new Date(cd.rows[0].last_claim) : null;
  if (last && sameUtcDay(last)) {
    return c.json({ error: "already claimed today", nextAvailable: nextResetMs() }, 429);
  }

  // Filter out traits the agent already owns.
  const ownedRows = await query<{ trait_id: string }>(
    "select trait_id from agent_traits where agent_id = $1",
    [agentId],
  );
  const owned = new Set(ownedRows.rows.map((r) => r.trait_id));
  const available = TRAITS.filter((t) => !owned.has(t.id));
  if (available.length === 0) {
    return c.json({ error: "this agent has collected every trait" }, 409);
  }

  // Reserve a slot in today's global pool atomically. "Today" is the
  // claim day in UTC+1, so the boundary lands at 23:00 UTC instead of
  // 00:00 UTC. First-come-first-served: when the row reaches
  // DAILY_POOL_MAX, the next claim sees a false drain rollback and the
  // pool stays at MAX until the next reset.
  const poolRes = await query<{ claimed: number }>(
    `insert into mystery_pool_daily (day, claimed)
       values ((((now() at time zone 'utc') - interval '1 hour'))::date, 1)
       on conflict (day) do update set claimed = mystery_pool_daily.claimed + 1
       returning claimed`,
  );
  const newClaimed = Number(poolRes.rows[0]?.claimed ?? 0);
  if (newClaimed > DAILY_POOL_MAX) {
    await query(
      "update mystery_pool_daily set claimed = claimed - 1 where day = (((now() at time zone 'utc') - interval '1 hour'))::date",
    );
    return c.json({ error: "today's pool is exhausted", nextAvailable: nextResetMs() }, 429);
  }

  // The operator burns their daily attempt as soon as the pool slot is taken,
  // even on a rug.
  await query(
    `insert into mystery_claims (operator, last_claim, total_claims) values ($1, now(), 1)
       on conflict (operator) do update set last_claim = now(), total_claims = mystery_claims.total_claims + 1`,
    [operator],
  );

  // Count how many distinct traits this operator already owns across all
  // their agents so the adaptive rug chance has the right input. The
  // first few rolls feel rewarding; once they've collected most of the
  // catalogue, rugs get more common so completing the set is earned.
  const ownedCountRow = await query<{ n: string }>(
    `select count(distinct at.trait_id)::text as n
       from agent_traits at
       join agents a on a.id = at.agent_id
      where a.owner = $1`,
    [operator],
  );
  const totalOwned = Number(ownedCountRow.rows[0]?.n ?? "0");

  const result = rollMystery(available, totalOwned);
  if (result.rugged || !result.trait) {
    void logEvent({ kind: "mystery_claim", address: operator, context: { agentId, rugged: true, totalOwned }, source: "auth" });
    return c.json({ rugged: true, trait: null, agentId });
  }

  const trait: Trait = result.trait;
  await query(
    "insert into agent_traits (agent_id, trait_id, source) values ($1, $2, 'mystery') on conflict (agent_id, trait_id) do nothing",
    [agentId, trait.id],
  );
  void logEvent({ kind: "mystery_claim", address: operator, context: { agentId, traitId: trait.id, rarity: trait.rarity }, source: "auth" });
  void notify(operator, {
    kind: "mystery_win",
    title: "Mystery box: you won a trait",
    body: `${trait.name} (${trait.rarity}). equip it before your next entry.`,
    href: "/workshop",
    context: { traitId: trait.id, rarity: trait.rarity, agentId },
  });

  return c.json({ rugged: false, trait, agentId });
});

// ----- Notifications -----

/// Per-operator notification feed. Newest first, capped. `?unreadOnly=1`
/// returns just the unread ones (used for the bell badge count).
app.get("/notifications", requireAuth, async (c) => {
  const operator = c.get("address").toLowerCase();
  const unreadOnly = c.req.query("unreadOnly") === "1";
  const { rows } = await query<{
    id: string; kind: string; title: string; body: string | null;
    href: string | null; read: boolean; created_at: Date;
  }>(
    `select id::text, kind, title, body, href, read, created_at
       from notifications
      where operator = $1 ${unreadOnly ? "and read = false" : ""}
      order by created_at desc
      limit 20`,
    [operator],
  );
  const unread = rows.filter((r) => !r.read).length;
  return c.json({
    unread,
    items: rows.map((r) => ({
      id: Number(r.id),
      kind: r.kind,
      title: r.title,
      body: r.body,
      href: r.href,
      read: r.read,
      createdAt: r.created_at,
    })),
  });
});

/// Mark notifications read. Body { ids?: number[] }; omit ids to mark all.
app.post("/notifications/read", requireAuth, async (c) => {
  const operator = c.get("address").toLowerCase();
  let ids: number[] = [];
  try {
    const body = await c.req.json<{ ids?: number[] }>();
    ids = Array.isArray(body.ids) ? body.ids.filter((n) => Number.isFinite(n)) : [];
  } catch { /* mark-all */ }
  if (ids.length > 0) {
    await query(
      "update notifications set read = true where operator = $1 and id = any($2::bigint[])",
      [operator, ids],
    );
  } else {
    await query("update notifications set read = true where operator = $1 and read = false", [operator]);
  }
  return c.json({ ok: true });
});

/// Clear the feed. Body { ids?: number[] } removes those rows; omit ids to
/// clear all of the operator's notifications.
app.post("/notifications/clear", requireAuth, async (c) => {
  const operator = c.get("address").toLowerCase();
  let ids: number[] = [];
  try {
    const body = await c.req.json<{ ids?: number[] }>();
    ids = Array.isArray(body.ids) ? body.ids.filter((n) => Number.isFinite(n)) : [];
  } catch { /* clear-all */ }
  if (ids.length > 0) {
    await query(
      "delete from notifications where operator = $1 and id = any($2::bigint[])",
      [operator, ids],
    );
  } else {
    await query("delete from notifications where operator = $1", [operator]);
  }
  return c.json({ ok: true });
});

// ----- Feedback -----

/// Lightweight global rate limit so the public feedback endpoint can't be
/// used to flood the team's Telegram. Allows a burst, then ~1 per 2s.
const feedbackHits: number[] = [];
function feedbackRateOk(): boolean {
  const now = Date.now();
  while (feedbackHits.length > 0 && now - feedbackHits[0]! > 60_000) feedbackHits.shift();
  if (feedbackHits.length >= 30) return false;
  feedbackHits.push(now);
  return true;
}

/// In-app feedback (bug reports / feature ideas) relayed to the team's
/// Telegram. Public on purpose: anyone using the app can report, signed in
/// or not. The page path and operator address ride along when available so
/// reports are actionable.
app.post("/feedback", async (c) => {
  if (!feedbackRateOk()) return c.json({ error: "rate limited" }, 429);

  let body: { type?: string; message?: string; path?: string; address?: string; image?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad json" }, 400);
  }

  const message = String(body.message ?? "").trim().slice(0, 2000);
  if (!message) return c.json({ error: "message required" }, 400);
  const type = body.type === "idea" ? "IDEA" : "BUG";
  const where = body.path ? String(body.path).slice(0, 200) : "";
  const who = body.address ? String(body.address).slice(0, 64) : "anonymous";

  const token = config.auth.telegram.botToken;
  const chatId = config.auth.telegram.feedbackChatId;
  if (!token || !chatId) {
    console.warn("[feedback] telegram not configured (TELEGRAM_BOT_TOKEN / FEEDBACK_TELEGRAM_CHAT_ID); dropping");
    return c.json({ ok: true, delivered: false });
  }

  const text = `[ARCRUN ${type}]\n\n${message}\n\npage: ${where || "?"}\nfrom: ${who}`;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!res.ok) {
      console.warn(`[feedback] telegram HTTP ${res.status}`);
      return c.json({ ok: false }, 502);
    }
  } catch (err) {
    console.warn(`[feedback] relay failed: ${err instanceof Error ? err.message : err}`);
    return c.json({ ok: false }, 502);
  }

  // Optional screenshot: a data URL from the widget. Decode and forward to the
  // same chat via sendPhoto. Best-effort, so a bad image never fails the
  // report whose text already landed.
  await relayFeedbackPhoto(token, chatId, type, body.image);

  return c.json({ ok: true, delivered: true });
});

/// Decode a data-URL screenshot and post it to Telegram via sendPhoto.
async function relayFeedbackPhoto(
  token: string,
  chatId: string,
  type: string,
  dataUrl: string | undefined,
): Promise<void> {
  if (!dataUrl) return;
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return;
  const mime = m[1]!;
  const buf = Buffer.from(m[2]!, "base64");
  if (buf.length === 0 || buf.length > 6 * 1024 * 1024) return; // cap ~6MB
  try {
    const ext = mime.split("/")[1] ?? "png";
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("caption", `[ARCRUN ${type}] screenshot`);
    form.append("photo", new Blob([buf], { type: mime }), `screenshot.${ext}`);
    const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) console.warn(`[feedback] sendPhoto HTTP ${res.status}`);
  } catch (err) {
    console.warn(`[feedback] sendPhoto failed: ${err instanceof Error ? err.message : err}`);
  }
}

// ----- Tier gates -----

/// Record the tier gate a host chose for a contest or challenge they created.
/// Verifies the caller is the on-chain creator before storing, so one
/// operator can't re-gate another's campaign.
app.post("/tier-gates", requireAuth, async (c) => {
  const operator = c.get("address").toLowerCase();
  let body: { surface?: string; eventId?: number; minTier?: number; maxTier?: number };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad json" }, 400);
  }
  const surface: GateSurface = body.surface === "challenge" ? "challenge" : "contest";
  const eventId = Number(body.eventId);
  if (!Number.isFinite(eventId) || eventId <= 0) return c.json({ error: "eventId required" }, 400);

  // Creator check against chain truth.
  try {
    if (surface === "contest") {
      const c2 = (await publicClient.readContract({
        address: config.contracts.ContestEngine,
        abi: [{ name: "getContest", type: "function", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "tuple", components: [
          { name: "contestType", type: "uint8" }, { name: "status", type: "uint8" }, { name: "winnerCutBps", type: "uint16" },
          { name: "topN", type: "uint16" }, { name: "platformFeeBps", type: "uint16" }, { name: "sponsor", type: "address" },
          { name: "protocolTarget", type: "address" }, { name: "metric", type: "bytes32" }, { name: "startTime", type: "uint64" },
          { name: "endTime", type: "uint64" }, { name: "prizePool", type: "uint256" }, { name: "finalRoot", type: "bytes32" },
        ] }] }] as const,
        functionName: "getContest",
        args: [BigInt(eventId)],
      })) as { sponsor: string };
      if (c2.sponsor.toLowerCase() !== operator) return c.json({ error: "only the host can gate this campaign" }, 403);
    } else {
      const ch = (await publicClient.readContract({
        address: config.contracts.ChallengeArena,
        abi: [{ name: "getChallenge", type: "function", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "tuple", components: [
          { name: "creator", type: "address" }, { name: "kind", type: "uint8" }, { name: "status", type: "uint8" },
          { name: "isPrivate", type: "bool" }, { name: "platformFeeBps", type: "uint16" }, { name: "stake", type: "uint128" },
          { name: "maxEntrants", type: "uint64" }, { name: "joinDeadline", type: "uint64" }, { name: "resolveDeadline", type: "uint64" },
          { name: "winnerRoot", type: "bytes32" },
        ] }] }] as const,
        functionName: "getChallenge",
        args: [BigInt(eventId)],
      })) as { creator: string };
      if (ch.creator.toLowerCase() !== operator) return c.json({ error: "only the host can gate this challenge" }, 403);
    }
  } catch {
    return c.json({ error: "could not verify the campaign" }, 400);
  }

  await setTierGate(surface, eventId, Number(body.minTier ?? 0), Number(body.maxTier ?? 4));
  return c.json({ ok: true });
});

/// Public read of a campaign's tier gate. Null when open to all tiers.
app.get("/tier-gates/:surface/:id", async (c) => {
  const surface: GateSurface = c.req.param("surface") === "challenge" ? "challenge" : "contest";
  const eventId = Number(c.req.param("id"));
  if (!Number.isFinite(eventId)) return c.json({ gate: null });
  const gate = await getTierGate(surface, eventId);
  return c.json({ gate });
});

// ----- Custom contest/challenge requests -----

/// A project submits a custom-campaign request. ArcRun reviews it offline and
/// coordinates the wiring. Persists the request, confirms to the operator,
/// and flags it for admin review.
app.post("/custom-requests", requireAuth, async (c) => {
  const operator = c.get("address").toLowerCase();
  let body: { surface?: string; kind?: string; contact?: string; spec?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad json" }, 400);
  }
  const surface = body.surface === "challenge" ? "challenge" : "contest";
  const contact = (body.contact ?? "").trim();
  const spec = (body.spec ?? "").trim();
  if (contact.length < 3) return c.json({ error: "add a contact so ArcRun can reach you" }, 400);
  if (spec.length < 20) return c.json({ error: "describe the metric and rules in a bit more detail" }, 400);

  const { rows } = await query<{ id: string }>(
    `insert into custom_requests (operator, surface, kind, contact, spec)
     values ($1, $2, $3, $4, $5) returning id::text`,
    [operator, surface, (body.kind ?? "").trim() || null, contact, spec.slice(0, 4000)],
  );
  const id = Number(rows[0]?.id ?? 0);
  void logEvent({ kind: "custom_request", address: operator, context: { id, surface }, source: "auth" });
  void notify(operator, {
    kind: "custom_request",
    title: "Custom campaign request received",
    body: "ArcRun will review it and reach out using the contact you gave.",
    href: "/contests",
    context: { id, surface },
  });
  return c.json({ ok: true, id });
});

/// Admin: list custom requests. Token-gated, newest first.
app.get("/admin/custom-requests", async (c) => {
  const adminToken = config.adminToken;
  if (!adminToken) return c.json({ error: "admin disabled (set ADMIN_TOKEN)" }, 503);
  if (c.req.header("x-admin-token") !== adminToken) return c.json({ error: "unauthorized" }, 401);
  const status = c.req.query("status");
  const { rows } = await query(
    `select id::text, operator, surface, kind, contact, spec, status, created_at
       from custom_requests
      ${status ? "where status = $1" : ""}
      order by created_at desc limit 200`,
    status ? [status] : [],
  );
  return c.json({ requests: rows });
});

// ----- Strength breakdown (workshop panel) -----

import { effectiveStrength, type ContestType, STAT_NAMES as STRENGTH_STAT_NAMES, type StatName as StrengthStatName } from "../scoring/strength.js";

/// Returns the agent's effective-strength breakdown per contest type so
/// the workshop can show "tier × training × traits" with the actual
/// numbers. Optional ?traits=lucky_charm,puzzle_savant query lets the
/// user preview a hypothetical loadout.
// Arcana positions for a single agent. Returns open (unresolved markets),
// settled (resolved markets with PnL), and aggregate stats. Used by the
// workshop UI later; safe to expose publicly since each row is already
// public on the Arcana contract.
app.get("/agents/:id/arcana-positions", async (c) => {
  const agentId = Number(c.req.param("id"));
  if (!Number.isFinite(agentId)) return c.json({ error: "bad agent id" }, 400);
  const { rows } = await query<{
    contest_id: string;
    market_id: string;
    side: "yes" | "no";
    stake_usdc: string;
    entry_yes_pool: string;
    entry_no_pool: string;
    tx_hash: string | null;
    claimed: boolean;
    claim_tx_hash: string | null;
    pnl_usdc: string | null;
    created_at: string;
    title: string | null;
    category: string | null;
    end_time: string | null;
    resolved: boolean | null;
    outcome: boolean | null;
    cur_yes_pool: string | null;
    cur_no_pool: string | null;
  }>(
    `select ap.contest_id, ap.market_id, ap.side, ap.stake_usdc,
            ap.entry_yes_pool, ap.entry_no_pool, ap.tx_hash, ap.claimed,
            ap.claim_tx_hash, ap.pnl_usdc, ap.created_at::text,
            m.title, m.category, m.end_time::text,
            m.resolved, m.outcome,
            m.yes_pool as cur_yes_pool, m.no_pool as cur_no_pool
       from agent_positions ap
       left join arcana_markets m on m.market_id = ap.market_id
      where ap.agent_id = $1
      order by ap.created_at desc
      limit 200`,
    [agentId],
  );

  // Format each row with implied probability deltas the UI can display.
  const positions = rows.map((r) => {
    const entryYes = BigInt(r.entry_yes_pool);
    const entryNo = BigInt(r.entry_no_pool);
    const entrySum = entryYes + entryNo;
    const entryYesProb = entrySum > 0n ? Number((entryYes * 10000n) / entrySum) / 10000 : 0.5;
    const curYes = BigInt(r.cur_yes_pool ?? "0");
    const curNo = BigInt(r.cur_no_pool ?? "0");
    const curSum = curYes + curNo;
    const curYesProb = curSum > 0n ? Number((curYes * 10000n) / curSum) / 10000 : entryYesProb;
    return {
      contest_id: Number(r.contest_id),
      market_id: Number(r.market_id),
      title: r.title ?? "",
      category: r.category ?? "",
      side: r.side,
      stake_usdc: Number(r.stake_usdc) / 1e6,
      entry_yes_prob: entryYesProb,
      current_yes_prob: curYesProb,
      tx_hash: r.tx_hash,
      claimed: r.claimed,
      claim_tx_hash: r.claim_tx_hash,
      pnl_usdc: r.pnl_usdc != null ? Number(r.pnl_usdc) / 1e6 : null,
      resolved: r.resolved ?? false,
      outcome: r.outcome,
      end_time: r.end_time,
      created_at: r.created_at,
    };
  });

  const open = positions.filter((p) => !p.resolved);
  const settled = positions.filter((p) => p.resolved);
  const totalStake = positions.reduce((acc, p) => acc + p.stake_usdc, 0);
  const realizedPnl = settled.reduce((acc, p) => acc + (p.pnl_usdc ?? 0), 0);
  const wins = settled.filter((p) => (p.pnl_usdc ?? 0) > 0).length;

  return c.json({
    agent_id: agentId,
    open,
    settled,
    summary: {
      positions_total: positions.length,
      open_count: open.length,
      settled_count: settled.length,
      total_stake_usdc: totalStake,
      realized_pnl_usdc: realizedPnl,
      win_count: wins,
      win_rate: settled.length > 0 ? wins / settled.length : null,
    },
  });
});

app.get("/agents/:id/strength", async (c) => {
  const agentId = Number(c.req.param("id"));
  if (!Number.isFinite(agentId)) return c.json({ error: "bad agent id" }, 400);
  const traitParam = (c.req.query("traits") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const traits = traitParam.slice(0, 3);

  const { rows: agentRows } = await query<{
    owner: string;
    scout_tier: number;
    analyst_tier: number;
    solver_tier: number;
  }>(
    "select owner, scout_tier, analyst_tier, solver_tier from agents where id = $1",
    [agentId],
  );
  if (!agentRows[0]) return c.json({ error: "agent not found" }, 404);

  const { rows: statRows } = await query<{ stat: string; level: number }>(
    "select stat, level from agent_stats where agent_id = $1",
    [agentId],
  );
  const stats: Partial<Record<StrengthStatName, number>> = {};
  for (const r of statRows) {
    if ((STRENGTH_STAT_NAMES as readonly string[]).includes(r.stat)) {
      stats[r.stat as StrengthStatName] = r.level;
    }
  }

  const tierFor: Record<ContestType, number> = {
    solver: agentRows[0].solver_tier,
    analyst: agentRows[0].analyst_tier,
    scout: agentRows[0].scout_tier,
  };

  const breakdown: Record<ContestType, ReturnType<typeof effectiveStrength>> = {
    solver: effectiveStrength(tierFor.solver, stats, traits, "solver"),
    analyst: effectiveStrength(tierFor.analyst, stats, traits, "analyst"),
    scout: effectiveStrength(tierFor.scout, stats, traits, "scout"),
  };

  return c.json({ agentId, traits, breakdown });
});

// ----- Private challenge invite list -----

/// Public read of who's been invited to a private challenge. The indexer
/// mirrors ChallengeInvited events into challenge_invites; the creator's
/// invite panel renders the list and the join page can show "you are
/// invited" when the connected wallet appears here.
app.get("/challenges/:id/invites", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ invitees: [] });
  const { rows } = await query<{ invitee: string; created_at: Date }>(
    "select invitee, created_at from challenge_invites where challenge_id = $1 order by created_at asc",
    [id],
  );
  return c.json({
    invitees: rows.map((r) => ({ address: r.invitee, invitedAt: r.created_at })),
  });
});

// ----- Claim-prep gate (off-chain 6-agent cap for web3 wallets) -----
//
// Web3 wallet users sign createAgent client-side, so the auth service
// never sees the tx until the indexer picks it up. We can't actually
// stop a determined user from skipping this check, but we expose a
// "are you allowed to claim" endpoint the frontend calls right before
// signing. Combined with the frontend disable/refetch race fixes, this
// catches the casual case where two clicks race past the on-chain
// limit. Permanent enforcement requires an AgentRegistry redeploy.

app.get("/agents/claim-prep", requireAuth, async (c) => {
  const operator = c.get("address");
  const { rows } = await query<{ n: string }>(
    "select count(*)::text as n from agents where owner = $1",
    [operator],
  );
  const owned = Number(rows[0]?.n ?? "0");
  const max = 6;
  return c.json({
    owned,
    max,
    canClaim: owned < max,
    reason: owned < max ? null : `${max} agent cap reached`,
  });
});

// ----- Trait loadouts (equip up to 3 traits per entry) -----

/// Public read of the operator's owned trait pool plus the catalogue. The
/// equip UI uses this to render which traits the user can pick from and
/// what each does.
app.get("/operators/:address/traits", async (c) => {
  const address = (c.req.param("address") ?? "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) return c.json({ owned: [], catalogue: TRAIT_CATALOGUE });
  const owned = await ownedTraitPool(address);
  return c.json({ owned, catalogue: TRAIT_CATALOGUE, maxEquipped: MAX_EQUIPPED });
});

/// Read the equipped loadout for a specific (source, event_id, agent_id).
app.get("/loadouts/:source/:eventId/:agentId", async (c) => {
  const source = c.req.param("source");
  if (source !== "contest" && source !== "challenge") {
    return c.json({ error: "source must be contest or challenge" }, 400);
  }
  const eventId = Number(c.req.param("eventId"));
  const agentId = Number(c.req.param("agentId"));
  if (!Number.isFinite(eventId) || !Number.isFinite(agentId)) {
    return c.json({ error: "bad event or agent id" }, 400);
  }
  const traitIds = await getLoadout(source, eventId, agentId);
  return c.json({ traitIds });
});

/// Set the equipped loadout for a specific entry. Validates max 3, no
/// clashes, no duplicates, and that every trait id is one the operator's
/// agents have collected. Auth-gated to the agent's owner.
app.post("/loadouts/:source/:eventId", requireAuth, async (c) => {
  const operator = c.get("address");
  const source = c.req.param("source");
  if (source !== "contest" && source !== "challenge") {
    return c.json({ error: "source must be contest or challenge" }, 400);
  }
  const eventId = Number(c.req.param("eventId"));
  if (!Number.isFinite(eventId)) return c.json({ error: "bad event id" }, 400);

  let body: { agentId?: number; traitIds?: string[] };
  try { body = await c.req.json(); } catch { return c.json({ error: "bad json" }, 400); }
  const agentId = Number(body.agentId);
  if (!Number.isFinite(agentId) || agentId <= 0) return c.json({ error: "agentId required" }, 400);
  const traitIds = Array.isArray(body.traitIds) ? body.traitIds.map((s) => String(s)) : [];

  // The agent must belong to the operator.
  const { rows: ownerRows } = await query<{ owner: string }>(
    "select owner from agents where id = $1",
    [agentId],
  );
  if (!ownerRows[0]) return c.json({ error: "agent not found" }, 404);
  if (ownerRows[0].owner.toLowerCase() !== operator.toLowerCase()) {
    return c.json({ error: "you do not own this agent" }, 403);
  }

  // Validate shape (max 3, no clash).
  const v = validateLoadout(traitIds);
  if (!v.ok) return c.json({ error: v.reason ?? "invalid loadout" }, 400);

  // Validate ownership of each trait.
  const owned = new Set(await ownedTraitPool(operator));
  for (const id of traitIds) {
    if (!owned.has(id)) return c.json({ error: `you don't own the trait ${id}` }, 403);
  }

  await setLoadout(source as "contest" | "challenge", eventId, agentId, operator, traitIds);
  return c.json({ ok: true, traitIds });
});

// ----- Entry caps (live + one-per-event) -----

/// How many live contests/challenges this operator currently has agents
/// in, plus a boolean for each cap rule so the frontend can disable the
/// ENTER button with a clear message instead of letting the tx fire.
app.get("/operators/:address/entry-caps", async (c) => {
  const address = (c.req.param("address") ?? "").toLowerCase();
  const maxLive = 3;
  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    return c.json({ liveCount: 0, maxLive, atCap: false });
  }
  // The cap is 3 per surface (3 live contests AND 3 live challenges). When a
  // surface is given, count just that one; otherwise fall back to the
  // combined count for older callers.
  const surfaceParam = c.req.query("surface");
  if (surfaceParam === "contest" || surfaceParam === "challenge") {
    const liveCount = await liveEntryCountForSurface(address, surfaceParam);
    return c.json({ liveCount, maxLive, atCap: liveCount >= maxLive, surface: surfaceParam });
  }
  const liveCount = await liveEntryCount(address);
  return c.json({ liveCount, maxLive, atCap: liveCount >= maxLive });
});

/// Scout daily swap budget for one agent. The budget is shared across every
/// contest and challenge the agent runs, so an agent that has spent its swaps
/// elsewhere can't run another volume event until the UTC reset. `enabled` is
/// false when real swaps are off (Scout self-transfers, no budget to gate on).
app.get("/scout/swap-budget/:agentId", async (c) => {
  const agentId = Number(c.req.param("agentId"));
  const enabled = Boolean(config.scout.realSwaps && config.scout.kitKey);
  const cap = config.scout.dailySwapCap;
  if (!enabled || !Number.isFinite(agentId) || agentId <= 0) {
    return c.json({ enabled, remaining: cap, cap });
  }
  const { rows } = await query<{ used: string }>(
    "select used::text from scout_swap_budget where agent_id = $1 and day = (now() at time zone 'utc')::date",
    [agentId],
  );
  const used = Number(rows[0]?.used ?? 0);
  return c.json({ enabled, remaining: Math.max(0, cap - used), cap });
});

/// True if this operator already has any agent entered in (source, id).
app.get("/operators/:address/in-event/:source/:eventId", async (c) => {
  const address = (c.req.param("address") ?? "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) return c.json({ inEvent: false });
  const source = c.req.param("source");
  if (source !== "contest" && source !== "challenge") return c.json({ inEvent: false });
  const eventId = Number(c.req.param("eventId"));
  if (!Number.isFinite(eventId)) return c.json({ inEvent: false });
  const inEvent = await hasAgentInEvent(source, eventId, address);
  return c.json({ inEvent });
});

// ----- Real LLM run audit trail -----
//
// Public read of the per-puzzle solve history for a contest. Drives the
// solve-detail surface on the contest detail page: the exact puzzle text
// and each agent's answer. Limited so a curious viewer can't pull
// thousands of rows in one call.

app.get("/contests/:id/llm-runs", async (c) => {
  const contestId = Number(c.req.param("id"));
  if (!Number.isFinite(contestId)) return c.json({ runs: [] });
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 100), 1), 500);
  const { rows } = await query<{
    agent_id: string;
    operator: string;
    round_idx: number;
    puzzle_idx: number;
    kind: string;
    model: string;
    prompt: string;
    response: string;
    expected: string | null;
    answer: string | null;
    verdict: string;
    latency_ms: number;
    input_tokens: number;
    output_tokens: number;
    cost_usd: string;
    created_at: Date;
  }>(
    `select agent_id::text, operator, round_idx, puzzle_idx, kind, model, prompt, response, expected, answer,
            verdict, latency_ms, input_tokens, output_tokens, cost_usd::text, created_at
       from llm_runs
      where contest_id = $1
      order by round_idx asc, puzzle_idx asc, agent_id asc
      limit $2`,
    [contestId, limit],
  );
  return c.json({
    runs: rows.map((r) => ({
      agentId: Number(r.agent_id),
      operator: r.operator,
      roundIdx: r.round_idx,
      puzzleIdx: r.puzzle_idx,
      kind: r.kind,
      model: r.model,
      prompt: r.prompt,
      response: r.response,
      expected: r.expected,
      answer: r.answer,
      verdict: r.verdict,
      latencyMs: r.latency_ms,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      costUsd: r.cost_usd,
      createdAt: r.created_at,
    })),
  });
});

// ----- Pending winnings (claimable payouts) -----
//
// Lists every contest and challenge where this operator has an unclaimed
// payout. Frontend pairs each row with the on-chain claim check via
// hasClaimed / hasClaimedChallenge so already-claimed prizes drop out
// before render. Drives the dashboard's PRIZES PENDING surface so the
// user can claim from one place instead of finding each contest page.

app.get("/operators/:address/winnings-pending", async (c) => {
  const address = (c.req.param("address") ?? "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) return c.json({ contests: [], challenges: [] });

  // Project contests: payouts table is the source of truth.
  const contestRows = await query<{ id: string; amount: string; contest_type: number | null }>(
    `select p.contest_id::text as id, p.amount::text as amount, c.contest_type
       from payouts p
       left join contests c on c.id = p.contest_id
      where p.operator = $1
      order by p.contest_id desc`,
    [address],
  );

  // Peer challenges: challenge_payouts table.
  const challengeRows = await query<{ id: string; amount: string; kind: number | null }>(
    `select cp.challenge_id::text as id, cp.amount::text as amount, ch.kind
       from challenge_payouts cp
       left join challenges ch on ch.id = cp.challenge_id
      where cp.operator = $1
      order by cp.challenge_id desc`,
    [address],
  );

  return c.json({
    contests: contestRows.rows.map((r) => ({
      id: Number(r.id),
      amount: r.amount,
      contestType: r.contest_type,
    })),
    challenges: challengeRows.rows.map((r) => ({
      id: Number(r.id),
      amount: r.amount,
      kind: r.kind,
    })),
  });
});

// ----- Pending stake refunds (cancelled challenges) -----
//
// Lists challenges this operator joined that the contract has marked
// cancelled. The frontend pairs this with an on-chain refunded() check per
// row so it only renders rows the user can still claim back. Public read
// since the data is already on-chain; callers usually pass their own
// address but knowing somebody else's refund queue isn't sensitive.

app.get("/operators/:address/refunds-pending", async (c) => {
  const address = (c.req.param("address") ?? "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    return c.json({ challenges: [], contests: [] });
  }

  const [chRes, ctRes] = await Promise.all([
    // Return ALL non-settled challenges the operator joined, with the
    // indexer's known status as a hint. The frontend reads chain truth
    // via getChallenge(id) on each row to handle two real cases the
    // indexer misses:
    //   1. ChallengeCancelled event hasn't been processed yet (lag).
    //   2. Challenge is past joinDeadline / resolveDeadline but nobody
    //      has called cancelChallenge() yet, so status is still OPEN
    //      or LOCKED. The operator's stake is recoverable but needs a
    //      cancel tx first; the frontend renders a CANCEL + REFUND
    //      flow for these.
    query<{ id: string; stake: string; status: string }>(
      `select distinct ch.id::text as id, ch.stake::text as stake, ch.status
         from challenge_entries ce
         join challenges ch on ch.id = ce.challenge_id
        where ce.operator = $1
          and ch.status <> 'settled'
        order by ch.id desc`,
      [address],
    ),
    // Contests don't charge an entrant a stake (entry is free for agent
    // owners), so a cancelled contest the operator entered isn't a
    // refund claim; there's nothing to pull back. We still surface it
    // here so the dashboard can show "this contest was cancelled" and
    // the row doesn't vanish silently.
    query<{ id: string }>(
      `select distinct ct.id::text as id
         from entries en
         join contests ct on ct.id = en.contest_id
        where en.operator = $1
          and ct.status = 'cancelled'
        order by ct.id desc`,
      [address],
    ),
  ]);

  return c.json({
    challenges: chRes.rows.map((r) => ({
      id: Number(r.id),
      stake: r.stake,
      indexedStatus: r.status,
    })),
    contests: ctRes.rows.map((r) => ({ id: Number(r.id) })),
  });
});

// ----- Activity feed -----

// Recent on-chain activity across the arena, newest first, from the raw event
// log. Each row carries its tx hash so the UI can link to arcscan. Public read.
const FEED_EVENTS = [
  "ContestListed",
  "EntryRegistered",
  "ContestSettled",
  "ContestCancelled",
  "PrizeClaimed",
  "ChallengeCreated",
  "ChallengeJoined",
  "ChallengeSettled",
  "ChallengeCancelled",
  "AgentCreated",
];

app.get("/activity", async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 30), 1), 100);
  const { rows } = await query<{
    event_name: string;
    args: Record<string, unknown>;
    tx_hash: string;
    block_number: string;
  }>(
    `select event_name, args, tx_hash, block_number
       from events_log
      where event_name = any($1::text[])
      order by block_number desc, log_index desc
      limit $2`,
    [FEED_EVENTS, limit],
  );
  return c.json({
    events: rows.map((r) => ({
      type: r.event_name,
      args: r.args,
      txHash: r.tx_hash,
      block: Number(r.block_number),
    })),
  });
});

// ----- Read surfaces: leaderboard and operator profiles -----

// Global leaderboard from the indexer tables. Participation from entries, wins
// and earnings from payouts, Cycles from operators, reputation summed across the
// operator's agents (raw, scaled 1e6). Public read.
app.get("/leaderboard", async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50), 1), 200);
  const { rows } = await query<{
    operator: string;
    entered: string;
    wins: string;
    earned: string | null;
    cycles: string;
    reputation: string;
    primary_agent_id: string | null;
    primary_skin: string | null;
    primary_display_mode: string | null;
    primary_nickname: string | null;
    x_handle: string | null;
    x_avatar: string | null;
  }>(
    // Primary agent is the operator's first non-delisted agent by id. Its
    // skin shows in the leaderboard row so identifiable operators (the
    // ones who bothered to upload a skin) read as themselves at a glance
    // instead of as a generic mascot. Falls back to a Robot variant
    // when no skin is set.
    `select
       op.address              as operator,
       coalesce(e.entered, 0)  as entered,
       coalesce(p.wins, 0)     as wins,
       coalesce(p.earned, 0)   as earned,
       op.cycles               as cycles,
       coalesce(ag.reputation, 0) as reputation,
       pa.id::text             as primary_agent_id,
       pa.skin                 as primary_skin,
       pa.display_mode         as primary_display_mode,
       pa.nickname             as primary_nickname,
       op.x_handle             as x_handle,
       op.x_avatar             as x_avatar
     from operators op
     -- Entries: union of contest + challenge participation so the
     -- "ENTERED" column reflects everything the operator showed up for.
     left join (
       select operator, count(*) as entered from (
         select distinct operator, contest_id::text as event_id, 'c' as src from entries
         union all
         select distinct operator, challenge_id::text as event_id, 'h' as src from challenge_entries
       ) all_entries group by operator
     ) e on e.operator = op.address
     -- Wins + earnings: union of contest payouts and challenge payouts so
     -- challenge winners actually count toward WINS / EARNED.
     left join (
       select operator, count(*) as wins, sum(amount) as earned from (
         select operator, contest_id::text as event_id, amount from payouts
         union all
         select operator, challenge_id::text as event_id, amount from challenge_payouts
       ) all_payouts group by operator
     ) p on p.operator = op.address
     left join (select owner, sum(reputation) as reputation from agents group by owner) ag
       on ag.owner = op.address
     left join lateral (
       select a.id, a.skin, a.display_mode, a.nickname
         from agents a
         left join delisted_agents d on d.agent_id = a.id
        where a.owner = op.address and d.agent_id is null
        order by a.id
        limit 1
     ) pa on true
     -- Include anyone who entered a contest OR a challenge.
     where op.address in (
       select distinct operator from entries
       union
       select distinct operator from challenge_entries
     )
     order by wins desc nulls last, earned desc nulls last, cycles desc, entered desc
     limit $1`,
    [limit],
  );
  return c.json({
    leaders: rows.map((r) => {
      // Resolve the primary agent's display identity so the row avatar honors
      // its mode (X avatar / custom skin / robot), matching everywhere else.
      const mode = r.primary_display_mode ?? "x";
      let primarySkin: string | null = null;
      let primaryName: string | null = null;
      if (mode === "x" && r.x_handle) {
        primarySkin = r.x_avatar ?? `https://unavatar.io/x/${r.x_handle}`;
        primaryName = `@${r.x_handle}`;
      } else if (mode === "custom" && r.primary_skin) {
        primarySkin = r.primary_skin;
        primaryName = r.primary_nickname ?? null;
      }
      return {
        operator: r.operator,
        entered: Number(r.entered),
        wins: Number(r.wins),
        earned: r.earned ?? "0",
        cycles: Number(r.cycles ?? "0"),
        reputation: r.reputation ?? "0",
        primaryAgentId: r.primary_agent_id ? Number(r.primary_agent_id) : null,
        primarySkin,
        primaryName,
      };
    }),
  });
});

// One operator's profile: their agents, lifetime stats, and recent contests.
app.get("/operators/:address", async (c) => {
  const address = (c.req.param("address") ?? "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) return c.json({ error: "invalid address" }, 400);

  const op = await query<{
    address: string;
    x_handle: string | null;
    telegram_id: string | null;
    telegram_username: string | null;
    discord_id: string | null;
    discord_username: string | null;
    current_syndicate_id: string | null;
    cycles: string;
  }>(
    "select address, x_handle, telegram_id, telegram_username, discord_id, discord_username, current_syndicate_id, cycles from operators where address = $1",
    [address],
  );
  const agents = await query<{ id: string; scout_tier: number; analyst_tier: number; solver_tier: number; reputation: string; nickname: string | null; display_mode: string | null; has_skin: boolean }>(
    "select id, scout_tier, analyst_tier, solver_tier, reputation, nickname, display_mode, (skin is not null) as has_skin from agents where owner = $1 order by id",
    [address],
  );
  const stats = await query<{ entered: string; wins: string; earned: string }>(
    `select
       (select count(distinct contest_id) from entries where operator = $1) as entered,
       (select count(distinct contest_id) from payouts where operator = $1) as wins,
       (select coalesce(sum(amount), 0) from payouts where operator = $1)   as earned`,
    [address],
  );
  const contests = await query<{ contest_id: string; contest_type: number | null; status: string | null; won: string | null; claimed: boolean }>(
    `select distinct on (e.contest_id)
       e.contest_id, c.contest_type, c.status, p.amount as won, e.claimed
     from entries e
     left join contests c on c.id = e.contest_id
     left join payouts p on p.contest_id = e.contest_id and p.operator = e.operator
     where e.operator = $1
     order by e.contest_id desc
     limit 20`,
    [address],
  );

  const s = stats.rows[0] ?? { entered: "0", wins: "0", earned: "0" };
  // Total reputation is the sum across the operator's agents (raw, scaled 1e6).
  const reputation = agents.rows.reduce((sum, a) => sum + BigInt(a.reputation ?? "0"), 0n).toString();
  return c.json({
    operator: op.rows[0]?.address ?? address,
    xHandle: op.rows[0]?.x_handle ?? null,
    telegramId: op.rows[0]?.telegram_id ?? null,
    telegramUsername: op.rows[0]?.telegram_username ?? null,
    discordId: op.rows[0]?.discord_id ?? null,
    discordUsername: op.rows[0]?.discord_username ?? null,
    syndicateId: op.rows[0]?.current_syndicate_id ?? null,
    cycles: Number(op.rows[0]?.cycles ?? "0"),
    reputation,
    stats: { entered: Number(s.entered), wins: Number(s.wins), earned: s.earned ?? "0" },
    agents: agents.rows.map((r) => ({
      id: Number(r.id),
      scoutTier: r.scout_tier,
      analystTier: r.analyst_tier,
      solverTier: r.solver_tier,
      reputation: r.reputation,
      nickname: r.nickname,
      displayMode: r.display_mode ?? "x",
      hasSkin: r.has_skin,
    })),
    contests: contests.rows.map((r) => ({
      contestId: Number(r.contest_id),
      contestType: r.contest_type,
      status: r.status,
      won: r.won,
      claimed: r.claimed,
    })),
  });
});

// ----- X (Twitter) OAuth2 with PKCE -----

function xConfigured() {
  return Boolean(config.auth.x.clientId && config.auth.x.clientSecret && config.auth.x.callbackUrl);
}

app.get("/auth/x/start", requireAuth, async (c) => {
  if (!xConfigured()) return c.json({ error: "X OAuth not configured" }, 501);
  const address = c.get("address");
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));
  await redis.set(`xoauth:${state}`, JSON.stringify({ address, verifier }), "EX", STATE_TTL);

  const url = new URL("https://twitter.com/i/oauth2/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.auth.x.clientId!);
  url.searchParams.set("redirect_uri", config.auth.x.callbackUrl!);
  url.searchParams.set("scope", "tweet.read users.read");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return c.redirect(url.toString());
});

app.get("/auth/x/callback", async (c) => {
  if (!xConfigured()) return c.json({ error: "X OAuth not configured" }, 501);
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) return c.json({ error: "missing code or state" }, 400);

  const stored = await redis.getdel(`xoauth:${state}`);
  if (!stored) return c.json({ error: "invalid or expired state" }, 401);
  const { address, verifier } = JSON.parse(stored) as { address: string; verifier: string };

  const basic = Buffer.from(`${config.auth.x.clientId}:${config.auth.x.clientSecret}`).toString("base64");
  const tokenRes = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${basic}` },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.auth.x.callbackUrl!,
      code_verifier: verifier,
    }),
  });
  if (!tokenRes.ok) return c.json({ error: "token exchange failed" }, 502);
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const meRes = await fetch("https://api.twitter.com/2/users/me?user.fields=profile_image_url", {
    headers: { authorization: `Bearer ${access_token}` },
  });
  if (!meRes.ok) return c.json({ error: "could not fetch X profile" }, 502);
  const me = (await meRes.json()) as { data: { username: string; profile_image_url?: string } };

  // X returns a 48px `_normal` avatar; swap to `_400x400` for a crisp one.
  const xAvatar = me.data.profile_image_url
    ? me.data.profile_image_url.replace("_normal", "_400x400")
    : null;
  await query(
    "update operators set x_handle = $2, x_avatar = $3 where address = $1",
    [address, me.data.username, xAvatar],
  );

  // Return the user to their own operator page so the freshly-linked X
  // handle is visible immediately; landing on the root makes the OAuth
  // look like it failed.
  const redirectTo = new URL(`/operators/${address}`, config.auth.appUrl);
  redirectTo.searchParams.set("x_bound", me.data.username);
  return c.redirect(redirectTo.toString());
});

app.post("/auth/x/unbind", requireAuth, async (c) => {
  const address = c.get("address");
  await query("update operators set x_handle = null, x_avatar = null where address = $1", [address]);
  return c.json({ ok: true });
});

// ----- Telegram Login Widget -----
//
// The widget runs client-side, opens Telegram for auth, and redirects to the
// callback below with id, first_name, last_name, username, photo_url, auth_date
// and hash query params. The hash is HMAC-SHA256 of the sorted data string,
// keyed by SHA256(bot_token). We verify the hash and a freshness window before
// linking the telegram_id and telegram_username onto the operator's row.

function telegramConfigured() {
  return Boolean(config.auth.telegram.botToken && config.auth.telegram.botUsername);
}

function verifyTelegramHash(data: Record<string, string>, botToken: string): boolean {
  const { hash, ...rest } = data;
  if (!hash) return false;
  const dataCheck = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join("\n");
  const secret = createHash("sha256").update(botToken).digest();
  const hmac = createHmac("sha256", secret).update(dataCheck).digest("hex");
  return hmac === hash;
}

app.get("/auth/telegram/config", (c) =>
  c.json({ configured: telegramConfigured(), botUsername: config.auth.telegram.botUsername ?? null }),
);

app.get("/auth/telegram/callback", requireAuth, async (c) => {
  if (!telegramConfigured()) return c.json({ error: "Telegram OAuth not configured" }, 501);
  const address = c.get("address");
  const q = c.req.query() as Record<string, string>;

  if (!q.id || !q.auth_date || !q.hash) {
    return c.json({ error: "missing telegram fields" }, 400);
  }

  // Replay protection: the widget signs auth_date; reject anything older than
  // a day or sitting in the future (clock skew).
  const age = Math.floor(Date.now() / 1000) - Number(q.auth_date);
  if (!Number.isFinite(age) || age < -60 || age > 86400) {
    return c.json({ error: "telegram data outside acceptable freshness" }, 401);
  }

  if (!verifyTelegramHash(q, config.auth.telegram.botToken!)) {
    return c.json({ error: "invalid telegram signature" }, 401);
  }

  const username = q.username ?? null;
  await query(
    "update operators set telegram_id = $2, telegram_username = $3 where address = $1",
    [address, q.id, username],
  );

  const redirectTo = new URL(config.auth.appUrl);
  redirectTo.pathname = `/operators/${address}`;
  redirectTo.searchParams.set("telegram_bound", username ?? q.id);
  return c.redirect(redirectTo.toString());
});

app.post("/auth/telegram/unbind", requireAuth, async (c) => {
  const address = c.get("address");
  await query(
    "update operators set telegram_id = null, telegram_username = null where address = $1",
    [address],
  );
  return c.json({ ok: true });
});

// ----- Discord OAuth2 -----
//
// Mirrors the X flow with Discord's authorize/token/users endpoints. Confidential
// client (we hold a client secret) plus PKCE so the code exchange is double-bound
// to the original session. Scope is `identify` only; we don't ask for email.

function discordConfigured() {
  return Boolean(
    config.auth.discord.clientId && config.auth.discord.clientSecret && config.auth.discord.callbackUrl,
  );
}

app.get("/auth/discord/start", requireAuth, async (c) => {
  if (!discordConfigured()) return c.json({ error: "Discord OAuth not configured" }, 501);
  const address = c.get("address");
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));
  await redis.set(`discordoauth:${state}`, JSON.stringify({ address, verifier }), "EX", STATE_TTL);

  const url = new URL("https://discord.com/api/oauth2/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.auth.discord.clientId!);
  url.searchParams.set("redirect_uri", config.auth.discord.callbackUrl!);
  url.searchParams.set("scope", "identify");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return c.redirect(url.toString());
});

app.get("/auth/discord/callback", async (c) => {
  if (!discordConfigured()) return c.json({ error: "Discord OAuth not configured" }, 501);
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) return c.json({ error: "missing code or state" }, 400);

  const stored = await redis.getdel(`discordoauth:${state}`);
  if (!stored) return c.json({ error: "invalid or expired state" }, 401);
  const { address, verifier } = JSON.parse(stored) as { address: string; verifier: string };

  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.auth.discord.clientId!,
      client_secret: config.auth.discord.clientSecret!,
      grant_type: "authorization_code",
      code,
      redirect_uri: config.auth.discord.callbackUrl!,
      code_verifier: verifier,
    }),
  });
  if (!tokenRes.ok) return c.json({ error: "discord token exchange failed" }, 502);
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const meRes = await fetch("https://discord.com/api/users/@me", {
    headers: { authorization: `Bearer ${access_token}` },
  });
  if (!meRes.ok) return c.json({ error: "could not fetch discord profile" }, 502);
  const me = (await meRes.json()) as { id: string; username: string };

  await query(
    "update operators set discord_id = $2, discord_username = $3 where address = $1",
    [address, me.id, me.username],
  );

  const redirectTo = new URL(config.auth.appUrl);
  redirectTo.pathname = `/operators/${address}`;
  redirectTo.searchParams.set("discord_bound", me.username);
  return c.redirect(redirectTo.toString());
});

app.post("/auth/discord/unbind", requireAuth, async (c) => {
  const address = c.get("address");
  await query(
    "update operators set discord_id = null, discord_username = null where address = $1",
    [address],
  );
  return c.json({ ok: true });
});

// Syndicate war board. Returns the most recently settled week's
// standings (rank, total, member count, syndicate name) plus the
// active week id so the frontend can show "last week's standings"
// alongside "this week's multiplier". Falls back to an empty array
// before any week has been settled (the scoring path uses the
// cumulative-rep fallback in that case).
app.get("/syndicates/war", async (c) => {
  const latest = await query<{ week_id: string }>(
    "select week_id from syndicate_war_results order by week_id desc limit 1",
  );
  const weekId = latest.rows[0]?.week_id ?? null;
  if (!weekId) {
    return c.json({ weekId: null, standings: [], multipliersByRank: { 1: 1.05, 2: 1.03, 3: 1.02 } });
  }
  const { rows } = await query<{
    syndicate_id: string;
    rank: string;
    total: string;
    member_count: string;
    name: string | null;
  }>(
    `select wr.syndicate_id::text, wr.rank::text, wr.total::text, wr.member_count::text, s.name
       from syndicate_war_results wr
       left join syndicates s on s.id = wr.syndicate_id
      where wr.week_id = $1
      order by wr.rank asc`,
    [weekId],
  );
  return c.json({
    weekId,
    standings: rows.map((r) => ({
      syndicateId: Number(r.syndicate_id),
      name: r.name,
      rank: Number(r.rank),
      total: r.total,
      memberCount: Number(r.member_count),
    })),
    multipliersByRank: { 1: 1.05, 2: 1.03, 3: 1.02 },
  });
});

serve({ fetch: app.fetch, port: config.auth.port }, (info) => {
  console.log(`auth service on http://localhost:${info.port}`);
});
