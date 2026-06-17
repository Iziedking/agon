import { createWalletClient, http, parseAbi, toHex } from "viem";
import type { Account, Hash } from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";

import { arcTestnet, publicClient } from "../chain/arc.js";
import { config } from "../config/index.js";
import { query } from "../db/pool.js";
import { swapEnabled, executeSwap } from "../chain/appKitSwap.js";
import { bridgeScoutLeg } from "../chain/scoutBridge.js";
import { scoutScore } from "../scoring/index.js";
import type { AgentResult, ContestEntryInput, Runner, TapeEvent } from "./types.js";
import { callModel, llmConfigured, recordLlmRun, readExistingRuns, DailyKillError } from "./llm/client.js";
import { resolveRuntimeParams, loadAgentStats, type RuntimeParams } from "./llm/tierConfig.js";
import { effectiveStrength, scoutTraitAbilities, scoutSpeedStatFactor, totalTrainedLevels } from "../scoring/strength.js";
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
  // Per-op size is the per-tier swap size (2 / 5 / 10 / 15 / 25 USDC),
  // recirculated via self-transfer each op, not the balance sliced across all
  // ops (which made 0.5 USDC dust). So a higher tier moves bigger amounts per tx.
  const tierSize6 = BigInt(Math.round(swapSizeUsdc(tier) * 1e6));
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

