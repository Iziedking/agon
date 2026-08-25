import "dotenv/config";
import type { Log } from "viem";
import type { PoolClient } from "pg";
import { parseAbi } from "viem";

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
import { notify, notifyMany } from "../notifications/index.js";

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

const DEFAULT_BATCH_BLOCKS = 1_000n;
const MAX_BATCH_BLOCKS = 5_000n;

function readBatchBlocks(raw: string | undefined): bigint {
  if (!raw?.trim()) return DEFAULT_BATCH_BLOCKS;
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error("INDEXER_BATCH_BLOCKS must be a positive integer");
  }
  const value = BigInt(raw.trim());
  if (value < 1n || value > MAX_BATCH_BLOCKS) {
    throw new Error(`INDEXER_BATCH_BLOCKS must be between 1 and ${MAX_BATCH_BLOCKS}`);
  }
  return value;
}

// Arc's public fallback rejects larger eth_getLogs ranges. Keep the default
// conservative while allowing a dedicated provider to opt into a larger,
// explicitly bounded window.
const BATCH_BLOCKS = readBatchBlocks(process.env.INDEXER_BATCH_BLOCKS);
const POLL_INTERVAL_MS = 3_000;
const ONCE = process.env.INDEXER_ONCE === "1";

function isLogRangeLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /requested range too large|range too large|eth_getLogs.*range/i.test(message);
}

async function indexAdaptiveRange(
  fromBlock: bigint,
  toBlock: bigint,
  index: (from: bigint, to: bigint) => Promise<number>,
  label: string,
): Promise<number> {
  try {
    return await index(fromBlock, toBlock);
  } catch (error) {
    if (!isLogRangeLimitError(error) || fromBlock >= toBlock) throw error;
    const midpoint = fromBlock + (toBlock - fromBlock) / 2n;
    console.warn(`${label}: provider rejected ${fromBlock}-${toBlock}; splitting at ${midpoint}`);
    const left = await indexAdaptiveRange(fromBlock, midpoint, index, label);
    const right = await indexAdaptiveRange(midpoint + 1n, toBlock, index, label);
    return left + right;
  }
}

// Transient RPC failures are the normal weather on a shared testnet endpoint:
// daily quota exhaustion on the dedicated node, then -32011 "request limit
// reached" on the public one it falls back to. Retrying those at the 3s poll
// interval is what turns a blip into a flood, so each consecutive failure
// doubles the wait up to two minutes. A run of successes resets it.
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 120_000;
const backoffFor = (fails: number) =>
  Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(fails - 1, 5));

// Both loops follow the same chain head, and each poll used to be its own
// eth_blockNumber: two calls every 3s is ~58k requests/day before a single log
// range is fetched, which is a large slice of what exhausted the RPC quota in
// the first place. Cache the head for one poll interval so the two loops share
// one read. A stale head only means the next tick picks up the blocks.
let headCache: { value: bigint; atMs: number } | null = null;

async function currentHead(): Promise<bigint> {
  if (headCache && Date.now() - headCache.atMs < POLL_INTERVAL_MS) return headCache.value;
  const value = await publicClient.getBlockNumber();
  headCache = { value, atMs: Date.now() };
  return value;
}

const lc = (v: unknown) => (typeof v === "string" ? v.toLowerCase() : v);
const s = (v: unknown) => (v === undefined || v === null ? null : String(v));

// Minimal ABIs the indexer uses for cross-event reads. Kept local so the
// shared abi.ts stays event-only.
const engineGetContestAbi = parseAbi([
  "function getContest(uint256 contestId) view returns ((uint8 contestType,uint8 status,uint16 winnerCutBps,uint16 topN,uint16 platformFeeBps,address sponsor,address protocolTarget,bytes32 metric,uint64 startTime,uint64 endTime,uint256 prizePool,bytes32 finalRoot))",
]);
const registryGetTierAbi = parseAbi([
  "function getTier(uint256 agentId, uint8 cType) view returns (uint16)",
]);

