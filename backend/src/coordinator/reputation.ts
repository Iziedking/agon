import { createWalletClient, http, keccak256, parseAbi, toHex } from "viem";
import type { Account } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { arcTestnet, publicClient } from "../chain/arc.js";
import { config } from "../config/index.js";
import { coordinatorWallet } from "./contestOps.js";
import { query } from "../db/pool.js";
import type { AgentResult } from "../runners/types.js";

/// Minimal SyndicateFactory surface for rolling a member's earned reputation
/// into their syndicate's running total. Coordinator-role gated; the contract
/// reverts NotInSyndicate for non-members, so callers pre-filter membership.
const syndicateContribAbi = parseAbi(["function recordContribution(address member, uint128 amount)"]);

/// Step 7: on-settlement reputation and points. In-game reputation deltas go
/// through ContestEngine (coordinator role); Cycles (points) are credited via
/// PointsLedger (coordinator role); ERC-8004 feedback is posted from a separate
/// validator wallet to the Arc ReputationRegistry. All best-effort: a failure
/// here never unwinds an already-settled contest, it only logs.
///
/// Traits roadmap: when an agent places top-N, award a contest-tagged
/// trait via the auth service's agent_traits table (source: 'contest',
/// source_ref: contestId). Then a runner-side multiplier pass reads each
/// entrant's owned traits and nudges their score. Today traits are mystery-only
/// and purely visual; the multiplier hookup is deferred pending a review of
/// its impact on payout fairness.

const engineAbi = parseAbi([
  "function applyReputationDeltas(uint256 contestId, uint256[] agentIds, int128[] deltas)",
]);
const pointsAbi = parseAbi([
  "function credit(address operator, uint128 amount, uint256 contestId, uint8 cType)",
  "function balanceOf(address operator) view returns (uint128)",
]);
const agentRegistryAbi = parseAbi([
  "function getAgent(uint256 agentId) view returns ((address owner,uint16 scoutTier,uint16 analystTier,uint16 solverTier,uint128 reputation,uint64 lastActivityAt,uint64 createdAt,uint256 erc8004TokenId))",
]);
// Verified against the Arc docs ERC-8004 quickstart (ReputationRegistry).
const reputationRegistryAbi = parseAbi([
  "function giveFeedback(uint256 agentId, int128 score, uint8 rating, string tag, string uri1, string uri2, string uri3, bytes32 feedbackHash)",
]);

const REPUTATION_SCALE = 1_000_000n; // AgentRegistry stores reputation at 1e6
const TYPE_NAMES = ["scout", "analyst", "solver"];

/// Rank-based rewards. `rep` is raw reputation points (scaled to 1e6 before
/// sending), `points` is Cycles, `score` is the 0-100 ERC-8004 feedback score.
function rewardForRank(rank: number): { rep: number; points: number; score: number } {
  if (rank === 1) return { rep: 100, points: 50, score: 100 };
  if (rank === 2) return { rep: 60, points: 30, score: 90 };
  if (rank === 3) return { rep: 40, points: 20, score: 80 };
  return { rep: 10, points: 10, score: 60 };
}

function ranked(results: AgentResult[]): { r: AgentResult; rank: number }[] {
  return results
    .slice()
    .sort((a, b) => b.score - a.score)
    .map((r, i) => ({ r, rank: i + 1 }));
}

/// In-game reputation deltas for every scored agent, in one ContestEngine call.
export async function applyReputation(contestId: number, results: AgentResult[]): Promise<void> {
  if (results.length === 0 || !config.coordinator.privateKey) return;
  const standing = ranked(results);
  const agentIds = standing.map((s) => BigInt(s.r.agentId));
  const deltas = standing.map((s) => BigInt(rewardForRank(s.rank).rep) * REPUTATION_SCALE);
  try {
    const wallet = coordinatorWallet();
    const hash = await wallet.writeContract({
      address: config.contracts.ContestEngine,
      abi: engineAbi,
      functionName: "applyReputationDeltas",
      args: [BigInt(contestId), agentIds, deltas],
    } as never);
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`contest ${contestId}: reputation applied to ${agentIds.length} agent(s)`);
  } catch (err) {
    console.error(`contest ${contestId}: applyReputationDeltas failed:`, err instanceof Error ? err.message : err);
  }
}

