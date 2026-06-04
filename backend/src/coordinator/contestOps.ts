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
  "function getContest(uint256 contestId) view returns ((uint8 contestType,uint8 status,uint16 winnerCutBps,uint16 topN,uint16 platformFeeBps,address sponsor,address protocolTarget,bytes32 metric,uint64 startTime,uint64 endTime,uint256 prizePool,bytes32 finalRoot))",
]);

const TYPES: Record<string, { index: number; metric: string }> = {
  scout: { index: 0, metric: "VOLUME" },
  analyst: { index: 1, metric: "BRIER" },
  solver: { index: 2, metric: "PUZZLE" },
};

function coordinatorPk(): `0x${string}` {
  if (!config.coordinator.privateKey) throw new Error("COORDINATOR_PRIVATE_KEY required");
  return (config.coordinator.privateKey.startsWith("0x")
    ? config.coordinator.privateKey
    : `0x${config.coordinator.privateKey}`) as `0x${string}`;
}

export function coordinatorWallet() {
  return createWalletClient({ account: privateKeyToAccount(coordinatorPk()) as Account, chain: arcTestnet, transport: http(config.rpcHttp) });
}

/// The coordinator wallet's address (the sponsor of contests it opens).
export function coordinatorAddress(): `0x${string}` {
  return privateKeyToAccount(coordinatorPk()).address;
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

export interface OpenContestInfo {
  id: number;
  contestType: number;
  endsAt: number; // epoch ms
}

/// Contests this coordinator opened that are still OPEN (status 1). Scans back
/// from the newest contest id. Used on startup to resume and settle anything left
/// in flight by a previous run, instead of abandoning its escrowed pool.
export async function findOpenContests(sponsor: `0x${string}`, lookback = 50): Promise<OpenContestInfo[]> {
  const engine = config.contracts.ContestEngine;
  const next = (await publicClient.readContract({ address: engine, abi: engineAbi, functionName: "nextContestId" })) as bigint;
  const latest = Number(next) - 1;
  const floor = Math.max(0, latest - lookback + 1);
  const want = sponsor.toLowerCase();

  const open: OpenContestInfo[] = [];
  for (let id = latest; id >= floor; id--) {
    const c = await publicClient.readContract({ address: engine, abi: engineAbi, functionName: "getContest", args: [BigInt(id)] });
    if (Number(c.status) === 1 && c.sponsor.toLowerCase() === want) {
      open.push({ id, contestType: Number(c.contestType), endsAt: Number(c.endTime) * 1000 });
    }
  }
  return open.reverse(); // oldest first, so we settle in the order they opened
}

/// OPEN contests whose entry window has already closed, regardless of sponsor.
/// These are due for settlement. The coordinator's sweeper uses this so contests
/// hosted by other operators settle too, not only the ones the coordinator opened.
export async function findDueContests(lookback = 100): Promise<OpenContestInfo[]> {
  const engine = config.contracts.ContestEngine;
  const next = (await publicClient.readContract({ address: engine, abi: engineAbi, functionName: "nextContestId" })) as bigint;
  const latest = Number(next) - 1;
  const floor = Math.max(0, latest - lookback + 1);
  const nowSec = Math.floor(Date.now() / 1000);

  const due: OpenContestInfo[] = [];
  for (let id = latest; id >= floor; id--) {
    const c = await publicClient.readContract({ address: engine, abi: engineAbi, functionName: "getContest", args: [BigInt(id)] });
    if (Number(c.status) === 1 && Number(c.endTime) <= nowSec) {
      due.push({ id, contestType: Number(c.contestType), endsAt: Number(c.endTime) * 1000 });
    }
  }
  return due.reverse(); // oldest first
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

/// Counterpart to `fundHotWallets`: after a Scout contest settles, sweep
/// any remaining USDC out of each agent's hot wallet back to the
/// coordinator wallet so the float doesn't leak across contests. USDC is
/// native gas on Arc, so a small dust floor stays behind to keep the
/// wallet usable for the next round without re-funding.
///
/// Reserve floor defaults to 0.05 USDC (50_000 at 6dp). Override with
/// SCOUT_SWEEP_RESERVE_USDC. Sweeps from the hot wallet's own key so the
/// transfer is authentic and gas is paid out of the same wallet.
export async function sweepHotWallets(agentIds: number[]): Promise<void> {
  if (agentIds.length === 0) return;
  if (!config.scout.masterMnemonic) return; // nothing to sweep without the mnemonic

  const reserveUsdc = Number(process.env.SCOUT_SWEEP_RESERVE_USDC ?? "0.05");
  const reserve = BigInt(Math.max(0, Math.round(reserveUsdc * 1e6)));
  const dest = coordinatorAddress();

  let swept = 0;
  let total = 0n;
  for (const id of agentIds) {
    const account = deriveHotWallet(id);
    const bal = (await publicClient.readContract({
      address: config.external.USDC,
      abi: erc20,
      functionName: "balanceOf",
      args: [account.address],
    })) as bigint;
    if (bal <= reserve) continue;
    const amount = bal - reserve;
    try {
      const wallet = createWalletClient({ account: account as Account, chain: arcTestnet, transport: http(config.rpcHttp) });
      const hash = await wallet.writeContract({
        address: config.external.USDC,
        abi: erc20,
        functionName: "transfer",
        args: [dest, amount],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      swept += 1;
      total += amount;
    } catch (err) {
      console.warn(
        `sweepHotWallets: agent ${id} sweep failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
  if (swept > 0) {
    const totalUsdc = (Number(total) / 1e6).toFixed(4);
    console.log(`sweep: pulled ${totalUsdc} USDC back from ${swept} hot wallet(s)`);
  }
}