/// Per-tier SIZE of one swap/transfer in whole USDC (tier 0 = 2 up to tier 4 =
/// 25 by default). This is the base each op moves; trait size multipliers scale
/// it and the wallet balance plus SCOUT_SWAP_MAX_USDC clamp it. The daily swap
/// budget is the same for every tier, so a smaller agent has to swap more times
/// to match a higher tier's volume, and upgrading raises the size per op.
function swapSizeUsdc(tier: number): number {
  const t = Math.min(Math.max(Math.floor(tier), 0), 4);
  return config.scout.swapSizeByTier[t] ?? 2;
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
  const perSwapUsdc = Math.min(swapSizeUsdc(tier), spendableUsdc);
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
// Real DEX swaps take ~30-60s each via Swap Kit, so the window has to be long
// enough for every agent to stack several real swaps (a one-swap "race" is not a
// race). Defaults raised for that; both are env-tunable, and the window is still
// clamped to 60s before the resolve deadline so settlement always fits.
const RACE_MAX_SECONDS = Number(process.env.SCOUT_RACE_SECONDS ?? "210");
// Trait-aware window: when the field carries swap traits (a high cap or high
// pace), the race is allowed to run longer so those agents can actually spend
// their advantage, up to RACE_CEIL_SECONDS and never past the resolve deadline.
const RACE_CEIL_SECONDS = Number(process.env.SCOUT_RACE_CEIL_SECONDS ?? "420");
const RACE_TRAIT_BONUS_SECONDS = Number(process.env.SCOUT_RACE_TRAIT_BONUS ?? "45"); // per unit of demand over 1x
const RACE_INTER_ROUND_MS = Number(process.env.SCOUT_RACE_DELAY_MS ?? "400");
// Flat per-round swap cap (legs). Every tier starts at the default; count traits
// (Volume Titan, the count commons, Arc Sovereign) raise it toward the ceiling,
// so a lower tier with the right trait keeps swapping past the default. Tier's
// edge is bigger swaps and faster pace, NOT a higher cap. Clamped at execution
// by the shared 1024/day budget.
const ROUND_SWAP_CAP_DEFAULT = Number(process.env.SCOUT_ROUND_CAP ?? "85");
const ROUND_SWAP_CAP_MAX = Number(process.env.SCOUT_ROUND_CAP_MAX ?? "120");
// Training permanently raises the cap: every completed stat level adds this many
// swaps to the per-round allowance, ON TOP of the flat base + count traits. It is
// automatic and retroactive — the cap reads the agent's current training levels,
// so a player who has already trained gets the higher cap immediately, and every
// future training lifts it further. The total is clamped to ROUND_SWAP_CAP_CEIL
// (above the trait-only 120 so training can push past it) and the 1024/day budget.
const SCOUT_TRAIN_CAP_PER_LEVEL = Number(process.env.SCOUT_TRAIN_CAP_PER_LEVEL ?? "3");
const ROUND_SWAP_CAP_CEIL = Number(process.env.SCOUT_ROUND_CAP_CEIL ?? "250");
// Floor on a lane's inter-round idle (ms). Pace = base delay / speedFactor, so a
// faster agent idles less and packs more round-trips into the window, but never
// below this floor so the RPC isn't hammered.
const RACE_MIN_DELAY_MS = Number(process.env.SCOUT_RACE_MIN_DELAY_MS ?? "60");
// Cap on concurrent on-chain calls across all lanes. Every agent still runs its
// own loop for the whole window; this only bounds how many swaps are in flight at
// once so a large field can't flood the RPC. Lanes queue at the semaphore and all
// still make progress.
const RACE_MAX_CONCURRENCY = Number(process.env.SCOUT_RACE_MAX_CONCURRENCY ?? "16");
// B6 streaming payments. A tier-3+ scout keeps a live price-feed subscription
// running while it trades: a real x402 micro-payment every few legs, surfaced
// as a STREAM row on the economy tape. Both gates below keep it from eating the
// swap race or the tier budget (paidAgentResearch enforces the budget too).
// SCOUT_STREAM_TICKS=0 disables it.
const STREAM_TICKS_MAX = Number(process.env.SCOUT_STREAM_TICKS ?? "2");
const STREAM_EVERY_LEGS = Number(process.env.SCOUT_STREAM_EVERY_LEGS ?? "5");
// A lane retires only after this many consecutive failed attempts, so one bad
// route or RPC blip doesn't end an agent after a single swap.
const RACE_MAX_STRIKES = Number(process.env.SCOUT_RACE_MAX_STRIKES ?? "3");

// B5 cross-chain bridging. A Scout op is occasionally a real one-way Arc -> Base
// CCTP bridge instead of a swap: it moves USDC cross-chain, counts toward the
// same volume score, and lands a BRIDGE row on the tape. It rides the same
// per-round cap (a bridge counts as a leg) and the same SIZE rules, but carries
// its own timing — the forwarder mints almost immediately, so the lane just
// waits for the burn to land. Off by default (fraction 0). When on, each post-
// swap iteration rolls SCOUT_BRIDGE_FRACTION to bridge instead of swap, capped at
// SCOUT_BRIDGE_MAX_PER_LANE per agent per event so the one-way outflow stays
// bounded (the autofunder keeps the Arc wallet topped up).
const SCOUT_BRIDGE_FRACTION = Number(process.env.SCOUT_BRIDGE_FRACTION ?? "0");
const SCOUT_BRIDGE_USDC = Number(process.env.SCOUT_BRIDGE_USDC ?? "2");
const SCOUT_BRIDGE_MAX_PER_LANE = Number(process.env.SCOUT_BRIDGE_MAX_PER_LANE ?? "2");
const SCOUT_BRIDGE_DEST_LABEL = process.env.SCOUT_BRIDGE_DEST_LABEL ?? "Base";

// Natural swap speed by tier (index 0..4). A higher tier doesn't just swap
// BIGGER, it swaps MORE inside the window. This is the "tier 4 wins by default"
// lever: a bare tier 4 naturally moves more volume than a bare tier 3, so traits
// and training tilt the odds for a lower tier without handing it the win.
const TIER_SPEED = [1.0, 1.2, 1.5, 1.9, 2.4] as const;
function tierSpeedFactor(tier: number): number {
  return TIER_SPEED[Math.max(0, Math.min(4, Math.floor(tier)))]!;
}
const raceSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/// Minimal counting semaphore: bounds how many lanes hold an on-chain slot at
/// once. acquire() resolves immediately if a slot is free, else queues FIFO;
/// release() hands the slot to the next waiter. Keeps the parallel race from
/// opening one RPC connection per entrant when the field is large.
class Semaphore {
  private slots: number;
  private readonly waiters: Array<() => void> = [];
  constructor(n: number) {
    this.slots = Math.max(1, n);
  }
  async acquire(): Promise<void> {
    if (this.slots > 0) {
      this.slots--;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }
  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.slots++;
  }
}

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
  sizeBoost = 1,
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
  if (targetLegs <= 0) {
    // Log WHY this agent will do 0 swaps so it's greppable instead of a silent
    // no-show (the "tier 4 never swapped" mystery). Daily budget spent.
    console.log(
      `[scout] agent ${agentId}: 0 swaps — daily budget spent (used ${config.scout.dailySwapCap - dailyRemaining}/${config.scout.dailySwapCap}; raise SCOUT_DAILY_SWAP_CAP)`,
    );
    return { privateKey, perSwapUsdc: 0, targetLegs: 0 };
  }

  // The principal recirculates each round-trip, so a flat gas buffer covers
  // every leg's gas; no need to scale the reserve by the full round count.
  const gasReserveUsdc = Number(process.env.SCOUT_GAS_RESERVE_USDC ?? "0.10");
  const spendableUsdc = Math.max(0, balanceUsdc - gasReserveUsdc * 3);
  // Per-swap size is the per-tier base (2 / 5 / 10 / 15 / 25 USDC) scaled by the
  // agent's trait size multiplier (sizeBoost), so a whale-type trait genuinely
  // buys a BIGGER trade, not just more of them. The wallet's spendable balance
  // and SCOUT_SWAP_MAX_USDC are the only clamps. The cap defaults to 100 so the
  // tier sizes and the whale boost both come through; it exists only to stop a
  // misconfigured value from draining a wallet, not to flatten the tiers (the
  // old default of 2 was doing exactly that, which is why traits had no effect).
  const swapMaxUsdc = Number(process.env.SCOUT_SWAP_MAX_USDC ?? "100");
  const perSwapUsdc = Math.min(swapSizeUsdc(tier) * sizeBoost, spendableUsdc, swapMaxUsdc);
  if (!(perSwapUsdc > 0)) {
    // The other 0-swap cause: hot wallet has no spendable USDC (funding missed
    // it, or it was swept and not re-funded).
    console.log(
      `[scout] agent ${agentId}: 0 swaps — hot wallet underfunded (balance ${balanceUsdc.toFixed(4)} USDC at ${account.address})`,
    );
  }
  return { privateKey, perSwapUsdc, targetLegs };
}

