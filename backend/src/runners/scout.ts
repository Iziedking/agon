import { createWalletClient, http, parseAbi, toHex } from "viem";
import type { Account, Hash } from "viem";
import { mnemonicToAccount } from "viem/accounts";

import { arcTestnet, publicClient } from "../chain/arc.js";
import { config } from "../config/index.js";
import { query } from "../db/pool.js";
import { swapEnabled, executeSwap } from "../chain/appKitSwap.js";
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
/// contest). Ops are self-transfers so funds stay in the hot wallet and only
/// gas is spent; the same executor can later route through Circle App Kit Swap
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
  // Real DEX swaps when configured. Returns null (and falls through to
  // self-transfers) if the adapter isn't installed or nothing swapped.
  if (swapEnabled()) {
    const swapped = await executeScoutSwaps(agentId, tier, opts?.ops).catch((err) => {
      console.warn(`[scout] real-swap path failed, falling back: ${err instanceof Error ? err.message : err}`);
      return null;
    });
    // Only accept the swap result if it actually moved volume. A zero-volume
    // result (daily swap cap exhausted, or the hot wallet was empty at swap
    // time) must fall through to self-transfers instead of short-circuiting to
    // score 0 — otherwise a volume challenge produces no payouts and cancels.
    if (swapped && swapped.volumeUsdc6 > 0n) return swapped;
    if (swapped) {
      console.warn(`[scout] agent ${agentId}: real swaps moved 0 volume (cap exhausted or empty wallet); falling back to self-transfers`);
    }
  }

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
  // Per-op size is the tier funding (10/25/40/70/100 USDC), recirculated via
  // self-transfer each op, not the balance sliced across all ops (which made
  // 0.5 USDC dust). So a higher tier moves bigger amounts per transaction.
  const tierSize6 = BigInt(Math.round(fundingCapUsdc(tier) * 1e6));
  // On Arc, USDC IS the gas token, so a self-transfer of the FULL balance
  // reverts with "transfer amount exceeds balance" (no USDC left to pay gas).
  // The transfer returns to self, so only gas is actually spent; reserve enough
  // for every op's gas and never move more than what's left after the reserve.
  const GAS_RESERVE_PER_OP6 = BigInt(Math.round(Number(process.env.SCOUT_GAS_RESERVE_USDC ?? "0.05") * 1e6));
  const reserve6 = GAS_RESERVE_PER_OP6 * BigInt(Math.max(1, ops));
  const spendable = balance > reserve6 ? balance - reserve6 : 0n;
  let perOp = opts?.perOpUsdc6 ?? (tierSize6 < spendable ? tierSize6 : spendable);
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

/// Per-tier funding ceiling in whole USDC. Tier caps how much an agent puts to
/// work per swap; the daily swap budget is the same for every tier, so a
/// smaller agent has to swap more times to reach the same volume.
function fundingCapUsdc(tier: number): number {
  const t = Math.min(Math.max(Math.floor(tier), 0), 4);
  return config.scout.fundingByTier[t] ?? 50;
}

/// How many swaps this agent has left in today's shared budget.
async function dailySwapsRemaining(agentId: number): Promise<number> {
  const { rows } = await query<{ used: string }>(
    "select used::text from scout_swap_budget where agent_id = $1 and day = (now() at time zone 'utc')::date",
    [agentId],
  );
  const used = Number(rows[0]?.used ?? 0);
  return Math.max(0, config.scout.dailySwapCap - used);
}

async function recordSwaps(agentId: number, n: number): Promise<void> {
  if (n <= 0) return;
  await query(
    `insert into scout_swap_budget (agent_id, day, used)
       values ($1, (now() at time zone 'utc')::date, $2)
       on conflict (agent_id, day) do update set used = scout_swap_budget.used + excluded.used`,
    [agentId, n],
  );
}

