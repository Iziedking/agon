import { Pool } from "pg";
import { HttpError } from "./http.ts";

// pg 8.16.3 query/transaction API. Separate BNB tables and network keys allow
// the same database host without sharing Arc sessions, identity or operations.
let pool: Pool | undefined;
let ready: Promise<void> | undefined;
export async function database(): Promise<Pool> {
  if (!process.env.BNB_DATABASE_URL) throw new HttpError(503, "BNB account storage is unavailable. You can still browse agents.");
  if (!pool) {
    pool = new Pool({ connectionString: process.env.BNB_DATABASE_URL, max: 4, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, statement_timeout: 5000 });
    pool.on("error", () => console.error(JSON.stringify({ event: "bnb_database_connection_error" })));
  }
  if (!ready) ready = pool.query(`
    CREATE TABLE IF NOT EXISTS bnb_auth_challenges (
      nonce_hash text PRIMARY KEY, chain_id integer NOT NULL CHECK (chain_id IN (56,97)),
      address text NOT NULL, origin text NOT NULL, message text NOT NULL, expires_at timestamptz NOT NULL
    );
    CREATE INDEX IF NOT EXISTS bnb_auth_challenge_expiry ON bnb_auth_challenges(expires_at);
    CREATE TABLE IF NOT EXISTS bnb_auth_sessions (
      token_hash text PRIMARY KEY, chain_id integer NOT NULL CHECK (chain_id IN (56,97)),
      address text NOT NULL, expires_at timestamptz NOT NULL
    );
    CREATE INDEX IF NOT EXISTS bnb_auth_session_expiry ON bnb_auth_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS bnb_market_listings (
      chain_id integer NOT NULL CHECK (chain_id IN (56,97)), agent_id text NOT NULL,
      owner_address text NOT NULL, category text NOT NULL, version_hash text NOT NULL,
      published_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (chain_id,agent_id)
    );
  `).then(() => undefined).catch((error: unknown) => { ready = undefined; throw error; });
  await ready; return pool;
}
export async function closeDatabase() { if (pool) await pool.end(); pool = undefined; ready = undefined; }
