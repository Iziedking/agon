import { query } from "../db/pool.js";
import { config } from "../config/index.js";
import { notify } from "../notifications/index.js";

/// Syndicate war.
///
/// Each ISO-week the coordinator settles a war standing: total
/// contributions per syndicate over the past 7 days, ranked. Members
/// of the top-3 syndicates earn a score multiplier on the current
/// week's contests (1.05 / 1.03 / 1.02 for rank 1 / 2 / 3), so picking
/// a side has a real expected-value effect on payouts.
///
/// On-chain USDC payouts for the war pool require a contract redeploy;
/// until then the war_results table is the source of truth.

const MULTIPLIER_BY_RANK: Record<number, number> = {
  1: 1.05,
  2: 1.03,
  3: 1.02,
};

/// ISO-8601 year-week key ("2026-W22"). Falls back to year-doy/7 when the
/// host environment can't format an ISO week. Pass a Date so callers can
/// settle "the prior week" deterministically.
export function isoWeekId(d: Date = new Date()): string {
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((target.getTime() - firstThursday.getTime()) / 86_400_000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export interface WarStanding {
  syndicateId: number;
  rank: number;
  total: string;
  memberCount: number;
}

/// Compute the standings for a week from raw syndicate_contributions and
/// write a row per syndicate to syndicate_war_results. Idempotent: re-running
/// a settle for the same week overwrites the rows (ON CONFLICT DO UPDATE)
/// so a backfill or a corrected window produces consistent output.
///
/// Window: [windowStart, windowEnd). Default = the prior 7 days ending now.
export async function settleWarWeek(opts: {
  weekId: string;
  windowStart: Date;
  windowEnd: Date;
}): Promise<WarStanding[]> {
  const { weekId, windowStart, windowEnd } = opts;
  const { rows } = await query<{
    syndicate_id: string;
    total: string;
    member_count: string;
  }>(
    `select
       sc.syndicate_id::text  as syndicate_id,
       sum(sc.amount)::text   as total,
       count(distinct sc.member)::text as member_count
     from syndicate_contributions sc
     where sc.recorded_at >= $1 and sc.recorded_at < $2
     group by sc.syndicate_id
     order by sum(sc.amount) desc`,
    [windowStart.toISOString(), windowEnd.toISOString()],
  );
  const standings: WarStanding[] = rows.map((r, i) => ({
    syndicateId: Number(r.syndicate_id),
    rank: i + 1,
    total: r.total,
    memberCount: Number(r.member_count),
  }));
  for (const s of standings) {
    await query(
      `insert into syndicate_war_results (week_id, syndicate_id, rank, total, member_count)
       values ($1, $2, $3, $4, $5)
       on conflict (week_id, syndicate_id)
       do update set rank = excluded.rank, total = excluded.total, member_count = excluded.member_count, settled_at = now()`,
      [weekId, s.syndicateId, s.rank, s.total, s.memberCount],
    );
  }
  console.log(
    `syndicate war ${weekId}: settled ${standings.length} syndicate(s); top 3: ${standings
      .slice(0, 3)
      .map((s) => `#${s.rank} syndicate ${s.syndicateId} (${s.total})`)
      .join(", ") || "none"}`,
  );
  return standings;
}

/// Compute and persist the syndicate reward pool for a closed week. The pool
/// size is config-driven (SYNDICATE_POOL_WEEKLY_USDC); it splits across every
/// member by their contribution share that week. Idempotent: the week row in
/// syndicate_pool_weeks is the guard, so re-running does nothing once a week is
/// split (it never overwrites a share, which could already be claimed). No-op
/// when the pool is unfunded (0) or nobody contributed.
export async function computeSyndicatePool(opts: {
  weekId: string;
  windowStart: Date;
  windowEnd: Date;
}): Promise<{ weekId: string; pool6: bigint; members: number } | null> {
  const { weekId, windowStart, windowEnd } = opts;
  const weeklyUsdc = config.syndicatePoolWeeklyUsdc;
  if (!weeklyUsdc || weeklyUsdc <= 0) return null;

  // Claim the week first; if it already exists, another run already split it.
  const claimWeek = await query(
    "insert into syndicate_pool_weeks (week_id, pool_usdc6) values ($1, $2) on conflict (week_id) do nothing",
    [weekId, Math.round(weeklyUsdc * 1e6)],
  );
  if ((claimWeek.rowCount ?? 0) === 0) return null;

  const pool6 = BigInt(Math.round(weeklyUsdc * 1e6));
  const { rows } = await query<{ member: string; syndicate_id: string; amount: string }>(
    `select sc.member, sc.syndicate_id::text as syndicate_id, sum(sc.amount)::text as amount
       from syndicate_contributions sc
      where sc.recorded_at >= $1 and sc.recorded_at < $2
      group by sc.member, sc.syndicate_id
      order by sum(sc.amount) desc`,
    [windowStart.toISOString(), windowEnd.toISOString()],
  );
  if (rows.length === 0) {
    // Funded pool but no contributions: leave the week row (so we don't retry)
    // with no shares. Nothing to pay out.
    return { weekId, pool6, members: 0 };
  }

  const totals = rows.map((r) => ({ member: r.member.toLowerCase(), synId: Number(r.syndicate_id), amount: BigInt(r.amount) }));
  const grand = totals.reduce((s, t) => s + t.amount, 0n);
  if (grand <= 0n) return { weekId, pool6, members: 0 };

  // Proportional split, largest contributor absorbs the rounding residual so
  // the shares sum to the pool exactly.
  let allocated = 0n;
  const shares = totals.map((t, i) => {
    const share = i === totals.length - 1 ? pool6 - allocated : (pool6 * t.amount) / grand;
    allocated += i === totals.length - 1 ? 0n : share;
    return { ...t, share };
  });

  for (const s of shares) {
    if (s.share <= 0n) continue;
    await query(
      `insert into syndicate_pool_shares (week_id, operator, syndicate_id, share_usdc6)
       values ($1, $2, $3, $4)
       on conflict (week_id, operator) do nothing`,
      [weekId, s.member, s.synId, s.share.toString()],
    );
    void notify(s.member, {
      kind: "syndicate_payout",
      title: "Your syndicate share is ready",
      body: `you earned ${(Number(s.share) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC from the ${weekId} syndicate pool. claim it on your dashboard.`,
      href: "/dashboard",
      context: { weekId, syndicateId: s.synId },
    });
  }
  console.log(`syndicate pool ${weekId}: split ${(Number(pool6) / 1e6).toFixed(2)} USDC across ${shares.length} member(s)`);
  return { weekId, pool6, members: shares.length };
}

/// Cache the most-recent war_results lookup per process tick so a
/// 50-agent contest scoring pass doesn't fire 50 queries to ask the
/// same "what's the latest week's rank for syndicate X" question.
let _cachedSyndicateRanks: { weekId: string | null; map: Map<number, number> } | null = null;
let _cachedAt = 0;
const CACHE_TTL_MS = 30_000;

async function syndicateRankMap(): Promise<Map<number, number>> {
  const now = Date.now();
  if (_cachedSyndicateRanks && now - _cachedAt < CACHE_TTL_MS) {
    return _cachedSyndicateRanks.map;
  }
  const map = new Map<number, number>();
  // Prefer the most recently settled week. If nothing is settled yet
  // (fresh deploy), fall back to ranking syndicates by
  // their cumulative total_reputation so the multiplier is meaningful
  // from the first contest.
  const latest = await query<{ week_id: string }>(
    "select week_id from syndicate_war_results order by week_id desc limit 1",
  );
  const weekId = latest.rows[0]?.week_id ?? null;
  if (weekId) {
    const { rows } = await query<{ syndicate_id: string; rank: string }>(
      "select syndicate_id::text, rank::text from syndicate_war_results where week_id = $1",
      [weekId],
    );
    for (const r of rows) map.set(Number(r.syndicate_id), Number(r.rank));
  } else {
    const { rows } = await query<{ id: string }>(
      `select id::text from syndicates
        where total_reputation > 0
        order by total_reputation desc
        limit 32`,
    );
    rows.forEach((r, i) => map.set(Number(r.id), i + 1));
  }
  _cachedSyndicateRanks = { weekId, map };
  _cachedAt = now;
  return map;
}

/// Multiplier applied to an operator's contest score based on their
/// syndicate's most-recent war rank. Top-3 ranks get a boost; everyone
/// else is 1.0. Operators with no syndicate are 1.0 too.
///
/// Returns a Map keyed by operator address (lowercased), mirroring the
/// trait/training multiplier shape so the scoring path applies them
/// uniformly.
export async function fetchSyndicateMultipliers(
  operators: Array<`0x${string}`>,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (operators.length === 0) return out;
  const lowered = operators.map((o) => o.toLowerCase());
  const rankMap = await syndicateRankMap();
  const { rows } = await query<{ address: string; current_syndicate_id: string | null }>(
    "select address, current_syndicate_id::text from operators where address = any($1::text[])",
    [lowered],
  );
  for (const r of rows) {
    const synId = r.current_syndicate_id ? Number(r.current_syndicate_id) : 0;
    if (!synId) continue;
    const rank = rankMap.get(synId);
    if (!rank) continue;
    const mult = MULTIPLIER_BY_RANK[rank];
    if (mult) out.set(r.address, mult);
  }
  return out;
}

/// Apply the multiplier to a result set in place. Returns a new array
/// so the caller can decide whether to surface the un-boosted scores.
/// Mirrors applyTraitMultipliers / applyTrainingMultipliers in shape.
export function applySyndicateMultipliers<T extends { operator: `0x${string}`; score: number }>(
  results: T[],
  multipliers: Map<string, number>,
): T[] {
  return results.map((r) => {
    const m = multipliers.get(r.operator.toLowerCase());
    return m && m !== 1 ? { ...r, score: r.score * m } : r;
  });
}

/// Background loop: settle the prior ISO-week every hour. Cheap query,
/// idempotent insert. Runs forever; the autopilot spawns it. The hourly
/// cadence is generous (the standings only matter to scoring once per
/// week) but it keeps the read surface fresh for the war board UI
/// without waiting for the next Monday boundary.
export async function startSyndicateWarSettler(): Promise<void> {
  const EVERY_MS = 60 * 60 * 1000;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (;;) {
    try {
      const now = new Date();
      const windowEnd = startOfIsoWeek(now);
      const windowStart = new Date(windowEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
      const priorWeek = isoWeekId(new Date(windowEnd.getTime() - 1));
      await settleWarWeek({ weekId: priorWeek, windowStart, windowEnd });
      // Split the reward pool for the same closed window (no-op when unfunded
      // or already split). Members claim their slice from the dashboard.
      await computeSyndicatePool({ weekId: priorWeek, windowStart, windowEnd });
    } catch (err) {
      console.error(
        "syndicate war settler failed:",
        err instanceof Error ? err.message : err,
      );
    }
    await sleep(EVERY_MS);
  }
}

/// Monday 00:00 UTC of the ISO-week containing `d`.
function startOfIsoWeek(d: Date): Date {
  const day = (d.getUTCDay() + 6) % 7; // 0 = Monday
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return monday;
}
