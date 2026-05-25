import { createWalletClient, http, keccak256, parseAbi, toHex } from "viem";
import type { Account } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { arcTestnet, publicClient } from "../chain/arc.js";
import { config } from "../config/index.js";
import { coordinatorWallet } from "./contestOps.js";
import type { AgentResult } from "../runners/types.js";

/// Step 7: on-settlement reputation and points. In-game reputation deltas go
/// through ContestEngine (coordinator role); Cycles (points) are credited via
/// PointsLedger (coordinator role); ERC-8004 feedback is posted from a separate
/// validator wallet to the Arc ReputationRegistry. All best-effort: a failure
/// here never unwinds an already-settled contest, it only logs.

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

/// Credit Cycles to each operator (deduped across their agents) via PointsLedger.
export async function creditPoints(contestId: number, cType: number, results: AgentResult[]): Promise<void> {
  if (results.length === 0 || !config.coordinator.privateKey) return;
  const perOp = new Map<string, number>();
  for (const s of ranked(results)) {
    const key = s.r.operator.toLowerCase();
    perOp.set(key, (perOp.get(key) ?? 0) + rewardForRank(s.rank).points);
  }
  try {
    const wallet = coordinatorWallet();
    for (const [operator, pts] of perOp) {
      if (pts <= 0) continue;
      const hash = await wallet.writeContract({
        address: config.contracts.PointsLedger,
        abi: pointsAbi,
        functionName: "credit",
        args: [operator as `0x${string}`, BigInt(pts), BigInt(contestId), cType],
      } as never);
      await publicClient.waitForTransactionReceipt({ hash });
    }
    console.log(`contest ${contestId}: credited Cycles to ${perOp.size} operator(s)`);
  } catch (err) {
    console.error(`contest ${contestId}: credit points failed:`, err instanceof Error ? err.message : err);
  }
}

/// ERC-8004 feedback from the validator wallet, one call per scored agent. The
/// validator EOA is not the agent NFT owner (the AgentRegistry contract is), so
/// the no-self-feedback rule is satisfied. Opt-in via VALIDATOR_PRIVATE_KEY.
export async function postValidatorFeedback(contestId: number, cType: number, results: AgentResult[]): Promise<void> {
  if (results.length === 0) return;
  const pk = config.validator.privateKey;
  if (!pk) return;
  const wallet = createWalletClient({ account: privateKeyToAccount(pk) as Account, chain: arcTestnet, transport: http(config.rpcHttp) });
  const typeName = TYPE_NAMES[cType] ?? String(cType);
  let posted = 0;
  for (const s of ranked(results)) {
    try {
      const agent = await publicClient.readContract({
        address: config.contracts.AgentRegistry,
        abi: agentRegistryAbi,
        functionName: "getAgent",
        args: [BigInt(s.r.agentId)],
      });
      const tokenId = agent.erc8004TokenId;
      if (tokenId === 0n) continue;
      const result = s.rank === 1 ? "win" : s.rank <= 3 ? "podium" : "ran";
      const tag = `arcrun-${typeName}-${result}-c${contestId}`;
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
      console.error(`contest ${contestId}: giveFeedback for agent ${s.r.agentId} failed:`, err instanceof Error ? err.message : err);
    }
  }
  if (posted > 0) console.log(`contest ${contestId}: validator posted ERC-8004 feedback for ${posted} agent(s)`);
}

/// Off-chain qualification: drop entrants whose operator holds fewer than
/// QUALIFY_MIN_POINTS Cycles. Default 0 leaves entry open to everyone, matching
/// the contract's documented "qualification enforced off-chain at scoring time".
export async function qualifiedField<T extends { operator: `0x${string}` }>(field: T[]): Promise<T[]> {
  const min = Number(process.env.QUALIFY_MIN_POINTS ?? "0");
  if (min <= 0 || field.length === 0) return field;
  const seen = new Map<string, bigint>();
  const out: T[] = [];
  for (const e of field) {
    const key = e.operator.toLowerCase();
    let bal = seen.get(key);
    if (bal === undefined) {
      bal = (await publicClient.readContract({
        address: config.contracts.PointsLedger,
        abi: pointsAbi,
        functionName: "balanceOf",
        args: [e.operator],
      })) as bigint;
      seen.set(key, bal);
    }
    if (bal >= BigInt(min)) out.push(e);
    else console.log(`contest qualification: ${e.operator} below ${min} Cycles, skipped`);
  }
  return out;
}