/// One real DEX swap: a single forward USDC -> EURC leg (one swap tx on Arc, one
/// row on the tape). Returns the landed leg plus the EURC it produced, so the
/// lane holds that EURC and its NEXT op swaps it back (EURC -> USDC). Alternating
/// single swaps — instead of an all-or-nothing round-trip — means each op is one
/// clean real swap with its own hash, so the field shows roughly twice as many
/// real swaps in the same window and a stranded reverse never wastes a turn.
/// When a DEX swap reverts, produce volume with a real USDC self-transfer
/// instead of leaving the agent at 0. Default ON (`SCOUT_SWAP_FALLBACK_TRANSFER`
/// != "0"). The Arc testnet USDC/EURC pool can be too thin or its route
/// unavailable, which reverts every swap in simulation; without this the whole
/// field moves 0 volume and the event cancels. A self-transfer is a plain
/// ERC-20 Transfer of the same size — real on-chain volume that never depends on
/// a pool — so events always fill and settle. Set to "0" to force swaps only.
const SWAP_FALLBACK_TRANSFER = process.env.SCOUT_SWAP_FALLBACK_TRANSFER !== "0";

/// One real USDC self-transfer leg: the pool-independent volume fallback. Funds
/// return to the wallet (only gas is spent), same as the v0 scout op.
async function selfTransferLeg(
  privateKey: `0x${string}`,
  usdcAmount: number,
): Promise<{ txHash: Hash; vol6: bigint } | null> {
  const amount6 = BigInt(Math.round(usdcAmount * 1e6));
  if (amount6 <= 0n) return null;
  try {
    const account = privateKeyToAccount(privateKey);
    const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(config.rpcHttp) });
    const hash = await wallet.writeContract({
      address: config.external.USDC,
      abi: USDC_ABI,
      functionName: "transfer",
      args: [account.address, amount6], // self-transfer: real Transfer event, only gas spent
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return { txHash: hash as Hash, vol6: amount6 };
  } catch (err) {
    console.warn(`[scout] self-transfer fallback failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

async function oneForwardSwap(
  privateKey: `0x${string}`,
  perSwapUsdc: number,
): Promise<{ leg: { txHash: Hash; vol6: bigint }; heldAlt: number } | null> {
  const usdc = config.scout.swapTokenIn;
  const alt = config.scout.swapTokenOut;
  const fwd = await executeSwap({ privateKey, tokenIn: usdc, tokenOut: alt, amountIn: perSwapUsdc.toFixed(6) });
  if (!fwd?.txHash) {
    // Swap reverted (thin/unavailable testnet pool). Produce volume anyway with
    // a real USDC self-transfer so the agent isn't stuck at 0 and the event
    // still fills and settles. No EURC is held, so nothing to swap back.
    if (!SWAP_FALLBACK_TRANSFER) return null;
    const t = await selfTransferLeg(privateKey, perSwapUsdc);
    return t ? { leg: t, heldAlt: 0 } : null;
  }
  const altOut = Number(fwd.amountOut);
  return {
    leg: { txHash: fwd.txHash as Hash, vol6: BigInt(Math.round(perSwapUsdc * 1e6)) },
    heldAlt: Number.isFinite(altOut) && altOut > 0 ? altOut : 0,
  };
}

interface RoundTrip {
  legs: Array<{ txHash: Hash; vol6: bigint }>;
  /// EURC left in the wallet when the forward leg landed but the reverse leg
  /// did not. The race loop swaps this back first next time so the principal
  /// returns to USDC and the agent can keep trading instead of stalling.
  heldAlt: number;
}

/// One USDC -> EURC -> USDC round-trip. Returns the legs that landed plus any
/// EURC stranded by a failed reverse, so the caller can recover it.
async function oneRoundTrip(privateKey: `0x${string}`, perSwapUsdc: number): Promise<RoundTrip> {
  const legs: RoundTrip["legs"] = [];
  const usdc = config.scout.swapTokenIn;
  const alt = config.scout.swapTokenOut;
  const fwd = await executeSwap({ privateKey, tokenIn: usdc, tokenOut: alt, amountIn: perSwapUsdc.toFixed(6) });
  if (!fwd) {
    // Forward swap reverted: fall back to a real USDC self-transfer so the round
    // still produces volume instead of stalling the agent at 0.
    if (!SWAP_FALLBACK_TRANSFER) return { legs, heldAlt: 0 };
    const t = await selfTransferLeg(privateKey, perSwapUsdc);
    if (t) legs.push(t);
    return { legs, heldAlt: 0 };
  }
  if (fwd.txHash) legs.push({ txHash: fwd.txHash as Hash, vol6: BigInt(Math.round(perSwapUsdc * 1e6)) });
  const altOut = Number(fwd.amountOut);
  if (Number.isFinite(altOut) && altOut > 0) {
    const rec = await swapAltBack(privateKey, altOut);
    if (rec) {
      legs.push(rec);
      return { legs, heldAlt: 0 };
    }
    // Forward landed, reverse failed: the wallet now holds altOut EURC.
    return { legs, heldAlt: altOut };
  }
  return { legs, heldAlt: 0 };
}

/// Swap a given amount of EURC back to USDC. Used both as the reverse leg of a
/// round-trip and as the recovery swap when a prior reverse failed. Returns the
/// landed leg or null.
async function swapAltBack(
  privateKey: `0x${string}`,
  altAmount: number,
): Promise<{ txHash: Hash; vol6: bigint } | null> {
  const usdc = config.scout.swapTokenIn;
  const alt = config.scout.swapTokenOut;
  const rev = await executeSwap({ privateKey, tokenIn: alt, tokenOut: usdc, amountIn: altAmount.toFixed(6) });
  if (!rev?.txHash) return null;
  const back = Number(rev.amountOut) > 0 ? Number(rev.amountOut) : altAmount;
  return { txHash: rev.txHash as Hash, vol6: BigInt(Math.round(back * 1e6)) };
}

interface ScoutPlan {
  entry: ContestEntryInput;
  account: Account;
  strategy: ScoutStrategy;
  strength: ReturnType<typeof effectiveStrength>;
  /// How fast this agent fires swaps (burst pace): tier natural speed x SPEED
  /// training x Velocity. Drives how much of its cap it reaches in the window.
  speedFactor: number;
  /// Per-swap size multiplier from whale-type traits (tier-scaled). Bigger
  /// trades, not just more of them.
  sizeBoost: number;
  /// Per-round swap cap (legs): flat default raised toward the ceiling by count
  /// traits, clamped to the tier op cap and the 1024/day budget.
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
      // Traits split into three concrete, tier-scaled scout levers: count traits
      // raise the swap CAP, Velocity raises PACE (speedMult), whale traits raise
      // per-swap SIZE (sizeMult). The right three for a volume round genuinely
      // change what the agent does on-chain, and a higher tier expresses each
      // more strongly.
      const { sizeMult, capMult, speedMult } = scoutTraitAbilities(equipped, e.tier);
      // Three levers, each grown by traits AND permanent training:
      //  - CAP (target): flat base for every tier, raised by count traits (to the
      //    trait ceiling) PLUS a permanent bump per completed training level. So a
      //    player who trains keeps swapping further every round, for good. Clamped
      //    to the overall ceiling, the tier op cap, and (at execution) the 1024/day
      //    budget.
      //  - SPEED (speedFactor): tier natural pace x SPEED training x Velocity.
      //  - SIZE (sizeBoost): whale traits x tier x permanent training multiplier,
      //    so a trained agent also moves bigger USDC per swap.
      const traitCap = Math.min(ROUND_SWAP_CAP_MAX, Math.round(ROUND_SWAP_CAP_DEFAULT * capMult));
      const trainCapBonus = totalTrainedLevels(stats) * SCOUT_TRAIN_CAP_PER_LEVEL;
      const perRoundCap = Math.min(
        limit.maxOps,
        ROUND_SWAP_CAP_CEIL,
        Math.max(ROUND_SWAP_CAP_DEFAULT, traitCap + trainCapBonus),
      );
      const speedFactor = tierSpeedFactor(e.tier) * scoutSpeedStatFactor(stats) * speedMult;
      plans.push({
        entry: e,
        account,
        strategy,
        strength,
        speedFactor,
        sizeBoost: sizeMult * strength.training,
        target: perRoundCap,
      });
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
          roundCap: p.target,
          speedFactor: Number(p.speedFactor.toFixed(3)),
          sizeBoost: Number(p.sizeBoost.toFixed(3)),
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
          // Cumulative USDC moved (6-dec string). The bars and the headline read
          // this so they match the standings, which rank by cumulative volume.
          // recentVolumes is only the last few txs (the tape) and must not be
          // summed for a total.
          volume6: exec.volumeUsdc6.toString(),
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
      tier: number;
      /// New-verb tape rows (STREAM subscription ticks) for this agent.
      events: TapeEvent[];
      streamTicks: number;
      /// Consecutive failed attempts. The lane retires only after a few, so a
      /// transient RPC blip or one bad route doesn't end the agent after a
      /// single swap.
      strikes: number;
      /// EURC stranded by a failed reverse leg, swapped back first next time.
      heldAlt: number;
      /// Pace: how fast this lane fires swaps relative to the field. Scales the
      /// inter-round idle, so a faster lane packs more round-trips into the window.
      speedFactor: number;
      /// One-way Arc -> Base bridges this lane has run (B5). Capped per lane so the
      /// outbound USDC stays bounded; each counts as a leg toward the round cap.
      bridges: number;
    }
    const lanes: Lane[] = [];
    for (const p of plans) {
      // p.target is the per-round swap cap (legs). prepareSwapAbility takes
      // round-trips and doubles, so halve it; the daily budget clamps it again.
      const ability = await prepareSwapAbility(
        p.entry.agentId,
        p.entry.tier,
        Math.ceil(p.target / 2),
        p.sizeBoost,
      ).catch(() => null);
      lanes.push({
        agentId: p.entry.agentId,
        operator: p.entry.operator,
        account: p.account,
        ability: ability && ability.perSwapUsdc > 0 ? ability : null,
        volume6: 0n,
        txHashes: [],
        txVolumes6: [],
        legs: 0,
        tier: p.entry.tier,
        events: [],
        streamTicks: 0,
        strikes: 0,
        heldAlt: 0,
        speedFactor: p.speedFactor,
        bridges: 0,
      });
    }

    // Trait-aware window: a field carrying swap traits (a raised cap or a high
    // pace) earns more wall-clock so those agents can spend the advantage, up to
    // RACE_CEIL_SECONDS and never past the resolve deadline. A bare field runs
    // the base RACE_MAX_SECONDS.
    const demand = plans.reduce(
      (m, p) => Math.max(m, p.speedFactor, p.target / ROUND_SWAP_CAP_DEFAULT),
      1,
    );
    const windowSeconds = Math.min(
      RACE_CEIL_SECONDS,
      Math.round(RACE_MAX_SECONDS + Math.max(0, demand - 1) * RACE_TRAIT_BONUS_SECONDS),
    );
    const hardStop = Math.min(ctx.deadlineMs ?? Number.MAX_SAFE_INTEGER, Date.now() + windowSeconds * 1000);
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
            // Cumulative USDC moved (6-dec string), so the bars and headline
            // match the standings instead of summing the short tape window.
            volume6: l.volume6.toString(),
            recent: l.txHashes.slice(-6).reverse().map((h) => h as string),
            recentVolumes: l.txVolumes6.slice(-6).reverse(),
            events: l.events.length > 0 ? l.events : undefined,
          },
        }));
      ctx.broadcast({ type: msgType, [idKey]: eventId, entries: ranked });
    };

    emit(); // initial frame so the stage shows the field before the first swap

    // Parallel lanes: every agent runs its own swap loop concurrently on its own
    // hot wallet (independent nonce), so the field swaps all at once and a slow
    // lane never starves a fast one. PACE scales the inter-round idle, so a higher
    // tier / SPEED-trained / Velocity lane idles less and packs more round-trips
    // into the window; the per-round CAP (targetLegs) stops the grinders; SIZE
    // sets the USDC per swap. Each landed leg broadcasts a frame so the tape fills.
    // A semaphore bounds how many on-chain calls run at once so a large field
    // can't flood the RPC; lanes queue at it but all keep making progress.
    const sem = new Semaphore(RACE_MAX_CONCURRENCY);
    const runLane = async (lane: Lane): Promise<void> => {
      if (!lane.ability) return;
      // Faster pace -> shorter idle between this lane's round-trips, floored so it
      // never hammers the RPC. Tier 4 / SPEED / Velocity sit near the floor.
      const laneDelay = Math.max(
        RACE_MIN_DELAY_MS,
        Math.round(RACE_INTER_ROUND_MS / Math.max(1, lane.speedFactor)),
      );
      const pushLegs = (legs: Array<{ txHash: Hash; vol6: bigint }>) => {
        for (const leg of legs) {
          lane.txHashes.push(leg.txHash);
          lane.txVolumes6.push(leg.vol6.toString());
          lane.volume6 += leg.vol6;
          lane.legs++;
        }
      };
      const strike = () => {
        lane.strikes++;
        if (lane.strikes >= RACE_MAX_STRIKES) lane.ability = null;
      };

      while (Date.now() < hardStop && lane.ability && lane.legs < lane.ability.targetLegs) {
        const ab = lane.ability;
        // Recover a stranded reverse first: the wallet holds EURC from a prior
        // failed reverse, so swap it back to USDC before the next forward, or the
        // agent stalls (no USDC to trade with). This keeps the swaps flowing.
        if (lane.heldAlt > 0) {
          await sem.acquire();
          let rec: { txHash: Hash; vol6: bigint } | null;
          try {
            rec = await swapAltBack(ab.privateKey, lane.heldAlt);
          } catch {
            rec = null;
          } finally {
            sem.release();
          }
          if (rec) {
            pushLegs([rec]);
            lane.heldAlt = 0;
            lane.strikes = 0;
            await recordSwaps(lane.agentId, 1).catch(() => {});
            emit();
          } else {
            strike();
          }
          await raceSleep(laneDelay);
          continue;
        }

        // B5: occasionally this op is a real one-way Arc -> Base bridge instead of
        // a swap. It moves USDC cross-chain (counts toward the same volume score),
        // counts as a leg against the round cap, and lands a BRIDGE tape row. Only
        // after at least one swap landed (wallet proven funded), bounded per lane,
        // and only when the wallet can spare the outbound amount.
        if (
          SCOUT_BRIDGE_FRACTION > 0 &&
          lane.bridges < SCOUT_BRIDGE_MAX_PER_LANE &&
          lane.legs > 0 &&
          ab.perSwapUsdc >= SCOUT_BRIDGE_USDC &&
          Math.random() < SCOUT_BRIDGE_FRACTION
        ) {
          await sem.acquire();
          let bridged: Awaited<ReturnType<typeof bridgeScoutLeg>>;
          try {
            bridged = await bridgeScoutLeg(ab.privateKey, SCOUT_BRIDGE_USDC);
          } catch {
            bridged = null;
          } finally {
            sem.release();
          }
          if (bridged) {
            lane.strikes = 0;
            lane.bridges++;
            // Count the moved USDC toward the volume score and the leg count, but
            // record it ONLY as a BRIDGE tape row (events[]), not in txHashes. The
            // scout tape derives a SWAP row per txHash, so pushing the bridge hash
            // there would collide with this BRIDGE row on tapeKey and could relabel
            // the bridge as a swap. Same separation B6's STREAM rows use.
            lane.volume6 += bridged.amount6;
            lane.legs++;
            lane.events.push({
              agentId: lane.agentId,
              verb: "BRIDGE",
              amount6: bridged.amount6.toString(),
              token: "USDC",
              txHash: bridged.txHash,
              chain: "arc",
              label: `Arc -> ${SCOUT_BRIDGE_DEST_LABEL} route`,
              ts: Date.now(),
            });
            await recordSwaps(lane.agentId, 1).catch(() => {});
            emit();
          } else {
            strike();
          }
          await raceSleep(laneDelay);
          continue;
        }

        // One real forward swap (USDC -> EURC). The heldAlt branch above swaps it
        // back on the next turn, so the lane alternates single REAL swaps — each
        // op is one swap tx with its own hash that arcscan shows as a real DEX
        // swap. A single swap (not an all-or-nothing round-trip) means a stranded
        // reverse never wastes a whole turn, so the field lands more real swaps in
        // the window. Slower than a transfer by design; the longer window gives
        // every agent time to stack several.
        await sem.acquire();
        let swapped: Awaited<ReturnType<typeof oneForwardSwap>>;
        try {
          swapped = await oneForwardSwap(ab.privateKey, ab.perSwapUsdc);
        } catch {
          swapped = null;
        } finally {
          sem.release();
        }
        if (!swapped) {
          // Nothing landed: take a strike and retire only after several, so a
          // transient RPC blip or one bad route doesn't end the agent.
          strike();
          await raceSleep(laneDelay);
          continue;
        }
        lane.strikes = 0;
        lane.heldAlt = swapped.heldAlt;
        pushLegs([swapped.leg]);
        await recordSwaps(lane.agentId, 1).catch(() => {});
        emit();

        // Streaming payment: a tier-3+ scout subscribes to a live price feed
        // while it trades, paying a real x402 micro-payment every few legs. The
        // tier + budget gates live inside paidAgentResearch (returns null when
        // the tier is too low or the pool is drained), and the leg / tick caps
        // keep it from slowing the swap race. Each settled tick is a STREAM row.
        if (
          STREAM_TICKS_MAX > 0 &&
          config.nanopay.scoutPriceEndpoint &&
          lane.streamTicks < STREAM_TICKS_MAX &&
          lane.legs % STREAM_EVERY_LEGS === 0
        ) {
          const sub = await paidAgentResearch({
            agentId: lane.agentId,
            contestId: ctx.source === "challenge" ? undefined : eventId,
            challengeId: ctx.source === "challenge" ? eventId : undefined,
            puzzleIdx: 100 + lane.streamTicks,
            tier: lane.tier,
            endpoint: buildPriceUrl(config.nanopay.scoutPriceEndpoint, ["ETH", "USDC"]),
            label: "live price feed",
            chain: config.nanopay.scoutPriceChain,
            summarize: summarizePrices,
          }).catch(() => null);
          if (sub?.txHash) {
            lane.events.push({
              agentId: lane.agentId,
              verb: "STREAM",
              amount6: sub.usdcAmount6.toString(),
              token: "USDC",
              txHash: sub.txHash,
              chain: config.nanopay.scoutPriceChain ?? "base",
              label: "live price feed",
              ts: Date.now(),
            });
            lane.streamTicks++;
            emit();
          }
        }

        await raceSleep(laneDelay);
      }
    };
    await Promise.all(lanes.map((lane) => runLane(lane).catch(() => {})));

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
