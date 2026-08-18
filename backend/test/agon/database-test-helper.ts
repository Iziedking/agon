import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

if (!TEST_DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL is required for Agon Postgres integration tests");
}

export type AgonTestDatabase = {
  pool: pg.Pool;
  close: () => Promise<void>;
};

export async function createAgonTestDatabase(label: string): Promise<AgonTestDatabase> {
  const suffix = randomUUID().replaceAll("-", "");
  const schema = `agon_${label}_${process.pid}_${suffix}`.toLowerCase();
  if (!/^[a-z0-9_]+$/.test(schema)) {
    throw new Error("generated unsafe test schema name");
  }

  const admin = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
  await admin.query(`create schema "${schema}"`);

  const pool = new pg.Pool({
    connectionString: TEST_DATABASE_URL,
    max: 4,
    options: `-c search_path=${schema}`,
  });
  const schemaSql = await readFile(new URL("../../src/db/schema.sql", import.meta.url), "utf8");
  await pool.query(schemaSql);

  return {
    pool,
    close: async () => {
      await pool.end();
      await admin.query(`drop schema "${schema}" cascade`);
      await admin.end();
    },
  };
}
