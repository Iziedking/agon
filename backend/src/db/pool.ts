import pg from "pg";
import { config } from "../config/index.js";

/// uint256 values arrive as decimal strings from viem (bigint -> string). We
/// store them in numeric columns. Tell node-postgres to hand numeric back as a
/// string so we never lose precision to JS floats.
pg.types.setTypeParser(1700, (v) => v); // 1700 = numeric oid

// Agon tables live in their own schema. Keep the legacy ArcRun tables visible
// as a fallback so existing routes continue to resolve against `public`.
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  options: "-c search_path=agon,public",
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params as never);
}
