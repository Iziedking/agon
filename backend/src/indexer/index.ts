import "dotenv/config";
import type { Log } from "viem";
import type { PoolClient } from "pg";

import { config } from "../config/index.js";
import { publicClient } from "../chain/arc.js";
import { pool } from "../db/pool.js";
import {
  agentRegistryEvents,
  challengeArenaEvents,
  contestEngineEvents,
  pointsLedgerEvents,
  prizeEscrowEvents,
  syndicateFactoryEvents,
} from "../chain/abi.js";

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

async function main() {
  const head = await publicClient.getBlockNumber();
  let last = await getLastBlock();
  console.log(`indexer start: head=${head} resumeFrom=${last + 1n} once=${ONCE}`);

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

  await pool.end();
}

main().catch((err) => {
  console.error("indexer failed:", err);
  process.exit(1);
});
