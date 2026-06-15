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

/// Compute and persist the weekly syndicate reward pool. The pool is a percent
/// of the platform fees collected that week (SYNDICATE_POOL_FEE_PCT), or a fixed
/// amount as a fallback (SYNDICATE_POOL_WEEKLY_USDC). The WINNING syndicate
/// (war rank 1 for the week) takes the whole pool, and its members claim a share
/// weighted by their contribution that week. Idempotent: the week row in
/// syndicate_pool_weeks is the guard, so re-running never re-pays. No-op when the
/// pool is unfunded, no syndicate won, or the winner had no contributions.
export async function computeSyndicatePool(opts: {
  weekId: string;
  windowStart: Date;
  windowEnd: Date;
}): Promise<{ weekId: string; pool6: bigint; members: number } | null> {
  const { weekId, windowStart, windowEnd } = opts;
  const feePct = config.syndicatePoolFeePct;
  const fixedUsdc = config.syndicatePoolWeeklyUsdc;
  if ((!feePct || feePct <= 0) && (!fixedUsdc || fixedUsdc <= 0)) return null;

  // Claim the week first (pool size filled in below); if it already exists,
  // another run already settled it.
  const claimWeek = await query(
    "insert into syndicate_pool_weeks (week_id, pool_usdc6) values ($1, 0) on conflict (week_id) do nothing",
    [weekId],
  );
  if ((claimWeek.rowCount ?? 0) === 0) return null;

  // Pool size: percent of the week's platform fees (preferred), else fixed.
  let pool6: bigint;
  if (feePct && feePct > 0) {
    const feeRow = await query<{ total: string }>(
      `select coalesce(sum((args->>'platformFee')::numeric), 0)::text as total
         from events_log
        where event_name = 'ContestSettled'
          and created_at >= $1 and created_at < $2`,
      [windowStart.toISOString(), windowEnd.toISOString()],
    );
    const fees6 = BigInt((feeRow.rows[0]?.total ?? "0").split(".")[0] ?? "0");
    pool6 = (fees6 * BigInt(Math.round(feePct * 100))) / 10_000n;
  } else {
    pool6 = BigInt(Math.round(fixedUsdc * 1e6));
  }
  await query("update syndicate_pool_weeks set pool_usdc6 = $2 where week_id = $1", [weekId, pool6.toString()]);
  if (pool6 <= 0n) {
    console.log(`syndicate pool ${weekId}: pool is 0 (no fees / unfunded); nothing to split`);
    return { weekId, pool6: 0n, members: 0 };
  }

  // Winning syndicate = war rank 1 for the week (settleWarWeek runs just before
  // this in the settler, ranking syndicates by weekly contribution).
  const winnerRow = await query<{ syndicate_id: string }>(
    "select syndicate_id::text as syndicate_id from syndicate_war_results where week_id = $1 and rank = 1 limit 1",
    [weekId],
  );
  const winningSyn = winnerRow.rows[0]?.syndicate_id ? Number(winnerRow.rows[0].syndicate_id) : null;
  if (!winningSyn) {
    console.log(`syndicate pool ${weekId}: no winning syndicate this week; pool rolls over`);
    return { weekId, pool6, members: 0 };
  }

  // Winning syndicate's members and their contributions that week.
  const { rows } = await query<{ member: string; amount: string }>(
    `select sc.member, sum(sc.amount)::text as amount
       from syndicate_contributions sc
      where sc.syndicate_id = $1
        and sc.recorded_at >= $2 and sc.recorded_at < $3
      group by sc.member
      order by sum(sc.amount) desc`,
    [winningSyn, windowStart.toISOString(), windowEnd.toISOString()],
  );
  if (rows.length === 0) return { weekId, pool6, members: 0 };

  const totals = rows.map((r) => ({ member: r.member.toLowerCase(), amount: BigInt(r.amount) }));
  const grand = totals.reduce((s, t) => s + t.amount, 0n);
  if (grand <= 0n) return { weekId, pool6, members: 0 };

  // Proportional split among the winning syndicate's members; the largest
  // contributor absorbs the rounding residual so shares sum to the pool exactly.
  let allocated = 0n;
  const shares = totals.map((t, i) => {
    const share = i === totals.length - 1 ? pool6 - allocated : (pool6 * t.amount) / grand;
    if (i < totals.length - 1) allocated += share;
    return { ...t, share };
  });

  for (const s of shares) {
    if (s.share <= 0n) continue;
    await query(
      `insert into syndicate_pool_shares (week_id, operator, syndicate_id, share_usdc6)
       values ($1, $2, $3, $4)
       on conflict (week_id, operator) do nothing`,
      [weekId, s.member, winningSyn, s.share.toString()],
    );
    void notify(s.member, {
      kind: "syndicate_payout",
      title: "Your syndicate won the weekly pool",
      body: `your syndicate took the ${weekId} pool. claim ${(Number(s.share) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC on your dashboard.`,
      href: "/dashboard",
      context: { weekId, syndicateId: winningSyn },
    });
  }
  console.log(`syndicate pool ${weekId}: winning syndicate ${winningSyn} splits ${(Number(pool6) / 1e6).toFixed(2)} USDC across ${shares.length} member(s)`);
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

/// Per-member Cycle drop by syndicate war rank. The top four syndicates of the
/// week share the reward, descending, so winning the war funds your members'
/// training. Env-overridable.
const CYCLE_DROP_BY_RANK: Record<number, number> = {
  1: Number(process.env.SYNDICATE_CYCLE_DROP_RANK1 ?? "400"),
  2: Number(process.env.SYNDICATE_CYCLE_DROP_RANK2 ?? "250"),
  3: Number(process.env.SYNDICATE_CYCLE_DROP_RANK3 ?? "150"),
  4: Number(process.env.SYNDICATE_CYCLE_DROP_RANK4 ?? "75"),
};

/// Award Cycles to every member of the top-4 syndicates for a settled week, more
/// for a higher rank. Idempotent per week via syndicate_cycle_drops. Cycles fund
/// training, so this closes the loop: win the war, train your agents faster.
export async function dropSyndicateCycles(weekId: string): Promise<void> {
  const claim = await query(
    "insert into syndicate_cycle_drops (week_id) values ($1) on conflict (week_id) do nothing",
    [weekId],
  );
  if ((claim.rowCount ?? 0) === 0) return; // already dropped this week
  const { rows } = await query<{ syndicate_id: string; rank: number }>(
    "select syndicate_id::text as syndicate_id, rank from syndicate_war_results where week_id = $1 and rank <= 4 order by rank",
    [weekId],
  );
  for (const r of rows) {
    const per = CYCLE_DROP_BY_RANK[r.rank];
    if (!per || per <= 0) continue;
    const upd = await query(
      "update operators set cycles = cycles + $2 where current_syndicate_id = $1",
      [Number(r.syndicate_id), per],
    );
    console.log(
      `syndicate cycle drop ${weekId}: rank ${r.rank} syndicate ${r.syndicate_id} +${per} cycles to ${upd.rowCount ?? 0} member(s)`,
    );
  }
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
      // Weekly Cycle drop to the top-4 syndicates' members (funds training).
      await dropSyndicateCycles(priorWeek);
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