/// Roll the reputation each operator's agents earned this event into their
/// SYNDICATE's running total (SyndicateFactory.recordContribution). This is what
/// makes the weekly syndicate war real: without it, every syndicate's
/// reputation stays 0, no week ranks, and no cycle pool can be won. Mirrors the
/// per-operator aggregation creditPoints uses. We pre-filter to operators who
/// are actually in a syndicate (via the indexer's operators.current_syndicate_id)
/// so we don't burn gas on the NotInSyndicate revert for the many non-members.
export async function recordSyndicateContributions(
  source: "contest" | "challenge",
  eventId: number,
  results: AgentResult[],
): Promise<void> {
  if (results.length === 0 || !config.coordinator.privateKey) return;

  // Idempotency: claim the event before recording. recordContribution is
  // additive on-chain, so an event must roll in at most once. If the claim
  // finds the row already there (another settlement pass, or a backfill
  // re-run), skip — never double-count.
  try {
    const claim = await query(
      "insert into syndicate_contrib_events (source, event_id) values ($1, $2) on conflict do nothing",
      [source, eventId],
    );
    if (claim.rowCount === 0) return; // already recorded
  } catch (err) {
    console.error(`event ${source} ${eventId}: contribution claim failed:`, err instanceof Error ? err.message : err);
    return;
  }

  const perOp = new Map<string, number>();
  for (const s of ranked(results)) {
    const key = s.r.operator.toLowerCase();
    perOp.set(key, (perOp.get(key) ?? 0) + rewardForRank(s.rank).rep);
  }
  if (perOp.size === 0) return;

  let members: Set<string>;
  try {
    const { rows } = await query<{ address: string }>(
      "select address from operators where current_syndicate_id is not null and address = any($1)",
      [[...perOp.keys()]],
    );
    members = new Set(rows.map((r) => r.address.toLowerCase()));
  } catch (err) {
    console.error(`event ${eventId}: syndicate membership lookup failed:`, err instanceof Error ? err.message : err);
    return;
  }
  if (members.size === 0) return;

  const wallet = coordinatorWallet();
  let recorded = 0;
  let failed = 0;
  for (const [operator, rep] of perOp) {
    if (!members.has(operator) || rep <= 0) continue;
    try {
      const hash = await wallet.writeContract({
        address: config.contracts.SyndicateFactory,
        abi: syndicateContribAbi,
        functionName: "recordContribution",
        // Match the 1e6 reputation scale the rest of the stack stores/displays.
        args: [operator as `0x${string}`, BigInt(rep) * REPUTATION_SCALE],
      } as never);
      await publicClient.waitForTransactionReceipt({ hash });
      recorded++;
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`event ${eventId}: recordContribution → ${operator} failed: ${msg.slice(0, 200)}`);
    }
  }
  console.log(
    `event ${eventId}: syndicate contributions recorded for ${recorded}/${members.size} member operator(s)${failed > 0 ? ` (${failed} failed)` : ""}`,
  );
}

/// Credit Cycles to each operator (deduped across their agents) via PointsLedger.
export async function creditPoints(contestId: number, cType: number, results: AgentResult[]): Promise<void> {
  if (results.length === 0 || !config.coordinator.privateKey) return;
  const perOp = new Map<string, number>();
  for (const s of ranked(results)) {
    const key = s.r.operator.toLowerCase();
    perOp.set(key, (perOp.get(key) ?? 0) + rewardForRank(s.rank).points);
  }
  const wallet = coordinatorWallet();
  let credited = 0;
  let failed = 0;
  // Per-operator try/catch so one revert doesn't poison the rest of the
  // loop. Failure surfaces the actual revert reason so a missing-role
  // setup issue is visible in the logs instead of swallowed silently.
  for (const [operator, pts] of perOp) {
    if (pts <= 0) continue;
    try {
      const hash = await wallet.writeContract({
        address: config.contracts.PointsLedger,
        abi: pointsAbi,
        functionName: "credit",
        args: [operator as `0x${string}`, BigInt(pts), BigInt(contestId), cType],
      } as never);
      await publicClient.waitForTransactionReceipt({ hash });
      credited++;
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `contest/challenge ${contestId}: credit ${pts} cycles → ${operator} failed: ${msg.slice(0, 200)}`,
      );
    }
  }
  console.log(
    `contest/challenge ${contestId}: credited ${credited}/${perOp.size} operator(s)${failed > 0 ? ` (${failed} failed)` : ""}`,
  );
}