/// Read the agent's tier for the contest's family from chain. Best-effort:
/// on any RPC failure we leave the row's tier null and the runner will
/// fall back to a live read at preview/settle time. Used only on
/// EntryRegistered so we pay this read once per entry, not every tick.
async function readEntryTier(contestId: bigint, agentId: bigint): Promise<number | null> {
  try {
    const c = await publicClient.readContract({
      address: config.contracts.ContestEngine,
      abi: engineGetContestAbi,
      functionName: "getContest",
      args: [contestId],
    });
    const tier = await publicClient.readContract({
      address: config.contracts.AgentRegistry,
      abi: registryGetTierAbi,
      functionName: "getTier",
      args: [agentId, Number(c.contestType)],
    });
    return Number(tier);
  } catch (err) {
    console.warn(
      `indexer: readEntryTier(${contestId}, ${agentId}) failed: ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }
}

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
    case "EntryRegistered": {
      // Snapshot the agent's tier for this contest's family at entry
      // time. Frozen here so an agent that upgrades mid-window doesn't
      // suddenly score at the new tier, and the runner's hot path reads
      // a column instead of a chain call. Best-effort: null on failure
      // and the runner falls back to live + backfills.
      const tier = await readEntryTier(BigInt(a.contestId as bigint | string), BigInt(a.agentId as bigint | string));
      await client.query(
        `insert into entries (contest_id, agent_id, operator, syndicate_id, tier)
         values ($1, $2, $3, $4, $5)
         on conflict (contest_id, agent_id) do update set tier = coalesce(entries.tier, excluded.tier)`,
        [s(a.contestId), s(a.agentId), lc(a.operator), s(a.syndicateId), tier],
      );
      await client.query(
        "insert into operators (address) values ($1) on conflict (address) do nothing",
        [lc(a.operator)],
      );
      break;
    }
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
    case "ChallengeInvited": {
      await client.query(
        `insert into challenge_invites (challenge_id, invitee)
         values ($1, $2) on conflict do nothing`,
        [s(a.id), lc(a.invitee)],
      );
      // Notify the invitee, unless they are the creator (a creator is
      // auto-invited to their own private challenge and should not get a
      // "you've been invited" line for it).
      const invitee = String(lc(a.invitee));
      const creatorRow = await client.query<{ creator: string }>(
        "select creator from challenges where id = $1",
        [s(a.id)],
      );
      const creator = creatorRow.rows[0]?.creator?.toLowerCase();
      if (creator !== invitee) {
        void notify(invitee, {
          kind: "challenge_invite",
          title: "You were invited to a private challenge",
          body: `challenge #${s(a.id)}. stake in before the join window closes.`,
          href: `/challenges/${s(a.id)}`,
          context: { challengeId: Number(a.id) },
        });
      }
      break;
    }
    case "ChallengeJoined": {
      // Snapshot tier at join time. Look up the challenge's kind from
      // the row the indexer wrote on ChallengeCreated, then map kind →
      // ContestType family via KIND_TO_CTYPE. Same fallback as contest
      // entries: null on RPC failure, runner backfills.
      const kindRow = await client.query<{ kind: number | null }>(
        "select kind from challenges where id = $1",
        [s(a.id)],
      );
      const kind = kindRow.rows[0]?.kind ?? null;
      const KIND_TO_CTYPE: Record<number, number> = { 0: 1, 1: 2, 2: 0, 3: 2 };
      const cType = kind !== null ? KIND_TO_CTYPE[kind] ?? 2 : null;
      let tier: number | null = null;
      if (cType !== null) {
        try {
          tier = Number(
            (await publicClient.readContract({
              address: config.contracts.AgentRegistry,
              abi: registryGetTierAbi,
              functionName: "getTier",
              args: [BigInt(a.agentId as bigint | string), cType],
            })) as number,
          );
        } catch (err) {
          console.warn(
            `indexer: readChallengeTier(${a.id}, ${a.agentId}) failed: ${
              err instanceof Error ? err.message : err
            }`,
          );
        }
      }
      await client.query(
        `insert into challenge_entries (challenge_id, agent_id, operator, tier)
         values ($1, $2, $3, $4)
         on conflict (challenge_id, agent_id) do update set tier = coalesce(challenge_entries.tier, excluded.tier)`,
        [s(a.id), s(a.agentId), lc(a.operator), tier],
      );
      await client.query(
        "insert into operators (address) values ($1) on conflict (address) do nothing",
        [lc(a.operator)],
      );
      break;
    }
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
    case "ChallengeCancelled": {
      // Only the first transition to cancelled notifies, so a replay of the
      // same event can't double-message. rowCount is 0 if it was already
      // cancelled.
      const cancelRes = await client.query(
        "update challenges set status = 'cancelled' where id = $1 and status <> 'cancelled'",
        [s(a.id)],
      );
      if ((cancelRes.rowCount ?? 0) > 0) {
        // Everyone who staked into this challenge can pull their stake back.
        // Tell them so the refund doesn't sit unclaimed on the dashboard.
        const entrants = await client.query<{ operator: string; stake: string | null }>(
          `select distinct ce.operator, c.stake
             from challenge_entries ce
             join challenges c on c.id = ce.challenge_id
            where ce.challenge_id = $1`,
          [s(a.id)],
        );
        if (entrants.rows.length > 0) {
          const stakeRaw = entrants.rows[0]?.stake;
          const stakeLabel = stakeRaw
            ? `${(Number(stakeRaw) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`
            : "your stake";
          void notifyMany(
            entrants.rows.map((r) => r.operator),
            {
              kind: "challenge_refund",
              title: "Challenge cancelled, refund ready",
              body: `challenge #${s(a.id)} was cancelled. pull ${stakeLabel} back from your dashboard.`,
              href: "/dashboard",
              context: { challengeId: Number(a.id) },
            },
          );
        }
      }
      break;
    }

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
      // Per-event row so the weekly war settler can compute time-windowed
      // contributions instead of guessing from the cumulative total.
      // Idempotent on (tx_hash, log_index) so re-indexing the same range
      // doesn't double-count.
      await client.query(
        `insert into syndicate_contributions (syndicate_id, member, amount, tx_hash, block_number, log_index)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (tx_hash, log_index) do nothing`,
        [
          s(a.syndicateId),
          lc(a.member),
          s(a.amount),
          log.transactionHash,
          s(log.blockNumber),
          Number(log.logIndex),
        ],
      );
      break;

    // ----- PrizeEscrow money flow -----
    case "PaidOut":
      // Every USDC outflow from a pool: contest claims, challenge
      // payouts, listing fee to treasury, platform fee skim. We don't
      // classify by reason here; the (controller, pool_id, recipient)
      // tuple is enough to reconcile later. Unique (tx_hash, log_index)
      // keeps this idempotent across indexer restarts.
      await client.query(
        `insert into treasury_flow (controller, pool_id, recipient, amount, tx_hash, block_number, log_index)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (tx_hash, log_index) do nothing`,
        [
          lc(a.controller),
          s(a.poolId),
          lc(a.recipient),
          s(a.amount),
          log.transactionHash,
          s(log.blockNumber),
          Number(log.logIndex),
        ],
      );
      break;

    default:
      // Other events (PrizePoolDeposited, ChallengePotDeposited, etc.)
      // stay in events_log only.
      break;
  }
}

