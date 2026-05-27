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
import { applyReputation, creditPoints, postValidatorFeedback, qualifiedField } from "./reputation.js";
import { merkleRoot, payoutLeaf } from "./merkle.js";
import { computePayouts } from "./payouts.js";
import { applyTraitMultipliers, awardPlacementTraits, fetchAgentMultipliers } from "./traits.js";
import {
  applyTrainingMultipliers,
  clampCombinedMultiplier,
  fetchTrainingMultipliers,
  flushTrainingQueue,
} from "./training.js";

/// Step 3 and 4 of the multi-user loop: take a real, open contest, assemble the
/// field of every operator who entered (from the indexer's entries table, with
/// each agent's tier read from AgentRegistry), stream standings over the window,
/// then run the right runner over the whole field and settle on-chain. This is
/// the generic engine that replaces the two-agent runContest demo.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const engineAbi = parseAbi([
  "function getContest(uint256 contestId) view returns ((uint8 contestType,uint8 status,uint16 winnerCutBps,uint16 topN,uint16 platformFeeBps,address sponsor,address protocolTarget,bytes32 metric,uint64 startTime,uint64 endTime,uint256 prizePool,bytes32 finalRoot))",
  "function postScoreRoot(uint256 contestId,bytes32 root)",
  "function settle(uint256 contestId)",
  "function cancelContest(uint256 contestId)",
]);
const registryAbi = parseAbi(["function getTier(uint256 agentId, uint8 cType) view returns (uint16)"]);

function coordinatorWallet() {
  if (!config.coordinator.privateKey) throw new Error("COORDINATOR_PRIVATE_KEY required to settle");
  const pk = config.coordinator.privateKey.startsWith("0x")
    ? config.coordinator.privateKey
    : `0x${config.coordinator.privateKey}`;
  const account = privateKeyToAccount(pk as `0x${string}`);
  return createWalletClient({ account: account as Account, chain: arcTestnet, transport: http(config.rpcHttp) });
}