/// ERC-8004 feedback from the validator wallet, one call per scored agent.
/// The validator EOA is not the agent NFT owner (the AgentRegistry
/// contract is), so the no-self-feedback rule is satisfied. Opt-in via
/// VALIDATOR_PRIVATE_KEY.
///
/// `source` distinguishes a campaign settlement from a peer-challenge
/// settlement so the on-chain tag is unambiguous (a contest id and a
/// challenge id are different namespaces). Tag shape:
///   contest:   arcrun-{type}-{result}-c{id}
///   challenge: arcrun-{type}-{result}-ch{id}
/// Downstream ERC-8004 readers can filter on the prefix.
export async function postValidatorFeedback(
  source: "contest" | "challenge",
  eventId: number,
  cType: number,
  results: AgentResult[],
): Promise<void> {
  if (results.length === 0) return;
  const pk = config.validator.privateKey;
  if (!pk) return;
  const wallet = createWalletClient({ account: privateKeyToAccount(pk) as Account, chain: arcTestnet, transport: http(config.rpcHttp) });
  const typeName = TYPE_NAMES[cType] ?? String(cType);
  const idPrefix = source === "contest" ? "c" : "ch";
  const label = source === "contest" ? "contest" : "challenge";
  // Prefetch every ranked agent's registry row in one parallel pass (batched),
  // instead of a sequential getAgent read per agent inside the loop. The
  // giveFeedback WRITES below stay sequential: they all sign from the single
  // validator wallet, so they must keep nonce order. A failed read skips that
  // agent (null), same as the old per-iteration catch.
  const rankedResults = ranked(results);
  const agents = await Promise.all(
    rankedResults.map((s) =>
      publicClient
        .readContract({ address: config.contracts.AgentRegistry, abi: agentRegistryAbi, functionName: "getAgent", args: [BigInt(s.r.agentId)] })
        .catch(() => null),
    ),
  );
  let posted = 0;
  for (let i = 0; i < rankedResults.length; i++) {
    const s = rankedResults[i]!;
    const agent = agents[i];
    if (!agent) continue;
    try {
      const tokenId = agent.erc8004TokenId;
      if (tokenId === 0n) continue;
      const result = s.rank === 1 ? "win" : s.rank <= 3 ? "podium" : "ran";
      const tag = `arcrun-${typeName}-${result}-${idPrefix}${eventId}`;
      const feedbackHash = keccak256(toHex(tag));
      const hash = await wallet.writeContract({
        address: config.external.ReputationRegistry,
        abi: reputationRegistryAbi,
        functionName: "giveFeedback",
        args: [tokenId, BigInt(rewardForRank(s.rank).score), 0, tag, "", "", "", feedbackHash],
      } as never);
      await publicClient.waitForTransactionReceipt({ hash });
      posted++;
    } catch (err) {
      console.error(
        `${label} ${eventId}: giveFeedback for agent ${s.r.agentId} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  if (posted > 0) {
    console.log(`${label} ${eventId}: validator posted ERC-8004 feedback for ${posted} agent(s)`);
  }
}

/// Off-chain qualification: drop entrants whose operator holds fewer than
/// QUALIFY_MIN_POINTS Cycles. Default 0 leaves entry open to everyone, matching
/// the contract's documented "qualification enforced off-chain at scoring time".
export async function qualifiedField<T extends { operator: `0x${string}` }>(field: T[]): Promise<T[]> {
  const min = Number(process.env.QUALIFY_MIN_POINTS ?? "0");
  if (min <= 0 || field.length === 0) return field;
  // Read each UNIQUE operator's points balance in one parallel pass (batched)
  // rather than a sequential read per operator. A failed read is treated as 0
  // (does not qualify), matching the prior behavior where a throw aborted scoring.
  const uniqueOps = [...new Set(field.map((e) => e.operator.toLowerCase()))];
  const balList = await Promise.all(
    uniqueOps.map((op) =>
      publicClient
        .readContract({ address: config.contracts.PointsLedger, abi: pointsAbi, functionName: "balanceOf", args: [op as `0x${string}`] })
        .then((b) => b as bigint)
        .catch(() => 0n),
    ),
  );
  const seen = new Map<string, bigint>();
  uniqueOps.forEach((op, i) => seen.set(op, balList[i]!));
  const out: T[] = [];
  for (const e of field) {
    const key = e.operator.toLowerCase();
    const bal = seen.get(key) ?? 0n;
    if (bal >= BigInt(min)) out.push(e);
    else console.log(`contest qualification: ${e.operator} below ${min} Cycles, skipped`);
  }
  return out;
}
