import { createWalletClient, http, keccak256, parseAbi, toBytes, zeroAddress } from "viem";
import type { Account } from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";

import { arcTestnet, publicClient } from "../chain/arc.js";
import { config } from "../config/index.js";
import { SolverRunner } from "../runners/solver.js";
import type { ContestEntryInput } from "../runners/types.js";
import { merkleRoot, payoutLeaf } from "./merkle.js";
import { computePayouts, computePnlWeightedPayouts, isArcanaResults } from "./payouts.js";

/// Runs one full contest on-chain and broadcasts it to the live panel: open and
/// fund, register agents, score with the Solver, stream standings over the
/// contest window, then settle on-chain and broadcast the real payout. This is
/// the real coordinator flow behind the /live page (v0 self-funds with the
/// coordinator wallet and uses a second hot wallet as a second operator).

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const erc20 = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);
const engineAbi = parseAbi([
  "function listContest(uint8 cType,address protocolTarget,bytes32 metric,uint256 prizePool,uint64 duration,uint16 winnerCutBps,uint16 topN) returns (uint256)",
  "function registerEntry(uint256 contestId,uint256 agentId,uint256 syndicateId)",
  "function postScoreRoot(uint256 contestId,bytes32 root)",
  "function settle(uint256 contestId)",
  "function nextContestId() view returns (uint256)",
]);
const registryAbi = parseAbi([
  "function createAgent(string metadataURI) returns (uint256)",
  "function nextAgentId() view returns (uint256)",
]);

const PRIZE_POOL = 2_000_000n; // 2 USDC
const PLATFORM_FEE_BPS = 500n;
const DURATION = 24n; // seconds

export async function runLiveContest(broadcast: (message: unknown) => void): Promise<void> {
  if (!config.coordinator.privateKey) throw new Error("COORDINATOR_PRIVATE_KEY required to run a contest");
  if (!config.scout.masterMnemonic) throw new Error("SCOUT_MASTER_MNEMONIC required for the second operator");

  const pk = config.coordinator.privateKey.startsWith("0x")
    ? config.coordinator.privateKey
    : `0x${config.coordinator.privateKey}`;
  const coordinator = privateKeyToAccount(pk as `0x${string}`);
  const opB = mnemonicToAccount(config.scout.masterMnemonic, { addressIndex: 1 });

  const cWallet = createWalletClient({ account: coordinator as Account, chain: arcTestnet, transport: http(config.rpcHttp) });
  const bWallet = createWalletClient({ account: opB as Account, chain: arcTestnet, transport: http(config.rpcHttp) });

  const engine = config.contracts.ContestEngine;
  const registry = config.contracts.AgentRegistry;
  const escrow = config.contracts.PrizeEscrow;

  async function send(wallet: typeof cWallet, params: Parameters<typeof cWallet.writeContract>[0]) {
    const hash = await wallet.writeContract(params as never);
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  // 1. Each operator mints an agent.
  const aId = await publicClient.readContract({ address: registry, abi: registryAbi, functionName: "nextAgentId" });
  await send(cWallet, { address: registry, abi: registryAbi, functionName: "createAgent", args: ["ipfs://live/a"] });
  const bId = await publicClient.readContract({ address: registry, abi: registryAbi, functionName: "nextAgentId" });
  await send(bWallet, { address: registry, abi: registryAbi, functionName: "createAgent", args: ["ipfs://live/b"] });

  // 2. Open and fund a Solver contest (cType SOLVER = 2).
  await send(cWallet, { address: config.external.USDC, abi: erc20, functionName: "approve", args: [escrow, PRIZE_POOL] });
  const contestId = await publicClient.readContract({ address: engine, abi: engineAbi, functionName: "nextContestId" });
  const openHash = await send(cWallet, {
    address: engine,
    abi: engineAbi,
    functionName: "listContest",
    args: [2, zeroAddress, keccak256(toBytes("PUZZLE")), PRIZE_POOL, DURATION, 6000, 1],
  });
  const openReceipt = await publicClient.getTransactionReceipt({ hash: openHash });
  const openTs = (await publicClient.getBlock({ blockNumber: openReceipt.blockNumber })).timestamp;
  const endsAtMs = Number(openTs + DURATION) * 1000;
  console.log(`live contest ${contestId} opened on-chain`);

  // 3. Both operators enter.
  await send(cWallet, { address: engine, abi: engineAbi, functionName: "registerEntry", args: [contestId, aId, 0n] });
  await send(bWallet, { address: engine, abi: engineAbi, functionName: "registerEntry", args: [contestId, bId, 0n] });

  // 4. Score with the Solver (final scores).
  const entries: ContestEntryInput[] = [
    { agentId: Number(aId), operator: coordinator.address, tier: 0 },
    { agentId: Number(bId), operator: opB.address, tier: 0 },
  ];
  const results = await new SolverRunner(6).run(Number(contestId), entries);
  const finalScore = new Map(results.map((r) => [r.agentId, r.score]));

  // 5. Stream standings to the live panel as the window elapses.
  const startMs = Date.now();
  const windowMs = Math.max(endsAtMs - startMs, 1);
  while (Date.now() < endsAtMs) {
    const progress = Math.min(1, (Date.now() - startMs) / windowMs);
    const standings = results
      .map((r) => ({
        agentId: r.agentId,
        operator: r.operator,
        score: Math.round((finalScore.get(r.agentId) ?? 0) * (0.3 + 0.7 * progress)),
      }))
      .sort((x, y) => y.score - x.score)
      .map((e, i) => ({ rank: i + 1, ...e }));
    broadcast({ type: "standings", contestId: Number(contestId), endsAt: endsAtMs, entries: standings });
    await sleep(1500);
  }

  // 6. Settle on-chain with a tiered payout merkle root. Arcana-routed
  // Analyst contests use the PnL-weighted split; everything else falls
  // back to the rank-based top-two curve.
  const claimable = PRIZE_POOL - (PRIZE_POOL * PLATFORM_FEE_BPS) / 10_000n;
  const payouts = isArcanaResults(results)
    ? computePnlWeightedPayouts(results, claimable)
    : computePayouts(results, claimable);
  const leaves = payouts.map((p) => payoutLeaf(p.operator, p.amount));
  const root = merkleRoot(leaves);
  await send(cWallet, { address: engine, abi: engineAbi, functionName: "postScoreRoot", args: [contestId, root] });
  await send(cWallet, { address: engine, abi: engineAbi, functionName: "settle", args: [contestId] });
  console.log(`live contest ${contestId} settled on-chain`);

  // 7. Broadcast the real result to the win modal.
  broadcast({
    type: "settled",
    contestId: Number(contestId),
    winners: payouts.map((p, i) => ({ rank: i + 1, operator: p.operator, amount: p.amount.toString() })),
  });
}