/// Real-swap execution: alternates the configured token pair (USDC/EURC by
/// default) to produce genuine DEX volume. Per-swap size is capped by the
/// tier funding ceiling; swap count is bounded by the shared daily budget and
/// the per-run cap. Returns null when no swap landed (adapter missing) so the
/// caller falls back to self-transfers.
async function executeScoutSwaps(agentId: number, tier: number, ops?: number): Promise<ScoutExecution | null> {
  if (!config.scout.masterMnemonic) return null;
  // Re-derive as an HD account so we can extract the private key the App Kit
  // viem adapter needs (deriveHotWallet's return type is the generic Account).
  const account = mnemonicToAccount(config.scout.masterMnemonic, { addressIndex: agentId });
  const pkBytes = account.getHdKey().privateKey;
  if (!pkBytes) return null;
  const privateKey = toHex(pkBytes) as `0x${string}`;

  const balance = await publicClient.readContract({
    address: config.external.USDC,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });
  const balanceUsdc = Number(balance) / 1e6;

  const remaining = await dailySwapsRemaining(agentId);
  // Trait/training boost arrives as `ops` (more round-trips = more real volume).
  // Falls back to the per-run default. Always bounded by the shared daily cap.
  const want = ops != null && ops > 0 ? ops : config.scout.swapsPerRun;
  const roundTrips = Math.min(want, remaining);
  if (roundTrips <= 0) {
    return { address: account.address, volumeUsdc6: 0n, opsCount: 0, txHashes: [], txVolumesUsdc6: [] };
  }

  // USDC is the gas token on Arc, so the swap (and its return leg) must leave
  // headroom or the router pulls the whole balance and the tx reverts for gas.
  // Reserve a buffer per leg (forward + return per round, plus one spare).
  const gasReserveUsdc = Number(process.env.SCOUT_GAS_RESERVE_USDC ?? "0.10");
  const reserveUsdc = gasReserveUsdc * (roundTrips * 2 + 1);
  const spendableUsdc = Math.max(0, balanceUsdc - reserveUsdc);
  const perSwapUsdc = Math.min(fundingCapUsdc(tier), spendableUsdc);
  if (perSwapUsdc <= 0) {
    // Not enough USDC to swap and still cover gas: let the caller self-transfer.
    return null;
  }

  const usdcSymbol = config.scout.swapTokenIn; // "USDC"
  const altSymbol = config.scout.swapTokenOut; // "EURC"
  const forwardAmount = perSwapUsdc.toFixed(6);
  const txHashes: Hash[] = [];
  const txVolumesUsdc6: string[] = [];
  let volume = 0n;
  let legs = 0;

  for (let i = 0; i < roundTrips; i++) {
    // Forward leg: USDC -> EURC. This is the swap judges see first on arcscan.
    const fwd = await executeSwap({
      privateKey,
      tokenIn: usdcSymbol,
      tokenOut: altSymbol,
      amountIn: forwardAmount,
    });
    if (!fwd) break; // packages missing / route failed: caller self-transfers
    if (fwd.txHash) {
      txHashes.push(fwd.txHash as Hash);
      const vol6 = BigInt(Math.round(perSwapUsdc * 1e6));
      txVolumesUsdc6.push(vol6.toString());
      volume += vol6;
      legs++;
    }

    // Return leg: EURC -> USDC, sized to exactly the EURC we just received so
    // the principal recirculates. Gas is still paid in USDC from the reserve.
    const eurcOut = Number(fwd.amountOut);
    if (Number.isFinite(eurcOut) && eurcOut > 0) {
      const rev = await executeSwap({
        privateKey,
        tokenIn: altSymbol,
        tokenOut: usdcSymbol,
        amountIn: eurcOut.toFixed(6),
      });
      if (rev?.txHash) {
        txHashes.push(rev.txHash as Hash);
        // Count the USDC the return leg produced as volume (falls back to the
        // forward notional when the service omits amountOut).
        const back = Number(rev.amountOut) > 0 ? Number(rev.amountOut) : perSwapUsdc;
        const vol6 = BigInt(Math.round(back * 1e6));
        txVolumesUsdc6.push(vol6.toString());
        volume += vol6;
        legs++;
      }
    }
  }

  if (legs === 0) return null;
  await recordSwaps(agentId, legs).catch(() => {});
  return { address: account.address, volumeUsdc6: volume, opsCount: legs, txHashes, txVolumesUsdc6 };
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

/// Streaming context for a live volume race. When present (challenge/contest
/// resolver passes it), the runner performs the real swaps progressively and
/// broadcasts a standings frame after each one so the tx tape fills as the
/// countdown ticks, instead of bursting every swap at settlement.
export interface ScoutRunCtx {
  broadcast?: (message: unknown) => void;
  /// Hard stop (epoch ms). The runner starts no new swap after this. The
  /// challenge resolver passes resolveDeadline - 60s so swapping ends a full
  /// minute before the event closes.
  deadlineMs?: number;
  /// Picks the loadout namespace for trait reads and the broadcast message
  /// type ("challenge_standings" vs "contest_standings").
  source?: "contest" | "challenge";
}

/// Hard ceiling on how long the live race blocks the resolver, so a single
/// challenge can't eat the sweeper's per-event timeout (default 150s). The
/// race also stops at deadlineMs (resolveDeadline - 60s), whichever is sooner.
const RACE_MAX_SECONDS = Number(process.env.SCOUT_RACE_SECONDS ?? "90");
const RACE_INTER_ROUND_MS = Number(process.env.SCOUT_RACE_DELAY_MS ?? "400");
const raceSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface SwapAbility {
  privateKey: `0x${string}`;
  perSwapUsdc: number;
  /// Bound on swap legs this agent may run this round: trait-boosted target
  /// (round-trips x2) clamped by the shared 1024/day budget remaining.
  targetLegs: number;
}

/// Resolve an agent's hot wallet, per-swap size, and remaining swap budget for
/// the live race. perSwapUsdc 0 means it can't swap (empty wallet or daily cap
/// hit); the caller skips it.
async function prepareSwapAbility(
  agentId: number,
  tier: number,
  targetRoundTrips: number,
): Promise<SwapAbility | null> {
  if (!config.scout.masterMnemonic) return null;
  const account = mnemonicToAccount(config.scout.masterMnemonic, { addressIndex: agentId });
  const pkBytes = account.getHdKey().privateKey;
  if (!pkBytes) return null;
  const privateKey = toHex(pkBytes) as `0x${string}`;

  const balance = await publicClient.readContract({
    address: config.external.USDC,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });
  const balanceUsdc = Number(balance) / 1e6;
  const dailyRemaining = await dailySwapsRemaining(agentId); // in legs
  const targetLegs = Math.max(0, Math.min(targetRoundTrips * 2, dailyRemaining));
  if (targetLegs <= 0) return { privateKey, perSwapUsdc: 0, targetLegs: 0 };

  // The principal recirculates each round-trip, so a flat gas buffer covers
  // every leg's gas; no need to scale the reserve by the full round count.
  const gasReserveUsdc = Number(process.env.SCOUT_GAS_RESERVE_USDC ?? "0.10");
  const spendableUsdc = Math.max(0, balanceUsdc - gasReserveUsdc * 3);
  const perSwapUsdc = Math.min(fundingCapUsdc(tier), spendableUsdc);
  return { privateKey, perSwapUsdc, targetLegs };
}

/// One USDC -> EURC -> USDC round-trip. Returns the legs that actually landed
/// (0, 1, or 2) with each leg's USDC-equivalent volume. Recirculates the
/// principal so the next round-trip can run from the same wallet.
async function oneRoundTrip(
  privateKey: `0x${string}`,
  perSwapUsdc: number,
): Promise<Array<{ txHash: Hash; vol6: bigint }>> {
  const legs: Array<{ txHash: Hash; vol6: bigint }> = [];
  const usdc = config.scout.swapTokenIn;
  const alt = config.scout.swapTokenOut;
  const fwd = await executeSwap({ privateKey, tokenIn: usdc, tokenOut: alt, amountIn: perSwapUsdc.toFixed(6) });
  if (!fwd) return legs;
  if (fwd.txHash) legs.push({ txHash: fwd.txHash as Hash, vol6: BigInt(Math.round(perSwapUsdc * 1e6)) });
  const altOut = Number(fwd.amountOut);
  if (Number.isFinite(altOut) && altOut > 0) {
    const rev = await executeSwap({ privateKey, tokenIn: alt, tokenOut: usdc, amountIn: altOut.toFixed(6) });
    if (rev?.txHash) {
      const back = Number(rev.amountOut) > 0 ? Number(rev.amountOut) : perSwapUsdc;
      legs.push({ txHash: rev.txHash as Hash, vol6: BigInt(Math.round(back * 1e6)) });
    }
  }
  return legs;
}

interface ScoutPlan {
  entry: ContestEntryInput;
  account: Account;
  strategy: ScoutStrategy;
  strength: ReturnType<typeof effectiveStrength>;
  opBoost: number;
  /// Trait-boosted target round-trips, clamped to the tier op cap.
  target: number;
}

export class ScoutRunner implements Runner {
  readonly kind = "scout" as const;
  constructor(private readonly opsPerContest = 5) {}

  async run(contestId: number, entries: ContestEntryInput[], ctx?: ScoutRunCtx): Promise<AgentResult[]> {
    const real = llmConfigured();
    const source = ctx?.source ?? "contest";
    const results: AgentResult[] = [];
    const plans: ScoutPlan[] = [];

    // Pre-pass: pick each agent's strategy and trait-boosted swap target. The
    // execution (sequential burst, or the live streamed race) happens after.
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

      // Strength up front: tier already sets the per-swap SIZE (10/25/40/70/100),
      // so the training x traits portion becomes MORE swaps (real volume), not a
      // post-hoc score multiplier. tierBase is excluded — tier's edge is already
      // the bigger swap. This is the lever a well-trained, well-equipped lower
      // tier uses to out-volume a bare higher tier: the right traits = more
      // round-trips = more on-chain volume. Loadout is read from the right
      // namespace ("challenge" vs "contest") so equipped traits actually count.
      const stats = await loadAgentStats(e.agentId).catch(() => ({}));
      const equipped = await getLoadout(source, contestId, e.agentId).catch(() => [] as string[]);
      const strength = effectiveStrength(e.tier, stats, equipped, "scout");
      const opBoost = strength.training * strength.traits;
      const target = Math.max(1, Math.min(Math.round(strategy.opsCount * opBoost), limit.maxOps));
      plans.push({ entry: e, account, strategy, strength, opBoost, target });
    }

    const execMap =
      ctx?.broadcast && swapEnabled()
        ? await this.streamedRace(contestId, plans, ctx)
        : await this.sequentialExec(plans);

    for (const p of plans) {
      const exec =
        execMap.get(p.entry.agentId) ??
        ({ address: p.account.address, volumeUsdc6: 0n, opsCount: 0, txHashes: [], txVolumesUsdc6: [] } as ScoutExecution);
      // Score IS the real USDC volume moved. No multiplier flip: traits/training
      // already paid out as the extra swaps above, so the agent that genuinely
      // moved the most volume wins.
      const score = scoutScore({
        volumeUsdc6: exec.volumeUsdc6,
        opsCount: exec.opsCount,
        seed: contestId * 1000 + p.entry.agentId,
      });
      const recent = exec.txHashes.slice(-6).reverse().map((h) => h as string);
      const recentVolumes = exec.txVolumesUsdc6.slice(-6).reverse();
      results.push({
        agentId: p.entry.agentId,
        operator: p.entry.operator,
        score,
        detail: {
          volumeUsdc6: exec.volumeUsdc6.toString(),
          opsCount: exec.opsCount,
          hot: p.account.address,
          strategy: p.strategy.rationale,
          baseOps: p.strategy.opsCount,
          boostedOps: p.target,
          opBoost: Number(p.opBoost.toFixed(3)),
          strength: {
            effective: Number(p.strength.effective.toFixed(2)),
            tierBase: p.strength.tierBase,
            training: Number(p.strength.training.toFixed(3)),
            traits: Number(p.strength.traits.toFixed(3)),
          },
        },
        progress: {
          kind: "scout" as const,
          opsCount: exec.opsCount,
          recent,
          recentVolumes,
          researchSpent6:
            p.strategy.researchSpent6 && p.strategy.researchSpent6 > 0n ? p.strategy.researchSpent6.toString() : undefined,
          researchLabel:
            p.strategy.researchSpent6 && p.strategy.researchSpent6 > 0n ? p.strategy.researchLabel : undefined,
        },
      });
    }
    return results;
  }

  /// Burst path (contests, and the fallback when no broadcast ctx is given):
  /// run each agent's swaps to its target, one agent fully then the next.
  private async sequentialExec(plans: ScoutPlan[]): Promise<Map<number, ScoutExecution>> {
    const map = new Map<number, ScoutExecution>();
    for (const p of plans) {
      const exec = await executeScout(p.entry.agentId, p.entry.tier, { ops: p.target });
      map.set(p.entry.agentId, exec);
    }
    return map;
  }

  /// Live path: interleave agents one round-trip at a time, broadcasting a
  /// standings frame after every leg so the tx tape fills as the countdown
  /// ticks. Stops at deadlineMs (resolveDeadline - 60s) or RACE_MAX_SECONDS,
  /// whichever comes first, and never exceeds an agent's trait-boosted target
  /// or the shared 1024/day budget.
  private async streamedRace(
    eventId: number,
    plans: ScoutPlan[],
    ctx: ScoutRunCtx,
  ): Promise<Map<number, ScoutExecution>> {
    interface Lane {
      agentId: number;
      operator: `0x${string}`;
      account: Account;
      ability: SwapAbility | null;
      volume6: bigint;
      txHashes: Hash[];
      txVolumes6: string[];
      legs: number;
    }
    const lanes: Lane[] = [];
    for (const p of plans) {
      // The live race is time-bounded (stops at deadline / RACE_MAX_SECONDS),
      // so aim high: keep swapping for the whole window up to the tier op cap
      // and the 1024/day budget. Traits/training raise the ceiling (more
      // round-trips = more volume); time is the real limiter. The burst path
      // keeps the conservative `p.target` so a contest settlement doesn't
      // block on hundreds of sequential swaps.
      const maxOps = tierLimit(p.entry.tier).maxOps;
      const raceTarget = Math.min(
        maxOps,
        Math.max(1, Math.round(Math.max(p.strategy.opsCount, config.scout.swapsPerRun) * p.opBoost)),
      );
      const ability = await prepareSwapAbility(p.entry.agentId, p.entry.tier, raceTarget).catch(() => null);
      lanes.push({
        agentId: p.entry.agentId,
        operator: p.entry.operator,
        account: p.account,
        ability: ability && ability.perSwapUsdc > 0 ? ability : null,
        volume6: 0n,
        txHashes: [],
        txVolumes6: [],
        legs: 0,
      });
    }

    const hardStop = Math.min(ctx.deadlineMs ?? Number.MAX_SAFE_INTEGER, Date.now() + RACE_MAX_SECONDS * 1000);
    const msgType = ctx.source === "challenge" ? "challenge_standings" : "contest_standings";
    const idKey = ctx.source === "challenge" ? "challengeId" : "contestId";

    const emit = () => {
      if (!ctx.broadcast) return;
      const ranked = lanes
        .slice()
        .sort((a, b) => (b.volume6 > a.volume6 ? 1 : b.volume6 < a.volume6 ? -1 : 0))
        .map((l, i) => ({
          rank: i + 1,
          agentId: l.agentId,
          operator: l.operator,
          score: Math.round(Number(l.volume6) / 1e6),
          progress: {
            kind: "scout" as const,
            opsCount: l.legs,
            recent: l.txHashes.slice(-6).reverse().map((h) => h as string),
            recentVolumes: l.txVolumes6.slice(-6).reverse(),
          },
        }));
      ctx.broadcast({ type: msgType, [idKey]: eventId, entries: ranked });
    };

    emit(); // initial frame so the stage shows the field before the first swap

    let active = true;
    while (active && Date.now() < hardStop) {
      active = false;
      for (const lane of lanes) {
        if (Date.now() >= hardStop) break;
        const ab = lane.ability;
        if (!ab || lane.legs >= ab.targetLegs) continue;
        active = true;
        const legs = await oneRoundTrip(ab.privateKey, ab.perSwapUsdc).catch(
          () => [] as Array<{ txHash: Hash; vol6: bigint }>,
        );
        if (legs.length === 0) {
          // Route unavailable for this agent right now: retire its lane so the
          // loop doesn't spin on it, and let the others keep swapping.
          lane.ability = null;
          continue;
        }
        for (const leg of legs) {
          lane.txHashes.push(leg.txHash);
          lane.txVolumes6.push(leg.vol6.toString());
          lane.volume6 += leg.vol6;
          lane.legs++;
        }
        await recordSwaps(lane.agentId, legs.length).catch(() => {});
        emit();
        if (RACE_INTER_ROUND_MS > 0) await raceSleep(RACE_INTER_ROUND_MS);
      }
    }

    const map = new Map<number, ScoutExecution>();
    let total = 0n;
    for (const lane of lanes) {
      map.set(lane.agentId, {
        address: lane.account.address,
        volumeUsdc6: lane.volume6,
        opsCount: lane.legs,
        txHashes: lane.txHashes,
        txVolumesUsdc6: lane.txVolumes6,
      });
      total += lane.volume6;
    }
    // No real volume (adapter missing, every route failed, wallets empty):
    // fall back to self-transfers so the event still settles with payouts
    // instead of cancelling for "no scoring entrants".
    if (total === 0n) return this.sequentialExec(plans);
    return map;
  }
}
