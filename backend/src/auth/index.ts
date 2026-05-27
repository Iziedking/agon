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

const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 days, matches issueToken expiry

/// Auth service: SIWE wallet login plus optional X (Twitter) OAuth2 linking.
/// The wallet is the identity, so X is not required to enter contests; it is a
/// social link, and Discord can be added the same way later.
/// See ARCRUN_PLAN.md section 5.1.

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
// here even when no agent owns one yet (rarity is part of the pitch). The
// `rugChance` is surfaced too so the UI can show the odds.
app.get("/traits/pool", (c) => c.json({ traits: TRAITS, rugChance: RUG_CHANCE }));

// How many mystery boxes are left in today's global pool and when the next
// batch opens. Public read so the dashboard card can show the live count.
app.get("/mystery/pool", async (c) => {
  const { rows } = await query<{ claimed: string | null }>(
    "select claimed::text from mystery_pool_daily where day = (now() at time zone 'utc')::date",
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

  // Reserve a slot in today's global pool atomically. The insert/upsert returns
  // the new `claimed` value; if it exceeds the cap, the pool is full and we
  // roll the count back so the next claimer doesn't see a false drain.
  const poolRes = await query<{ claimed: number }>(
    `insert into mystery_pool_daily (day, claimed)
       values ((now() at time zone 'utc')::date, 1)
       on conflict (day) do update set claimed = mystery_pool_daily.claimed + 1
       returning claimed`,
  );
  const newClaimed = Number(poolRes.rows[0]?.claimed ?? 0);
  if (newClaimed > DAILY_POOL_MAX) {
    await query(
      "update mystery_pool_daily set claimed = claimed - 1 where day = (now() at time zone 'utc')::date",
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

  const result = rollMystery(available);
  if (result.rugged || !result.trait) {
    void logEvent({ kind: "mystery_claim", address: operator, context: { agentId, rugged: true }, source: "auth" });
    return c.json({ rugged: true, trait: null, agentId });
  }

  const trait: Trait = result.trait;
  await query(
    "insert into agent_traits (agent_id, trait_id, source) values ($1, $2, 'mystery') on conflict (agent_id, trait_id) do nothing",
    [agentId, trait.id],
  );
  void logEvent({ kind: "mystery_claim", address: operator, context: { agentId, traitId: trait.id, rarity: trait.rarity }, source: "auth" });

  return c.json({ rugged: false, trait, agentId });
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
  }>(
    `select
       op.address              as operator,
       coalesce(e.entered, 0)  as entered,
       coalesce(p.wins, 0)     as wins,
       coalesce(p.earned, 0)   as earned,
       op.cycles               as cycles,
       coalesce(ag.reputation, 0) as reputation
     from operators op
     left join (select operator, count(distinct contest_id) as entered from entries group by operator) e
       on e.operator = op.address
     left join (select operator, count(distinct contest_id) as wins, sum(amount) as earned from payouts group by operator) p
       on p.operator = op.address
     left join (select owner, sum(reputation) as reputation from agents group by owner) ag
       on ag.owner = op.address
     where op.address in (select distinct operator from entries)
     order by earned desc nulls last, wins desc, cycles desc, entered desc
     limit $1`,
    [limit],
  );
  return c.json({
    leaders: rows.map((r) => ({
      operator: r.operator,
      entered: Number(r.entered),
      wins: Number(r.wins),
      earned: r.earned ?? "0",
      cycles: Number(r.cycles ?? "0"),
      reputation: r.reputation ?? "0",
    })),
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
  const agents = await query<{ id: string; scout_tier: number; analyst_tier: number; solver_tier: number; reputation: string; nickname: string | null }>(
    "select id, scout_tier, analyst_tier, solver_tier, reputation, nickname from agents where owner = $1 order by id",
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

serve({ fetch: app.fetch, port: config.auth.port }, (info) => {
  console.log(`auth service on http://localhost:${info.port}`);
});
