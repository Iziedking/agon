import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run migrations");
}

// Migration is a database-only operation. Do not import the full application
// config here: Redis, RPC, and signing credentials are unrelated to applying
// an idempotent SQL schema and may not exist in a migration job.
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });

/// Applies schema.sql. The schema is written with `if not exists`, so this is
/// safe to run repeatedly.
async function migrate() {
  const here = dirname(fileURLToPath(import.meta.url));
  const sql = readFileSync(join(here, "schema.sql"), "utf8");
  await pool.query(sql);
  console.log("migrations applied");
  await pool.end();
}

migrate().catch((err) => {
  console.error("migration failed:", err);
  process.exit(1);
});
