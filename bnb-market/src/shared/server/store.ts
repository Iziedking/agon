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
    CREATE TABLE IF NOT EXISTS bnb_lp_agent_runs (
      id uuid PRIMARY KEY, chain_id integer NOT NULL CHECK (chain_id=97),
      version text NOT NULL, input_json text NOT NULL,
      status text NOT NULL CHECK (status IN ('running','completed','failed')),
      started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
      report_json text, report_hash text, error text,
      CHECK ((status='completed') = (report_json IS NOT NULL AND report_hash IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS bnb_lp_agent_run_started ON bnb_lp_agent_runs(started_at);
    CREATE TABLE IF NOT EXISTS bnb_commerce_intents (
      id uuid PRIMARY KEY, chain_id integer NOT NULL CHECK (chain_id=97),
      buyer_address text NOT NULL, agent_id text NOT NULL, provider_address text NOT NULL,
      service_version text NOT NULL, registration_hash text NOT NULL, input_json text NOT NULL, request_hash text NOT NULL,
      quote_json text, quote_hash text, description text,
      amount_raw text NOT NULL, token_address text NOT NULL,
      quote_expires_at timestamptz, job_expires_at numeric(78,0),
      state text NOT NULL CHECK (state IN ('quoting','quote_verified','open','registered','approved','funded','expired','reverted','needs_attention')),
      job_id text, last_error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS bnb_commerce_intent_buyer ON bnb_commerce_intents(buyer_address,updated_at DESC);
    CREATE INDEX IF NOT EXISTS bnb_commerce_intent_created ON bnb_commerce_intents(created_at);
    CREATE TABLE IF NOT EXISTS bnb_commerce_transactions (
      tx_hash text PRIMARY KEY, intent_id uuid NOT NULL REFERENCES bnb_commerce_intents(id) ON DELETE RESTRICT,
      step text NOT NULL CHECK (step IN ('create','register','approve','fund')),
      status text NOT NULL CHECK (status IN ('submitted','confirming','confirmed','reverted')),
      block_number text, block_hash text, confirmations integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(), checked_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(intent_id,step)
    );
    CREATE INDEX IF NOT EXISTS bnb_commerce_transaction_intent ON bnb_commerce_transactions(intent_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS bnb_commerce_deliveries (
      job_id text PRIMARY KEY, intent_id uuid NOT NULL REFERENCES bnb_commerce_intents(id) ON DELETE RESTRICT,
      status text NOT NULL CHECK (status IN ('working','submitted','failed','needs_attention')),
      attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0 AND attempt_count <= 20),
      manifest_json text, manifest_hash text, deliverable_url text, tx_hash text,
      error text, started_at timestamptz, submitted_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS bnb_commerce_delivery_intent ON bnb_commerce_deliveries(intent_id);
    CREATE INDEX IF NOT EXISTS bnb_commerce_delivery_queue ON bnb_commerce_deliveries(status,updated_at);
  `).then(() => undefined).catch((error: unknown) => { ready = undefined; throw error; });
  await ready; return pool;
}
export async function closeDatabase() { if (pool) await pool.end(); pool = undefined; ready = undefined; }
