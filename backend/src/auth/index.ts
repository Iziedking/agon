import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createHash, randomBytes } from "node:crypto";
import { generateSiweNonce, parseSiweMessage } from "viem/siwe";

import { config } from "../config/index.js";
import { publicClient } from "../chain/arc.js";
import { query } from "../db/pool.js";
import { logEvent } from "../events.js";
import { merkleProof, payoutLeaf } from "../coordinator/merkle.js";
import { redis } from "../redis.js";
import { issueToken, requireAuth } from "./jwt.js";

/// Auth service: SIWE wallet login plus optional X (Twitter) OAuth2 linking.
/// The wallet is the identity, so X is not required to enter contests; it is a
/// social link, and Discord can be added the same way later.
/// See ARCRUN_PLAN.md section 5.1.

const app = new Hono<{ Variables: { address: string } }>();

// Allow the frontend origin to call the auth API from the browser.
app.use(
  "*",
  cors({
    origin: config.auth.appUrl,
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
  void logEvent({ kind: "login", address, source: "auth" });
  return c.json({ token, address });
});

app.get("/auth/me", requireAuth, async (c) => {
  const address = c.get("address");
  const { rows } = await query<{ address: string; x_handle: string | null; current_syndicate_id: string | null }>(
    "select address, x_handle, current_syndicate_id from operators where address = $1",
    [address],
  );
  const op = rows[0] ?? { address, x_handle: null, current_syndicate_id: null };
  // The wallet is the identity; any authenticated operator can compete. X is an
  // optional social link, not a gate.
  return c.json({ ...op, canEnterContests: true });
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

// ----- Read surfaces: leaderboard and operator profiles -----

// Global leaderboard from the indexer tables. Participation comes from entries,
// wins and earnings from the settlement payouts. Public read.
app.get("/leaderboard", async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50), 1), 200);
  const { rows } = await query<{ operator: string; entered: string; wins: string; earned: string | null }>(
    `select
       coalesce(e.operator, p.operator) as operator,
       coalesce(e.entered, 0)           as entered,
       coalesce(p.wins, 0)              as wins,
       coalesce(p.earned, 0)           as earned
     from (select operator, count(distinct contest_id) as entered from entries group by operator) e
     full outer join
       (select operator, count(distinct contest_id) as wins, sum(amount) as earned from payouts group by operator) p
       on e.operator = p.operator
     order by earned desc, wins desc, entered desc
     limit $1`,
    [limit],
  );
  return c.json({
    leaders: rows.map((r) => ({
      operator: r.operator,
      entered: Number(r.entered),
      wins: Number(r.wins),
      earned: r.earned ?? "0",
    })),
  });
});

// One operator's profile: their agents, lifetime stats, and recent contests.
app.get("/operators/:address", async (c) => {
  const address = (c.req.param("address") ?? "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) return c.json({ error: "invalid address" }, 400);

  const op = await query<{ address: string; x_handle: string | null; current_syndicate_id: string | null; reputation: string }>(
    "select address, x_handle, current_syndicate_id, reputation from operators where address = $1",
    [address],
  );
  const agents = await query<{ id: string; scout_tier: number; analyst_tier: number; solver_tier: number; reputation: string }>(
    "select id, scout_tier, analyst_tier, solver_tier, reputation from agents where owner = $1 order by id",
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
  return c.json({
    operator: op.rows[0]?.address ?? address,
    xHandle: op.rows[0]?.x_handle ?? null,
    syndicateId: op.rows[0]?.current_syndicate_id ?? null,
    reputation: op.rows[0]?.reputation ?? "0",
    stats: { entered: Number(s.entered), wins: Number(s.wins), earned: s.earned ?? "0" },
    agents: agents.rows.map((r) => ({
      id: Number(r.id),
      scoutTier: r.scout_tier,
      analystTier: r.analyst_tier,
      solverTier: r.solver_tier,
      reputation: r.reputation,
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

  const meRes = await fetch("https://api.twitter.com/2/users/me", {
    headers: { authorization: `Bearer ${access_token}` },
  });
  if (!meRes.ok) return c.json({ error: "could not fetch X profile" }, 502);
  const me = (await meRes.json()) as { data: { username: string } };

  await query("update operators set x_handle = $2 where address = $1", [address, me.data.username]);

  const redirectTo = new URL(config.auth.appUrl);
  redirectTo.searchParams.set("x_bound", me.data.username);
  return c.redirect(redirectTo.toString());
});

app.post("/auth/x/unbind", requireAuth, async (c) => {
  const address = c.get("address");
  await query("update operators set x_handle = null where address = $1", [address]);
  return c.json({ ok: true });
});

serve({ fetch: app.fetch, port: config.auth.port }, (info) => {
  console.log(`auth service on http://localhost:${info.port}`);
});