/// The real field: every entered agent and its tier for this contest's family.
/// Entries come from the indexer's `entries` table, so the indexer must be running.
async function fetchField(contestId: number, cType: number): Promise<ContestEntryInput[]> {
  const { rows } = await query<{ agent_id: string; operator: string }>(
    "select agent_id, operator from entries where contest_id = $1 order by agent_id",
    [contestId],
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

/// Live preview while the window is open. Solver and Analyst are pure, so we run
/// them for real; Scout does real on-chain ops, so its live view is a pure
/// tier-based proxy and the real volume run happens once at settlement.
async function previewScores(cType: number, contestId: number, field: ContestEntryInput[]): Promise<AgentResult[]> {
  if (cType === 1) return new AnalystRunner().run(contestId, field);
  if (cType === 2) return new SolverRunner(6).run(contestId, field);
  return field.map((e) => ({ agentId: e.agentId, operator: e.operator, score: (e.tier + 1) * 100, detail: {} }));
}

/// Authoritative scoring at settlement.
async function finalScores(cType: number, contestId: number, field: ContestEntryInput[]): Promise<AgentResult[]> {
  if (cType === 0) return new ScoutRunner(5).run(contestId, field);
  if (cType === 1) return new AnalystRunner().run(contestId, field);
  return new SolverRunner(6).run(contestId, field);
}

function standings(results: AgentResult[]) {
  return results
    .slice()
    .sort((a, b) => b.score - a.score)
    .map((r, i) => ({
      rank: i + 1,
      agentId: r.agentId,
      operator: r.operator,
      score: Math.round(r.score),
      // Carry the runner's progress through to the wire so the frontend stage
      // renders real per-agent state (solver cells, analyst calls, scout tx
      // hashes) instead of deriving visible state from the score.
      progress: r.progress,
    }));
}

export async function runContestById(contestId: number, broadcast: (message: unknown) => void): Promise<void> {
  const engine = config.contracts.ContestEngine;
  const c = await publicClient.readContract({
    address: engine,
    abi: engineAbi,
    functionName: "getContest",
    args: [BigInt(contestId)],
  });
  if (c.sponsor === zeroAddress) {
    console.log(`contest ${contestId} does not exist`);
    return;
  }
  if (Number(c.status) !== 1) {
    console.log(`contest ${contestId} is not OPEN (status ${Number(c.status)}); nothing to run`);
    return;
  }

  const cType = Number(c.contestType);
  const endsAtMs = Number(c.endTime) * 1000;
  console.log(`running contest ${contestId} (type ${cType}); entries close at ${new Date(endsAtMs).toISOString()}`);

  // Stream standings of the real field while the entry window is open. Each
  // frame applies trait + training multipliers so the live race visibly
  // reflects everything the agent brings to the table. Combined multiplier
  // is capped at 3.5x (MAX_COMBINED_MULTIPLIER).
  while (Date.now() < endsAtMs) {
    const field = await fetchField(contestId, cType);
    const ids = field.map((e) => e.agentId);
    // Promote any expired training queue rows before reading multipliers.
    await flushTrainingQueue().catch(() => 0);
    const preview = field.length > 0 ? await previewScores(cType, contestId, field) : [];
    const baselines = new Map(preview.map((r) => [r.agentId, r.score] as const));
    const [traitMult, trainMult] = await Promise.all([
      fetchAgentMultipliers(ids),
      fetchTrainingMultipliers(ids),
    ]);
    const withTraits = applyTraitMultipliers(preview, traitMult);
    const withTraining = applyTrainingMultipliers(withTraits, trainMult);
    const boosted = clampCombinedMultiplier(withTraining, baselines);
    broadcast({ type: "standings", contestId, endsAt: endsAtMs, entries: standings(boosted) });
    await sleep(2500);
  }

  // Window closed. Wait a beat so chain time is past endTime, then settle.
  await sleep(3000);

  let field = await fetchField(contestId, cType);

  // Off-chain qualification gate (no-op unless QUALIFY_MIN_POINTS is set).
  field = await qualifiedField(field);

  // Scout scoring runs real on-chain operations from each agent's hot wallet, so
  // those wallets need USDC first. Top them up from the coordinator wallet (one
  // Arc USDC balance covers gas and transfers). Pure contests skip this.
  if (cType === 0 && field.length > 0 && config.scout.masterMnemonic && config.coordinator.privateKey) {
    const fundUsdc = Number(process.env.SCOUT_FUND_USDC ?? "1");
    console.log(`contest ${contestId}: topping up ${field.length} Scout hot wallet(s) to ${fundUsdc} USDC`);
    await fundHotWallets(field.map((e) => e.agentId), fundUsdc);
  }

  const baseResults = await finalScores(cType, contestId, field);
  // Authoritative scoring picks up trait + training multipliers so the
  // on-chain payout reflects the same boosts viewers saw on the live race.
  // Combined multiplier capped at 3.5x.
  await flushTrainingQueue().catch(() => 0);
  const ids = field.map((e) => e.agentId);
  const baselines = new Map(baseResults.map((r) => [r.agentId, r.score] as const));
  const [traitMult, trainMult] = await Promise.all([
    fetchAgentMultipliers(ids),
    fetchTrainingMultipliers(ids),
  ]);
  const withTraits = applyTraitMultipliers(baseResults, traitMult);
  const withTraining = applyTrainingMultipliers(withTraits, trainMult);
  const results = clampCombinedMultiplier(withTraining, baselines);

  // One final standings frame with the authoritative progress, so Scout's real
  // tx hashes land on the live stage just before the settled banner takes
  // over. Analyst/Solver progress is deterministic per agent, so this frame
  // just confirms what viewers already saw.
  broadcast({ type: "standings", contestId, endsAt: endsAtMs, entries: standings(results) });

  const platformFee = (c.prizePool * BigInt(c.platformFeeBps)) / 10_000n;
  const claimable = c.prizePool - platformFee;
  const payouts = computePayouts(results, claimable);

  // Persist the payout tree (in leaf order) so the claim-proof endpoint can
  // rebuild the exact tree and serve each winner their proof.
  for (let i = 0; i < payouts.length; i++) {
    await query(
      "insert into payouts (contest_id, rank, operator, amount) values ($1, $2, $3, $4) on conflict (contest_id, rank) do nothing",
      [contestId, i + 1, payouts[i]!.operator.toLowerCase(), payouts[i]!.amount.toString()],
    );
  }

  const wallet = coordinatorWallet();
  async function send(params: Parameters<typeof wallet.writeContract>[0]) {
    const hash = await wallet.writeContract(params as never);
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  if (payouts.length === 0) {
    console.log(`contest ${contestId}: no scoring entrants; cancelling and refunding the sponsor`);
    await send({ address: engine, abi: engineAbi, functionName: "cancelContest", args: [BigInt(contestId)] });
    broadcast({ type: "settled", contestId, winners: [] });
    return;
  }

  const root = merkleRoot(payouts.map((p) => payoutLeaf(p.operator, p.amount)));
  await send({ address: engine, abi: engineAbi, functionName: "postScoreRoot", args: [BigInt(contestId), root] });
  await send({ address: engine, abi: engineAbi, functionName: "settle", args: [BigInt(contestId)] });
  console.log(`contest ${contestId} settled on-chain with ${payouts.length} winner(s)`);

  broadcast({
    type: "settled",
    contestId,
    winners: payouts.map((p, i) => ({ rank: i + 1, operator: p.operator, amount: p.amount.toString() })),
  });

  // Post-settlement rewards (best-effort, each logs on failure):
  // in-game reputation, Cycles, ERC-8004 validator feedback, and one
  // placement-tagged trait per top-3 finisher.
  await applyReputation(contestId, results);
  await creditPoints(contestId, cType, results);
  await postValidatorFeedback(contestId, cType, results);
  await awardPlacementTraits("contest", contestId, results).catch((err) =>
    console.error(`contest ${contestId}: placement trait awards failed:`, err instanceof Error ? err.message : err),
  );
}
