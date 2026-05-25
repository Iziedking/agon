import { createWalletClient, http, parseAbi, zeroAddress } from "viem";
import type { Account } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { arcTestnet, publicClient } from "../chain/arc.js";
import { config } from "../config/index.js";
import { query } from "../db/pool.js";
import { AnalystRunner } from "../runners/analyst.js";
import { ScoutRunner } from "../runners/scout.js";
import { SolverRunner } from "../runners/solver.js";
import type { AgentResult, ContestEntryInput } from "../runners/types.js";
import { fundHotWallets } from "./contestOps.js";
import { merkleRoot, payoutLeaf } from "./merkle.js";
import { computePayouts } from "./payouts.js";

/// Peer-challenge counterpart to runContestById. Locks a full or expired
/// challenge, scores its entrants with the runner matching the challenge kind,
/// posts the winner root, and persists payouts for claim proofs. Underfilled or
/// stale challenges are cancelled so entrants can refund. Coordinator-role only.

const arenaAbi = parseAbi([
  "function getChallenge(uint256 id) view returns ((address creator,uint8 kind,uint8 status,bool isPrivate,uint16 platformFeeBps,uint128 stake,uint64 maxEntrants,uint64 joinDeadline,uint64 resolveDeadline,bytes32 winnerRoot))",
  "function entrantCount(uint256 id) view returns (uint64)",
  "function nextChallengeId() view returns (uint256)",
  "function lockChallenge(uint256 id)",
  "function postWinnerRoot(uint256 id, bytes32 root)",
  "function cancelChallenge(uint256 id)",
]);
const registryAbi = parseAbi(["function getTier(uint256 agentId, uint8 cType) view returns (uint16)"]);

// ChallengeKind to ContestType family, for tier reads and the runner choice.
// PREDICTION to ANALYST, PUZZLE to SOLVER, VOLUME to SCOUT, CUSTOM to SOLVER.
const KIND_TO_CTYPE = [1, 2, 0, 2];

function coordinatorWallet() {
  if (!config.coordinator.privateKey) throw new Error("COORDINATOR_PRIVATE_KEY required to resolve challenges");
  const pk = config.coordinator.privateKey.startsWith("0x")
    ? config.coordinator.privateKey
    : `0x${config.coordinator.privateKey}`;
  return createWalletClient({ account: privateKeyToAccount(pk as `0x${string}`) as Account, chain: arcTestnet, transport: http(config.rpcHttp) });
}

async function fetchField(challengeId: number, cType: number): Promise<ContestEntryInput[]> {
  const { rows } = await query<{ agent_id: string; operator: string }>(
    "select agent_id, operator from challenge_entries where challenge_id = $1 order by agent_id",
    [challengeId],
  );
  const field: ContestEntryInput[] = [];
  for (const r of rows) {
    const tier = (await publicClient.readContract({
      address: config.contracts.AgentRegistry,
      abi: registryAbi,
      functionName: "getTier",
      args: [BigInt(r.agent_id), cType],
    })) as number;
    field.push({ agentId: Number(r.agent_id), operator: r.operator as `0x${string}`, tier: Number(tier) });
  }
  return field;
}

async function scoreField(cType: number, challengeId: number, field: ContestEntryInput[]): Promise<AgentResult[]> {
  if (cType === 0) return new ScoutRunner(5).run(challengeId, field);
  if (cType === 1) return new AnalystRunner().run(challengeId, field);
  return new SolverRunner(6).run(challengeId, field);
}

/// OPEN or LOCKED challenges, newest-first scan. The resolver decides per id
/// whether to lock, resolve, cancel, or wait.
export async function findActiveChallenges(lookback = 100): Promise<number[]> {
  const arena = config.contracts.ChallengeArena;
  const next = (await publicClient.readContract({ address: arena, abi: arenaAbi, functionName: "nextChallengeId" })) as bigint;
  const latest = Number(next) - 1;
  const floor = Math.max(0, latest - lookback + 1);
  const active: number[] = [];
  for (let id = latest; id >= floor; id--) {
    const ch = await publicClient.readContract({ address: arena, abi: arenaAbi, functionName: "getChallenge", args: [BigInt(id)] });
    const status = Number(ch.status);
    if (ch.creator !== zeroAddress && (status === 0 || status === 1)) active.push(id);
  }
  return active.reverse();
}

