import { pool, query } from "../db/pool.js";

/// Per-contest market pinning. The coordinator calls pinArcanaMarketsForContest
/// once at contest open; the analyst runner reads via fetchPinnedArcanaMarkets
/// inside every standings pass. Single source of truth so all agents in the
/// round see the same menu and reload-resilient because the pin survives a
/// coordinator restart.

export interface PinnedArcanaMarket {
  marketId: bigint;
  title: string;
  category: string;
  endTime: bigint;
  entryYesPool: bigint;
  entryNoPool: bigint;
}

/// How far in the future a market must resolve to qualify for pinning to
/// the contest. Mirrors the runner's old inline window so behavior is the
/// same whether pinning is on or off.
const RESOLUTION_WINDOW_SEC = 60 * 60 * 24 * 7;

/// Pick N open Arcana markets and persist them as the contest's pinned set.
/// Idempotent: if pins already exist for the contest, returns them
/// untouched. Picks markets resolving inside the window, ordered by
/// soonest-resolves-first so faster contests get faster-settling markets.
export async function pinArcanaMarketsForContest(
  contestId: number,
  count: number,
): Promise<PinnedArcanaMarket[]> {
  const existing = await fetchPinnedArcanaMarkets(contestId);
  if (existing.length > 0) return existing;

  const { rows } = await query<{
    market_id: string;
    title: string;
    category: string;
    end_time: string;
    yes_pool: string;
    no_pool: string;
  }>(
    `select market_id, title, category,
            extract(epoch from end_time)::bigint::text as end_time,
            yes_pool, no_pool
       from arcana_markets
      where resolved = false
        and cancelled = false
        and end_time > now()
        and end_time < now() + interval '${RESOLUTION_WINDOW_SEC} seconds'
      order by end_time asc
      limit $1`,
    [count],
  );

  if (rows.length === 0) return [];

  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const r of rows) {
      await client.query(
        `insert into contest_arcana_markets
           (contest_id, market_id, title, category, end_time, entry_yes_pool, entry_no_pool)
         values ($1, $2, $3, $4, to_timestamp($5), $6, $7)
         on conflict (contest_id, market_id) do nothing`,
        [contestId, r.market_id, r.title, r.category, Number(r.end_time), r.yes_pool, r.no_pool],
      );
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }

  return rows.map((r) => ({
    marketId: BigInt(r.market_id),
    title: r.title,
    category: r.category,
    endTime: BigInt(r.end_time),
    entryYesPool: BigInt(r.yes_pool),
    entryNoPool: BigInt(r.no_pool),
  }));
}

/// Returns the pinned market set for a contest, or empty if nothing pinned.
export async function fetchPinnedArcanaMarkets(
  contestId: number,
): Promise<PinnedArcanaMarket[]> {
  const { rows } = await query<{
    market_id: string;
    title: string;
    category: string;
    end_time: string;
    entry_yes_pool: string;
    entry_no_pool: string;
  }>(
    `select market_id, title, category,
            extract(epoch from end_time)::bigint::text as end_time,
            entry_yes_pool, entry_no_pool
       from contest_arcana_markets
      where contest_id = $1
      order by market_id asc`,
    [contestId],
  );
  return rows.map((r) => ({
    marketId: BigInt(r.market_id),
    title: r.title,
    category: r.category,
    endTime: BigInt(r.end_time),
    entryYesPool: BigInt(r.entry_yes_pool),
    entryNoPool: BigInt(r.entry_no_pool),
  }));
}
