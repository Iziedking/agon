import { createWalletClient, http, parseAbi } from "viem";
import type { Account, Hash } from "viem";
import { mnemonicToAccount } from "viem/accounts";

import { arcTestnet, publicClient } from "../chain/arc.js";
import { config } from "../config/index.js";
import { scoutScore } from "../scoring/index.js";
import type { AgentResult, ContestEntryInput, Runner } from "./types.js";

/// ScoutRunner: each agent has a deterministic hot wallet derived from the
/// master mnemonic by agentId. The agent performs tier-limited real USDC
/// operations on Arc, generating genuine on-chain volume (the point of a Scout
/// contest). v0 uses self-transfers so funds stay in the hot wallet and only
/// gas is spent; the same executor will later route through Circle App Kit Swap
/// or a sponsor's protocol. Tier caps the op count and per-op size.

const USDC_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
]);

interface TierLimit {
  maxOps: number;
  maxPerOpUsdc6: bigint;
}

/// Five-tier Scout caps. Per-op cap is in USDC (6 decimals). The progression
/// is: small starter, busier mid, sustained throughput, near-uncapped, top of
/// curve. Settle-time gas budget scales with maxOps.
const TIER_LIMITS: TierLimit[] = [
  { maxOps: 5, maxPerOpUsdc6: 10_000_000n }, // tier 0: <=5 ops, <=$10 each
  { maxOps: 20, maxPerOpUsdc6: 100_000_000n }, // tier 1: <=20 ops, <=$100 each
  { maxOps: 100, maxPerOpUsdc6: 250_000_000n }, // tier 2: <=100 ops, <=$250 each
  { maxOps: 500, maxPerOpUsdc6: 500_000_000n }, // tier 3: <=500 ops, <=$500 each
  { maxOps: 2000, maxPerOpUsdc6: 1_000_000_000n }, // tier 4: <=2000 ops, <=$1000 each
];

function tierLimit(tier: number): TierLimit {
  return TIER_LIMITS[Math.min(Math.max(tier, 0), 4)]!;
}

export function deriveHotWallet(agentId: number): Account {
  if (!config.scout.masterMnemonic) throw new Error("SCOUT_MASTER_MNEMONIC not set");
  return mnemonicToAccount(config.scout.masterMnemonic, { addressIndex: agentId });
}

export async function hotWalletBalance(agentId: number): Promise<bigint> {
  const account = deriveHotWallet(agentId);
  return publicClient.readContract({
    address: config.external.USDC,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });
}

export interface ScoutExecution {
  address: `0x${string}`;
  volumeUsdc6: bigint;
  opsCount: number;
  txHashes: Hash[];
}

/// Runs tier-limited USDC operations from the agent's hot wallet. `ops` defaults
/// to the tier cap (clamped); `perOpUsdc6` defaults to a balance-fitting size so
/// a lightly funded wallet still produces several operations.
export async function executeScout(
  agentId: number,
  tier: number,
  opts?: { ops?: number; perOpUsdc6?: bigint },
): Promise<ScoutExecution> {
  const limit = tierLimit(tier);
  const account = deriveHotWallet(agentId);
  const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(config.rpcHttp) });

  const balance = await publicClient.readContract({
    address: config.external.USDC,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });

  const ops = Math.max(0, Math.min(opts?.ops ?? limit.maxOps, limit.maxOps));
  // Leave headroom for gas; self-transfers return the principal each time.
  let perOp = opts?.perOpUsdc6 ?? balance / BigInt(ops + 1);
  if (perOp > limit.maxPerOpUsdc6) perOp = limit.maxPerOpUsdc6;

  const txHashes: Hash[] = [];
  let volume = 0n;
  if (perOp > 0n) {
    for (let i = 0; i < ops; i++) {
      const hash = await wallet.writeContract({
        address: config.external.USDC,
        abi: USDC_ABI,
        functionName: "transfer",
        args: [account.address, perOp], // self-transfer: real Transfer event, only gas spent
      });
      await publicClient.waitForTransactionReceipt({ hash });
      txHashes.push(hash);
      volume += perOp;
    }
  }

  return { address: account.address, volumeUsdc6: volume, opsCount: txHashes.length, txHashes };
}

export class ScoutRunner implements Runner {
  readonly kind = "scout" as const;
  constructor(private readonly opsPerContest = 5) {}

  async run(contestId: number, entries: ContestEntryInput[]): Promise<AgentResult[]> {
    const results: AgentResult[] = [];
    for (const e of entries) {
      const account = deriveHotWallet(e.agentId);
      const balance = await hotWalletBalance(e.agentId);
      if (balance === 0n) {
        results.push({
          agentId: e.agentId,
          operator: e.operator,
          score: 0,
          detail: { skipped: "unfunded hot wallet", hot: account.address },
        });
        continue;
      }
      const exec = await executeScout(e.agentId, e.tier, { ops: this.opsPerContest });
      const score = scoutScore({
        volumeUsdc6: exec.volumeUsdc6,
        opsCount: exec.opsCount,
        seed: contestId * 1000 + e.agentId,
      });
      // Surface the real tx hashes (most recent first) so the volume stage on
      // the live page renders the actual onchain activity.
      const recent = exec.txHashes.slice(-6).reverse().map((h) => h as string);
      results.push({
        agentId: e.agentId,
        operator: e.operator,
        score,
        detail: { volumeUsdc6: exec.volumeUsdc6.toString(), opsCount: exec.opsCount, hot: account.address },
        progress: { kind: "scout" as const, opsCount: exec.opsCount, recent },
      });
    }
    return results;
  }
}
