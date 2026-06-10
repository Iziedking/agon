import { createWalletClient, http, parseAbi } from "viem";
import type { Account, Hash } from "viem";
import { mnemonicToAccount } from "viem/accounts";

import { arcTestnet, publicClient } from "../chain/arc.js";
import { config } from "../config/index.js";
import { scoutScore } from "../scoring/index.js";
import type { AgentResult, ContestEntryInput, Runner } from "./types.js";
import { callModel, llmConfigured, recordLlmRun, readExistingRuns, DailyKillError } from "./llm/client.js";
import { resolveRuntimeParams, loadAgentStats, type RuntimeParams } from "./llm/tierConfig.js";
import { effectiveStrength } from "../scoring/strength.js";
import { getLoadout } from "../auth/loadouts.js";
import { applyRouting } from "./solver.js";
import {
  paidAgentResearch,
  buildPriceUrl,
  summarizePrices,
} from "../nanopayments/research.js";

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
  /// Aligned 1:1 with txHashes. Each entry is the USDC amount (6-decimals)
  /// transferred in that op, as a decimal string. Powers the live stage's
  /// tx tape so each row shows its actual value.
  txVolumesUsdc6: string[];
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
  const txVolumesUsdc6: string[] = [];
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
      txVolumesUsdc6.push(perOp.toString());
      volume += perOp;
    }
  }

  return {
    address: account.address,
    volumeUsdc6: volume,
    opsCount: txHashes.length,
    txHashes,
    txVolumesUsdc6,
  };
}

/// LLM-picked execution strategy. Tier 0/1 skip the LLM and use defaults
/// (tier cap clamped); tier 2+ ask the LLM to choose opsCount and
/// perOpUsdc6 within the tier's hard caps. The LLM can't go over the cap
/// (we clamp on the way out), so paying for tier 4 still grants more
/// volume; the LLM only decides how to distribute it.
interface ScoutStrategy {
  opsCount: number;
  perOpUsdc6: bigint;
  rationale: string;
  /// Settled research spend (USDC 6-dec) made before picking, when the
  /// tier unlocked the paid market check. Surfaced on the live stage.
  researchSpent6?: bigint;
  researchLabel?: string;
}

async function pickScoutStrategy(
  contestId: number,
  entry: ContestEntryInput,
  balance: bigint,
  limit: TierLimit,
  params: RuntimeParams,
): Promise<ScoutStrategy> {
  const defaultOps = Math.min(limit.maxOps, 5);
  const defaultPerOp = balance / BigInt(defaultOps + 1);

  // Idempotent: scout strategy lives at puzzle_idx 0 in llm_runs. If we
  // already have a row, reuse the rationale instead of paying for another
  // LLM call. Strategy is read-only on the second pass; the actual
  // executeScout call still fires every time because that's the on-chain
  // work.
  const cached = await readExistingRuns(contestId, entry.agentId, "scout").catch(() => []);
  if (cached.length > 0) {
    // We don't parse OPS / PER_OP_USDC out of the cached response here;
    // the second pass uses the cap clamp and the rationale string from
    // the audit so the audit row narrates the agent's actual decision.
    const opsCount = defaultOps;
    return {
      opsCount,
      perOpUsdc6: defaultPerOp,
      rationale: cached[0]!.response.slice(0, 200),
    };
  }

  if (!params.llmEnabled) {
    return { opsCount: defaultOps, perOpUsdc6: defaultPerOp, rationale: "tier default" };
  }

  // Tier-gated paid market check before committing the strategy. The
  // Scout buys current spot prices so its sizing decision reflects market
  // conditions instead of a blind default. Null means proceed without.
  let research: { usdcAmount6: bigint; label: string; summary: string } | null = null;
  if (config.nanopay.scoutPriceEndpoint) {
    research = await paidAgentResearch({
      agentId: entry.agentId,
      contestId,
      puzzleIdx: 0,
      tier: entry.tier,
      endpoint: buildPriceUrl(config.nanopay.scoutPriceEndpoint, ["ETH", "USDC"]),
      label: config.nanopay.scoutPriceLabel,
      chain: config.nanopay.scoutPriceChain,
      summarize: summarizePrices,
    }).catch(() => null);
  }

  const systemPrompt = [
    "You are an ArcRun scout agent picking a USDC volume execution strategy.",
    "Choose how many self-transfer ops to run and how much USDC to move per op.",
    "Output two lines exactly:",
    "OPS: <integer>",
    "PER_OP_USDC: <decimal>",
  ].join(" ");
  const userPrompt = [
    ...(research ? [`MARKET (${research.label}): ${research.summary}`] : []),
    `You control a hot wallet with ${Number(balance) / 1_000_000} USDC.`,
    `Tier cap: at most ${limit.maxOps} ops, at most ${Number(limit.maxPerOpUsdc6) / 1_000_000} USDC per op.`,
    "Pick ops + per_op_usdc to maximize total volume while leaving headroom for gas.",
  ].join("\n");

  let response = "";
  let verdict: "correct" | "wrong" | "skipped" | "error" = "correct";
  let cost = 0;
  let latencyMs = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    const res = await callModel({
      model: params.model,
      systemPrompt,
      userPrompt,
      maxTokens: params.maxTokens,
      temperature: params.temperature,
      tools: params.tools,
    });
    response = res.text;
    latencyMs = res.latencyMs;
    inputTokens = res.inputTokens;
    outputTokens = res.outputTokens;
    cost = res.costUsd;
  } catch (err) {
    verdict = err instanceof DailyKillError ? "skipped" : "error";
    response = err instanceof Error ? err.message : String(err);
  }

  const parsed = parseStrategy(response);
  // Clamp to tier limits + balance reality.
  const opsCount = Math.max(0, Math.min(limit.maxOps, parsed.opsCount ?? defaultOps));
  let perOp = parsed.perOpUsdc6 ?? defaultPerOp;
  if (perOp > limit.maxPerOpUsdc6) perOp = limit.maxPerOpUsdc6;
  if (opsCount > 0 && perOp > balance / BigInt(opsCount + 1)) {
    perOp = balance / BigInt(opsCount + 1);
  }

  // Scout "answer" is the chosen strategy in numeric form so the live
  // cell shows "OPS 8 · $1.25" instead of the strategy prose.
  const scoutAnswer = verdict === "skipped" || verdict === "error"
    ? null
    : `OPS ${opsCount} · $${(Number(perOp) / 1e6).toFixed(2)}`;

  await recordLlmRun({
    contestId,
    agentId: entry.agentId,
    operator: entry.operator,
    roundIdx: 0,
    puzzleIdx: 0,
    kind: "scout",
    model: params.llmEnabled ? params.model : "default",
    prompt: userPrompt,
    response,
    expected: null,
    answer: scoutAnswer,
    verdict,
    latencyMs,
    inputTokens,
    outputTokens,
    costUsd: cost,
  }).catch(() => { /* audit row best-effort */ });

  return {
    opsCount,
    perOpUsdc6: perOp,
    rationale: response.slice(0, 200),
    researchSpent6: research?.usdcAmount6,
    researchLabel: research?.label,
  };
}

