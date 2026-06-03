import "dotenv/config";
import type { Log } from "viem";
import type { PoolClient } from "pg";

import { config } from "../config/index.js";
import { publicClient } from "../chain/arc.js";
import { pool } from "../db/pool.js";
import {
  agentRegistryEvents,
  arcanaMarketsEvents,
  challengeArenaEvents,
  contestEngineEvents,
  pointsLedgerEvents,
  prizeEscrowEvents,
  syndicateFactoryEvents,
} from "../chain/abi.js";
import { getLatestMarkets, isOpen } from "../lib/arcana.js";
import { pinArcanaMarketsForContest } from "../lib/arcanaPins.js";

/// Polls eth_getLogs over block ranges, writes raw events to events_log, and
/// updates the denormalized read tables. Resumes from the last processed block
/// so a restart never double-applies or skips. Set INDEXER_ONCE=1 to backfill
/// to chain head and exit (used for tests); otherwise it follows head forever.

const ALL_EVENTS = [
  ...contestEngineEvents,
  ...challengeArenaEvents,
  ...agentRegistryEvents,
  ...pointsLedgerEvents,
  ...syndicateFactoryEvents,
  ...prizeEscrowEvents,
];

const ADDRESSES = [
  config.contracts.ContestEngine,
  config.contracts.ChallengeArena,
  config.contracts.AgentRegistry,
  config.contracts.PointsLedger,
  config.contracts.SyndicateFactory,
  config.contracts.PrizeEscrow,
] as `0x${string}`[];

const BATCH_BLOCKS = 5_000n;
const POLL_INTERVAL_MS = 3_000;
const ONCE = process.env.INDEXER_ONCE === "1";

const lc = (v: unknown) => (typeof v === "string" ? v.toLowerCase() : v);
const s = (v: unknown) => (v === undefined || v === null ? null : String(v));

function bigintReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}

async function getLastBlock(): Promise<bigint> {
  const { rows } = await pool.query<{ last_block: string }>(
    "select last_block from indexer_state where id = 1",
  );
  if (rows.length === 0) {
    const start = config.startBlock > 0n ? config.startBlock - 1n : 0n;
    await pool.query("insert into indexer_state (id, last_block) values (1, $1)", [start.toString()]);
    return start;
  }
  return BigInt(rows[0]!.last_block);
}

async function indexRange(fromBlock: bigint, toBlock: bigint): Promise<number> {
  const logs = await publicClient.getLogs({
    address: ADDRESSES,
    events: ALL_EVENTS,
    fromBlock,
    toBlock,
  });

  logs.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return Number(a.blockNumber! - b.blockNumber!);
    return (a.logIndex ?? 0) - (b.logIndex ?? 0);
  });

  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const log of logs) {
      await recordRaw(client, log);
      await applyDenormalized(client, log);
    }
    await client.query("update indexer_state set last_block = $1, updated_at = now() where id = 1", [
      toBlock.toString(),
    ]);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
  return logs.length;
}

type DecodedLog = Log<bigint, number, false> & { eventName: string; args: Record<string, unknown> };

async function recordRaw(client: PoolClient, log: Log) {
  const l = log as DecodedLog;
  await client.query(
    `insert into events_log (block_number, tx_hash, log_index, address, event_name, args)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (tx_hash, log_index) do nothing`,
    [
      s(log.blockNumber),
      log.transactionHash,
      log.logIndex,
      lc(log.address),
      l.eventName,
      JSON.parse(JSON.stringify(l.args, bigintReplacer)),
    ],
  );
}

const TIER_COLUMN = ["scout_tier", "analyst_tier", "solver_tier"] as const;

