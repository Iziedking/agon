import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pool } from "./pool.js";

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