export async function resolveChallengeById(challengeId: number, broadcast: (message: unknown) => void): Promise<void> {
  const arena = config.contracts.ChallengeArena;
  const ch = await publicClient.readContract({ address: arena, abi: arenaAbi, functionName: "getChallenge", args: [BigInt(challengeId)] });
  if (ch.creator === zeroAddress) return;

  let status = Number(ch.status);
  if (status === 2 || status === 3) return; // already settled or cancelled

  const nowSec = Math.floor(Date.now() / 1000);
  const cType = KIND_TO_CTYPE[Number(ch.kind)] ?? 2;
  const entrants = Number(
    (await publicClient.readContract({ address: arena, abi: arenaAbi, functionName: "entrantCount", args: [BigInt(challengeId)] })) as bigint,
  );

  const wallet = coordinatorWallet();
  async function send(params: Parameters<typeof wallet.writeContract>[0]) {
    const hash = await wallet.writeContract(params as never);
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }
  async function cancel(reason: string) {
    console.log(`challenge ${challengeId}: ${reason}; cancelling so entrants refund`);
    await send({ address: arena, abi: arenaAbi, functionName: "cancelChallenge", args: [BigInt(challengeId)] });
    broadcast({ type: "challenge_settled", challengeId, winners: [] });
  }

  if (status === 0) {
    // OPEN: lock once full or the join window has closed, with 2+ entrants.
    const full = entrants >= Number(ch.maxEntrants);
    const joinEnded = nowSec >= Number(ch.joinDeadline);
    if (!full && !joinEnded) return; // still filling
    if (entrants < 2) {
      await cancel(`underfilled (${entrants} entrants)`);
      return;
    }
    console.log(`challenge ${challengeId}: locking with ${entrants} entrants`);
    await send({ address: arena, abi: arenaAbi, functionName: "lockChallenge", args: [BigInt(challengeId)] });
    status = 1;
  }

  if (status === 1) {
    // LOCKED: resolve before the deadline, else cancel for refunds.
    if (nowSec > Number(ch.resolveDeadline)) {
      await cancel("resolve window missed");
      return;
    }

    const field = await fetchField(challengeId, cType);
    if (cType === 0 && field.length > 0 && config.scout.masterMnemonic && config.coordinator.privateKey) {
      await fundHotWallets(field.map((e) => e.agentId), Number(process.env.SCOUT_FUND_USDC ?? "1"));
    }
    const results = await scoreField(cType, challengeId, field);

    const pot = ch.stake * BigInt(entrants);
    const fee = (pot * BigInt(ch.platformFeeBps)) / 10_000n;
    const payouts = computePayouts(results, pot - fee);
    if (payouts.length === 0) {
      // A LOCKED challenge can only be cancelled after its resolve deadline, so
      // don't cancel here. Leave it; if it never scores, the deadline path above
      // cancels it on a later sweep and entrants refund.
      console.log(`challenge ${challengeId}: no scoring entrants yet; will retry until resolve deadline`);
      return;
    }

    for (let i = 0; i < payouts.length; i++) {
      await query(
        "insert into challenge_payouts (challenge_id, rank, operator, amount) values ($1, $2, $3, $4) on conflict (challenge_id, rank) do nothing",
        [challengeId, i + 1, payouts[i]!.operator.toLowerCase(), payouts[i]!.amount.toString()],
      );
    }

    const root = merkleRoot(payouts.map((p) => payoutLeaf(p.operator, p.amount)));
    await send({ address: arena, abi: arenaAbi, functionName: "postWinnerRoot", args: [BigInt(challengeId), root] });
    console.log(`challenge ${challengeId} resolved with ${payouts.length} winner(s)`);
    broadcast({
      type: "challenge_settled",
      challengeId,
      winners: payouts.map((p, i) => ({ rank: i + 1, operator: p.operator, amount: p.amount.toString() })),
    });
  }
}