// ---------------------------------------------------------------------------
// Arcana Markets: separate indexing pass. Their contract is external; a hiccup
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
      // markets; a SharesBought event implies the market exists.
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
  let fails = 0;

  for (;;) {
    try {
      const head = await currentHead();
      while (last < head) {
        const from = last + 1n;
        const to = from + BATCH_BLOCKS - 1n > head ? head : from + BATCH_BLOCKS - 1n;
        const count = await indexAdaptiveRange(from, to, indexArcanaRange, "arcana indexer");
        if (count > 0) console.log(`arcana blocks ${from}-${to}: ${count} events`);
        last = to;
      }

      if (Date.now() - lastReconcileMs > ARCANA_RECONCILE_EVERY_MS) {
        await reconcileArcanaMarkets(25);
        lastReconcileMs = Date.now();
      }
      fails = 0;
    } catch (err) {
      // Never let an Arcana failure crash us. Back off rather than retrying at
      // the poll interval: hammering an endpoint that just said "request limit
      // reached" is what produced tens of thousands of identical log lines.
      fails += 1;
      const wait = ONCE ? 0 : backoffFor(fails);
      console.error(
        `arcana indexer error (failure ${fails}, retry in ${wait}ms):`,
        err instanceof Error ? err.message : err,
      );
      if (!ONCE) {
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
    }

    if (ONCE) {
      console.log(`arcana caught up to ${last}`);
      return;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

async function main() {
  const head = await currentHead();
  let last = await getLastBlock();
  console.log(`indexer start: head=${head} resumeFrom=${last + 1n} once=${ONCE}`);

  // Kick off Arcana indexing in parallel. It owns its own cursor + error
  // handling so a partner-contract issue can't stall ArcRun-native indexing.
  const arcanaPromise = arcanaLoop();

  // This loop used to run bare, so one rejected RPC call rejected main() and
  // took the process down with it. Under `restart: unless-stopped` that made a
  // rate-limited endpoint look like a crash loop (989 restarts in 38h) while
  // the real fault was transient. The cursor is committed in the same
  // transaction as the events it covers, so re-running a failed range is
  // idempotent and pausing costs nothing but latency.
  let fails = 0;
  for (;;) {
    try {
      const head = await currentHead();
      while (last < head) {
        const from = last + 1n;
        const to = from + BATCH_BLOCKS - 1n > head ? head : from + BATCH_BLOCKS - 1n;
        const count = await indexAdaptiveRange(from, to, indexRange, "indexer");
        if (count > 0) console.log(`blocks ${from}-${to}: ${count} events`);
        last = to;
      }
      fails = 0;
    } catch (err) {
      // In ONCE mode (tests, backfill) a failure is still fatal: the caller
      // wants a non-zero exit rather than a process that quietly retries.
      if (ONCE) throw err;
      fails += 1;
      const wait = backoffFor(fails);
      console.error(
        `indexer error at block ${last + 1n} (failure ${fails}, retry in ${wait}ms):`,
        err instanceof Error ? err.message : err,
      );
      await new Promise((r) => setTimeout(r, wait));
      continue;
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
