import { createWalletClient, http, keccak256, parseAbi, toBytes, zeroAddress } from "viem";
import type { Account } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { arcTestnet, publicClient } from "../chain/arc.js";
import { config } from "../config/index.js";
import { deriveHotWallet } from "../runners/scout.js";

/// Reusable contest operations (open and fund), shared by the CLI scripts and
/// the autopilot. Pure functions, no top-level side effects.

const erc20 = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
]);
const engineAbi = parseAbi([
  "function listContest(uint8 cType,address protocolTarget,bytes32 metric,uint256 prizePool,uint64 duration,uint16 winnerCutBps,uint16 topN) returns (uint256)",
  "function listingFee() view returns (uint256)",
  "function nextContestId() view returns (uint256)",
]);

const TYPES: Record<string, { index: number; metric: string }> = {
  scout: { index: 0, metric: "VOLUME" },
  analyst: { index: 1, metric: "BRIER" },
  solver: { index: 2, metric: "PUZZLE" },
};

export function coordinatorWallet() {
  if (!config.coordinator.privateKey) throw new Error("COORDINATOR_PRIVATE_KEY required");
  const pk = config.coordinator.privateKey.startsWith("0x")
    ? config.coordinator.privateKey
    : `0x${config.coordinator.privateKey}`;
  return createWalletClient({ account: privateKeyToAccount(pk as `0x${string}`) as Account, chain: arcTestnet, transport: http(config.rpcHttp) });
}

export interface OpenOpts {
  type: string;
  poolUsdc: number;
  durationSeconds: number;
  winnerCutBps?: number;
  topN?: number;
}

/// List and fund a platform contest, leaving it OPEN. Returns its id.
export async function openContest(opts: OpenOpts): Promise<number> {
  const t = TYPES[opts.type.toLowerCase()];
  if (!t) throw new Error(`type must be scout, analyst, or solver (got ${opts.type})`);

  const wallet = coordinatorWallet();
  const engine = config.contracts.ContestEngine;
  const escrow = config.contracts.PrizeEscrow;
  const prizePool = BigInt(Math.round(opts.poolUsdc * 1e6));
  const duration = BigInt(opts.durationSeconds);

  async function send(params: Parameters<typeof wallet.writeContract>[0]) {
    const hash = await wallet.writeContract(params as never);
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  const listingFee = (await publicClient.readContract({ address: engine, abi: engineAbi, functionName: "listingFee" })) as bigint;
  await send({ address: config.external.USDC, abi: erc20, functionName: "approve", args: [escrow, prizePool + listingFee] });
  const contestId = await publicClient.readContract({ address: engine, abi: engineAbi, functionName: "nextContestId" });
  await send({
    address: engine,
    abi: engineAbi,
    functionName: "listContest",
    args: [t.index, zeroAddress, keccak256(toBytes(t.metric)), prizePool, duration, opts.winnerCutBps ?? 6000, opts.topN ?? 3],
  });
  return Number(contestId);
}

/// Top each agent's Scout hot wallet up to `fundUsdc` from the coordinator wallet.
/// Skips wallets that already hold enough. One USDC balance covers gas and transfers on Arc.
export async function fundHotWallets(agentIds: number[], fundUsdc: number): Promise<void> {
  if (agentIds.length === 0) return;
  if (!config.scout.masterMnemonic) throw new Error("SCOUT_MASTER_MNEMONIC required to derive hot wallets");

  const wallet = coordinatorWallet();
  const fund = BigInt(Math.round(fundUsdc * 1e6));
  for (const id of agentIds) {
    const w = deriveHotWallet(id);
    const bal = (await publicClient.readContract({
      address: config.external.USDC,
      abi: erc20,
      functionName: "balanceOf",
      args: [w.address],
    })) as bigint;
    if (bal >= fund) continue;
    const hash = await wallet.writeContract({
      address: config.external.USDC,
      abi: erc20,
      functionName: "transfer",
      args: [w.address, fund],
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }
}