async function applyDenormalized(client: PoolClient, log: Log) {
  const l = log as DecodedLog;
  const a = l.args;

  switch (l.eventName) {
    // ----- AgentRegistry -----
    case "AgentCreated":
      await client.query(
        `insert into agents (id, owner, erc8004_token_id) values ($1, $2, $3)
         on conflict (id) do update set owner = excluded.owner, erc8004_token_id = excluded.erc8004_token_id`,
        [s(a.agentId), lc(a.owner), s(a.erc8004TokenId)],
      );
      await client.query(
        "insert into operators (address) values ($1) on conflict (address) do nothing",
        [lc(a.owner)],
      );
      break;
    case "AgentUpgraded": {
      const col = TIER_COLUMN[Number(a.cType)] ?? "scout_tier";
      await client.query(`update agents set ${col} = $2 where id = $1`, [s(a.agentId), Number(a.newTier)]);
      break;
    }
    case "ReputationUpdated":
      await client.query("update agents set reputation = $2 where id = $1", [
        s(a.agentId),
        s(a.newReputation),
      ]);
      break;

    // ----- PointsLedger (Cycles) -----
    case "PointsCredited":
      await client.query(
        `insert into operators (address, cycles) values ($1, $2)
         on conflict (address) do update set cycles = operators.cycles + excluded.cycles`,
        [lc(a.operator), s(a.amount)],
      );
      break;
    case "PointsDebited":
      await client.query(
        "update operators set cycles = greatest(cycles - $2, 0) where address = $1",
        [lc(a.operator), s(a.amount)],
      );
      break;

    // ----- ContestEngine -----
    case "ContestListed":
      await client.query(
        `insert into contests (id, sponsor, contest_type, protocol_target, metric, prize_pool, status, created_block)
         values ($1, $2, $3, $4, $5, $6, 'open', $7)
         on conflict (id) do update set sponsor = excluded.sponsor, prize_pool = excluded.prize_pool`,
        [s(a.id), lc(a.sponsor), Number(a.cType), lc(a.protocolTarget), s(a.metric), s(a.prizePool), s(log.blockNumber)],
      );
      break;
    case "EntryRegistered":
      await client.query(
        `insert into entries (contest_id, agent_id, operator, syndicate_id)
         values ($1, $2, $3, $4) on conflict (contest_id, agent_id) do nothing`,
        [s(a.contestId), s(a.agentId), lc(a.operator), s(a.syndicateId)],
      );
      await client.query(
        "insert into operators (address) values ($1) on conflict (address) do nothing",
        [lc(a.operator)],
      );
      break;
    case "ContestScored":
      await client.query("update contests set status = 'scoring', final_root = $2 where id = $1", [
        s(a.contestId),
        s(a.scoreRoot),
      ]);
      break;
    case "ContestSettled":
      await client.query(
        "update contests set status = 'settled', paid_out = $2, platform_fee = $3 where id = $1",
        [s(a.contestId), s(a.paidOut), s(a.platformFee)],
      );
      break;
    case "PrizeClaimed":
      await client.query(
        "update entries set claimed = true, claimed_amount = $3 where contest_id = $1 and operator = $2",
        [s(a.contestId), lc(a.operator), s(a.amount)],
      );
      break;
    case "ContestCancelled":
      await client.query("update contests set status = 'cancelled' where id = $1", [s(a.contestId)]);
      break;

    // ----- ChallengeArena -----
    case "ChallengeCreated":
      await client.query(
        `insert into challenges (id, creator, kind, stake, status) values ($1, $2, $3, $4, 'open')
         on conflict (id) do nothing`,
        [s(a.id), lc(a.creator), Number(a.kind), s(a.stake)],
      );
      // PREDICTION challenges (kind=1) get a pinned Arcana market set just
      // like Analyst contests do, so all entrants see the same menu and
      // the runner is deterministic. Pinning runs inside the same tx so a
      // crash here also rolls back the challenge insert; pin function is
      // idempotent so the autopilot pinning the same id is also safe.
      if (Number(a.kind) === 1) {
        try {
          await pinArcanaMarketsForContest(Number(a.id), 5);
        } catch (err) {
          // Best-effort: if Arcana is empty or RPC hiccups, leave the
          // challenge un-pinned. Runner falls back to "live pool" reads
          // and the challenge still runs.
          console.error(
            `arcana pin failed on ChallengeCreated id=${s(a.id)}: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
      break;
    case "ChallengeInvited":
      await client.query(
        `insert into challenge_invites (challenge_id, invitee)
         values ($1, $2) on conflict do nothing`,
        [s(a.id), lc(a.invitee)],
      );
      break;
    case "ChallengeJoined":
      await client.query(
        `insert into challenge_entries (challenge_id, agent_id, operator)
         values ($1, $2, $3) on conflict (challenge_id, agent_id) do nothing`,
        [s(a.id), s(a.agentId), lc(a.operator)],
      );
      await client.query(
        "insert into operators (address) values ($1) on conflict (address) do nothing",
        [lc(a.operator)],
      );
      break;
    case "ChallengeLocked":
      await client.query("update challenges set status = 'locked', pot = $2, entrants = $3 where id = $1", [
        s(a.id),
        s(a.pot),
        Number(a.entrants),
      ]);
      break;
    case "ChallengeSettled":
      await client.query("update challenges set status = 'settled', winner_root = $2 where id = $1", [
        s(a.id),
        s(a.winnerRoot),
      ]);
      break;
    case "ChallengeCancelled":
      await client.query("update challenges set status = 'cancelled' where id = $1", [s(a.id)]);
      break;

    // ----- SyndicateFactory -----
    case "SyndicateCreated":
      await client.query(
        `insert into syndicates (id, name, founder, is_custom) values ($1, $2, $3, $4)
         on conflict (id) do update set name = excluded.name`,
        [s(a.id), a.name, lc(a.founder), lc(a.founder) !== "0x0000000000000000000000000000000000000000"],
      );
      break;
    case "MemberJoined":
      await client.query("update syndicates set member_count = member_count + 1 where id = $1", [s(a.syndicateId)]);
      await client.query(
        `insert into operators (address, current_syndicate_id) values ($1, $2)
         on conflict (address) do update set current_syndicate_id = excluded.current_syndicate_id`,
        [lc(a.member), s(a.syndicateId)],
      );
      break;
    case "MemberLeft":
      await client.query(
        "update syndicates set member_count = greatest(member_count - 1, 0) where id = $1",
        [s(a.syndicateId)],
      );
      await client.query("update operators set current_syndicate_id = null where address = $1", [lc(a.member)]);
      break;
    case "ContributionRecorded":
      await client.query("update syndicates set total_reputation = total_reputation + $2 where id = $1", [
        s(a.syndicateId),
        s(a.amount),
      ]);
      break;

    default:
      // Other events (PointsCredited, PaidOut, etc.) are kept in events_log only.
      break;
  }
}

// ---------------------------------------------------------------------------
// Arcana Markets — separate indexing pass. Their contract is external; a hiccup
// there should never stall the ArcRun-contracts indexer above. Same polling
// model, separate cursor row in arcana_indexer_state.
// ---------------------------------------------------------------------------

async function getArcanaLastBlock(): Promise<bigint> {
  const { rows } = await pool.query<{ last_block: string }>(
    "select last_block from arcana_indexer_state where id = 1",
  );
  if (rows.length === 0) {
    const start = config.arcana.startBlock > 0n ? config.arcana.startBlock - 1n : 0n;
    await pool.query(
      "insert into arcana_indexer_state (id, last_block) values (1, $1) on conflict (id) do nothing",
      [start.toString()],
    );
    return start;
  }
  return BigInt(rows[0]!.last_block);
}

async function indexArcanaRange(fromBlock: bigint, toBlock: bigint): Promise<number> {
  const logs = await publicClient.getLogs({
    address: config.arcana.address,
    events: arcanaMarketsEvents,
    fromBlock,
    toBlock,
  });

  logs.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return Number(a.blockNumber! - b.blockNumber!);
    return (a.logIndex ?? 0) - (b.logIndex ?? 0);
  });

  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const log of logs) {
      await applyArcanaEvent(client, log);
    }
    await client.query(
      "update arcana_indexer_state set last_block = $1, updated_at = now() where id = 1",
      [toBlock.toString()],
    );
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
  return logs.length;
}

async function applyArcanaEvent(client: PoolClient, log: Log) {
  const l = log as DecodedLog;
  const a = l.args;
  const marketId = s(a.marketId);

  // 1) Record raw event for replay / audit.
  await client.query(
    `insert into arcana_events (block_number, tx_hash, log_index, event_kind, market_id, args)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (tx_hash, log_index) do nothing`,
    [
      s(log.blockNumber),
      log.transactionHash,
      log.logIndex,
      l.eventName,
      marketId,
      JSON.parse(JSON.stringify(l.args, bigintReplacer)),
    ],
  );

  // 2) Project to derived state.
  switch (l.eventName) {
    case "SharesBought": {
      const stakeUsdc = a.usdcAmount as bigint;
      const isYes = a.isYes as boolean;
      const buyer = lc(a.buyer);
      // Increment the relevant pool. The market row is auto-created here so
      // we don't have to wait for the periodic reconcile to discover new
      // markets — a SharesBought event implies the market exists.
      await client.query(
        `insert into arcana_markets (market_id, end_time, yes_pool, no_pool)
         values ($1, to_timestamp(0), $2, $3)
         on conflict (market_id) do update set
           yes_pool = arcana_markets.yes_pool + excluded.yes_pool,
           no_pool  = arcana_markets.no_pool  + excluded.no_pool,
           last_updated = now()`,
        [marketId, isYes ? stakeUsdc.toString() : "0", isYes ? "0" : stakeUsdc.toString()],
      );
      // If a position row exists for this (agent, market, side, tx) that we
      // pre-wrote from the runner, fill in the tx_hash and block_number now.
      // We match on tx_hash equality which the runner set when submitting.
      await client.query(
        `update agent_positions set
           tx_hash = $1,
           block_number = $2,
           shares = $3
         where operator = $4 and market_id = $5 and side = $6 and tx_hash is null and stake_usdc = $7`,
        [log.transactionHash, s(log.blockNumber), s(a.shares), buyer, marketId, isYes ? "yes" : "no", stakeUsdc.toString()],
      );
      break;
    }
    case "MarketResolved": {
      const yesWon = a.yesWon as boolean;
      await client.query(
        `insert into arcana_markets (market_id, end_time, resolved, outcome, resolved_at)
         values ($1, to_timestamp(0), true, $2, now())
         on conflict (market_id) do update set
           resolved = true,
           outcome  = excluded.outcome,
           resolved_at = now(),
           last_updated = now()`,
        [marketId, yesWon],
      );
      // Settle PnL for every position on this market. Winning side: stake
      // multiplied by (winningPool + losingPool) / winningPool, minus stake.
      // Losing side: -stake. We read pools from arcana_markets so it works
      // even if the contract's getMarketOdds isn't queryable post-resolution.
      const { rows: marketRows } = await client.query<{ yes_pool: string; no_pool: string }>(
        "select yes_pool, no_pool from arcana_markets where market_id = $1",
        [marketId],
      );
      const yp = BigInt(marketRows[0]?.yes_pool ?? "0");
      const np = BigInt(marketRows[0]?.no_pool ?? "0");
      const winningPool = yesWon ? yp : np;
      const losingPool = yesWon ? np : yp;
      if (winningPool > 0n) {
        // Winner share scale = (winningPool + losingPool) / winningPool, kept
        // as integer math: payout = stake * (winningPool + losingPool) / winningPool.
        // Losers: pnl = -stake.
        await client.query(
          `update agent_positions set pnl_usdc = case
              when side = $1 then (stake_usdc * $2 / $3) - stake_usdc
              else -stake_usdc
            end
           where market_id = $4`,
          [yesWon ? "yes" : "no", (winningPool + losingPool).toString(), winningPool.toString(), marketId],
        );
      } else {
        // No winners (pool was empty on winning side). Everyone refunds.
        await client.query(
          "update agent_positions set pnl_usdc = 0 where market_id = $1",
          [marketId],
        );
      }
      break;
    }
    case "WinningsClaimed": {
      const claimer = lc(a.claimer);
      await client.query(
        `update agent_positions set claimed = true, claim_tx_hash = $1
         where market_id = $2 and operator = $3 and claimed = false`,
        [log.transactionHash, marketId, claimer],
      );
      break;
    }
  }
}

/// Reconcile arcana_markets with the contract for the latest N markets. Picks
/// up markets created by the Arcana team between event-driven updates (new
/// markets only emit events on the first SharesBought, so we'd miss empty
/// markets if we only listened to events).
async function reconcileArcanaMarkets(n: number = 25) {
  const markets = await getLatestMarkets(n);
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const m of markets) {
      await client.query(
        `insert into arcana_markets
           (market_id, title, category, end_time, yes_pool, no_pool, resolved, cancelled, outcome, last_updated)
         values ($1, $2, $3, to_timestamp($4), $5, $6, $7, $8, null, now())
         on conflict (market_id) do update set
           title = excluded.title,
           category = excluded.category,
           end_time = excluded.end_time,
           yes_pool = excluded.yes_pool,
           no_pool = excluded.no_pool,
           resolved = excluded.resolved,
           cancelled = excluded.cancelled,
           last_updated = now()`,
        [
          s(m.id),
          m.title,
          m.category,
          Number(m.endTime),
          s(m.yesPool),
          s(m.noPool),
          m.resolved,
          m.cancelled,
        ],
      );
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
  // Log a one-liner summary so the operator can see Arcana is live.
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const open = markets.filter((m) => isOpen(m, nowSec)).length;
  console.log(`arcana reconcile: ${markets.length} markets read, ${open} currently open`);
}

// Reconcile runs in the background to pick up new Arcana markets that were
// created without our indexer seeing an event yet. 5 minutes is plenty
// because the event subscription already catches activity in real time;
// reconcile is a safety net for empty markets and resolution backfill.
const ARCANA_RECONCILE_EVERY_MS = 300_000;

async function arcanaLoop() {
  if (!config.arcana.indexing) {
    console.log("arcana indexer disabled (set ARCANA_INDEXING=1 to enable)");
    return;
  }
  console.log(`arcana indexer start: address=${config.arcana.address} startBlock=${config.arcana.startBlock}`);
  let last = await getArcanaLastBlock();
  let lastReconcileMs = 0;

  for (;;) {
    try {
      const currentHead = await publicClient.getBlockNumber();
      while (last < currentHead) {
        const from = last + 1n;
        const to = from + BATCH_BLOCKS - 1n > currentHead ? currentHead : from + BATCH_BLOCKS - 1n;
        const count = await indexArcanaRange(from, to);
        if (count > 0) console.log(`arcana blocks ${from}-${to}: ${count} events`);
        last = to;
      }

      if (Date.now() - lastReconcileMs > ARCANA_RECONCILE_EVERY_MS) {
        await reconcileArcanaMarkets(25);
        lastReconcileMs = Date.now();
      }
    } catch (err) {
      console.error("arcana indexer error:", err instanceof Error ? err.message : err);
      // Fall through to the sleep; never let an Arcana failure crash us.
    }

    if (ONCE) {
      console.log(`arcana caught up to ${last}`);
      return;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

async function main() {
  const head = await publicClient.getBlockNumber();
  let last = await getLastBlock();
  console.log(`indexer start: head=${head} resumeFrom=${last + 1n} once=${ONCE}`);

  // Kick off Arcana indexing in parallel. It owns its own cursor + error
  // handling so a partner-contract issue can't stall ArcRun-native indexing.
  const arcanaPromise = arcanaLoop();

  for (;;) {
    const currentHead = await publicClient.getBlockNumber();
    while (last < currentHead) {
      const from = last + 1n;
      const to = from + BATCH_BLOCKS - 1n > currentHead ? currentHead : from + BATCH_BLOCKS - 1n;
      const count = await indexRange(from, to);
      if (count > 0) console.log(`blocks ${from}-${to}: ${count} events`);
      last = to;
    }

    if (ONCE) {
      console.log(`caught up to ${last}`);
      break;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  await arcanaPromise;
  await pool.end();
}

main().catch((err) => {
  console.error("indexer failed:", err);
  process.exit(1);
});