function parseStrategy(text: string): { opsCount: number | null; perOpUsdc6: bigint | null } {
  const opsMatch = text.match(/OPS\s*[:=]?\s*(\d+)/i);
  const perOpMatch = text.match(/PER_OP_USDC\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
  const opsCount = opsMatch ? Number(opsMatch[1]) : null;
  let perOpUsdc6: bigint | null = null;
  if (perOpMatch) {
    const v = Number(perOpMatch[1]);
    if (Number.isFinite(v) && v >= 0) perOpUsdc6 = BigInt(Math.floor(v * 1_000_000));
  }
  return {
    opsCount: opsCount != null && Number.isFinite(opsCount) ? opsCount : null,
    perOpUsdc6,
  };
}

export class ScoutRunner implements Runner {
  readonly kind = "scout" as const;
  constructor(private readonly opsPerContest = 5) {}

  async run(contestId: number, entries: ContestEntryInput[]): Promise<AgentResult[]> {
    const results: AgentResult[] = [];
    const real = llmConfigured();

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

      const limit = tierLimit(e.tier);
      const params = real ? await resolveRuntimeParams(e.agentId, e.tier).catch(() => null) : null;
      const strategy = params
        ? await pickScoutStrategy(contestId, e, balance, limit, params)
        : { opsCount: Math.min(this.opsPerContest, limit.maxOps), perOpUsdc6: balance / BigInt(this.opsPerContest + 1), rationale: "no llm" };

      const exec = await executeScout(e.agentId, e.tier, {
        ops: strategy.opsCount,
        perOpUsdc6: strategy.perOpUsdc6,
      });
      const rawScore = scoutScore({
        volumeUsdc6: exec.volumeUsdc6,
        opsCount: exec.opsCount,
        seed: contestId * 1000 + e.agentId,
      });
      // tier x training x traits per docs/agentTier.md
      const stats = await loadAgentStats(e.agentId).catch(() => ({}));
      const equipped = await getLoadout("contest", contestId, e.agentId).catch(() => [] as string[]);
      const strength = effectiveStrength(e.tier, stats, equipped, "scout");
      const score = applyRouting(rawScore, strength, contestId * 1000 + e.agentId);
      // Surface the real tx hashes (most recent first) so the volume stage on
      // the live page renders the actual onchain activity. recentVolumes is
      // aligned 1:1 so each tape row can show its own value.
      const recent = exec.txHashes.slice(-6).reverse().map((h) => h as string);
      const recentVolumes = exec.txVolumesUsdc6.slice(-6).reverse();
      results.push({
        agentId: e.agentId,
        operator: e.operator,
        score,
        detail: {
          volumeUsdc6: exec.volumeUsdc6.toString(),
          opsCount: exec.opsCount,
          hot: account.address,
          strategy: strategy.rationale,
          rawScore,
          strength: {
            effective: Number(strength.effective.toFixed(2)),
            tierBase: strength.tierBase,
            training: Number(strength.training.toFixed(3)),
            traits: Number(strength.traits.toFixed(3)),
          },
        },
        progress: {
          kind: "scout" as const,
          opsCount: exec.opsCount,
          recent,
          recentVolumes,
          researchSpent6: strategy.researchSpent6 && strategy.researchSpent6 > 0n
            ? strategy.researchSpent6.toString()
            : undefined,
          researchLabel: strategy.researchSpent6 && strategy.researchSpent6 > 0n
            ? strategy.researchLabel
            : undefined,
        },
      });
    }
    return results;
  }
}
