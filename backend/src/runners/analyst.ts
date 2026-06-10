import type { AgentResult, ContestEntryInput, Runner } from "./types.js";
import { clamp01, seededRng } from "./rng.js";
import { analystScore } from "../scoring/index.js";
import { generatePredictionQuestions, type PredictionQuestion } from "./predictions/oracle.js";
import { judgePrediction } from "./predictions/judge.js";
import { callModel, llmConfigured, recordLlmRun, readExistingRuns, DailyKillError } from "./llm/client.js";
import {
  resolveRuntimeParams,
  loadAgentStats,
  arcanaCapFor,
  type RuntimeParams,
} from "./llm/tierConfig.js";
import { effectiveStrength } from "../scoring/strength.js";
import { getLoadout } from "../auth/loadouts.js";
import { applyRouting } from "./solver.js";
import { pool, query } from "../db/pool.js";
import { config } from "../config/index.js";
import {
  getAgentWallet,
  getAgentUsdcBalance,
  getAgentUsdcAllowance,
} from "../lib/agentWallet.js";
import { maybeAutofundAgent } from "../lib/autofund.js";
import { usdcMinimalAbi, arcanaMarketsAbi } from "../chain/abi.js";
import { fetchPinnedArcanaMarkets } from "../lib/arcanaPins.js";
import { tickBudget } from "../scoring/prediction.js";
import {
  paidAgentResearch,
  sumAgentResearchSpend,
  newsKeywordFor,
  buildNewsUrl,
  summarizeNews,
} from "../nanopayments/research.js";

/// AnalystRunner: agents predict the answer to binary questions about live
/// Arc chain state (current block number, gas price, ArcRun contest count,
/// PrizeEscrow USDC balance, etc.) and are graded by Brier score.
///
/// Tier 0 / 1 random guess at p=0.5 (with a small luck nudge on tier 1).
/// Tier 2 reasons from priors with no tools. Tier 3 adds code_execution
/// (limited help for this kind). Tier 4 adds web_search: the model can look
/// up the live block explorer and answer near-perfectly, so tier 4 buys
/// real-time chain awareness in this contest type.
///
/// Fallback: when ANTHROPIC_API_KEY is unset, every agent falls back to
/// the synthetic curve from the previous implementation so local dev
/// without a paid API key still produces a sensible standings frame.

const FALLBACK_SKILL = [0.0, 0.2, 0.4, 0.6, 0.85];

/// How far into the future an Arcana market must resolve to qualify for an
/// Analyst contest. Markets resolving sooner than this aren't useful (we'd
/// pay for the trade then immediately resolve), markets resolving past this
/// don't pay out in time. Tuned for short contest windows; revisit when
/// durations stabilize.
const ARCANA_RESOLUTION_WINDOW_SEC = 60 * 60 * 24 * 7; // 7 days

/// How many open Arcana markets the contest pins per round. The runner caps
/// trades per agent by tier (arcanaCapFor); this caps the menu size.
const ARCANA_MARKETS_PER_ROUND = 5;

export class AnalystRunner implements Runner {
  readonly kind = "analyst" as const;
  constructor(private readonly questionCount = 5) {}

  async run(contestId: number, entries: ContestEntryInput[]): Promise<AgentResult[]> {
    // Prefer the contest's pinned set so every agent sees the same menu
    // and the round is deterministic. Falls back to the live "what's open
    // right now" pool when no pins exist (legacy contests opened before
    // pinning shipped, or non-pinned manual contests).
    let arcanaMarkets: OpenArcanaMarket[] = [];
    try {
      const pinned = await fetchPinnedArcanaMarkets(contestId);
      if (pinned.length > 0) {
        arcanaMarkets = pinned.map((m) => ({
          marketId: m.marketId,
          title: m.title,
          category: m.category,
          endTime: m.endTime,
          // Use entry pools from the pin snapshot so all agents in the
          // round price off the same prior. Live drift still shows in the
          // standings via `currentYesProb`.
          yesPool: m.entryYesPool,
          noPool: m.entryNoPool,
        }));
      } else {
        arcanaMarkets = await pickArcanaMarkets(ARCANA_MARKETS_PER_ROUND).catch(() => []);
      }
    } catch {
      arcanaMarkets = [];
    }

    if (arcanaMarkets.length > 0) {
      return runArcanaContest(contestId, entries, arcanaMarkets);
    }
    // No Arcana markets available. Default behavior: return empty results
    // so the coordinator cancels and refunds. Legacy synthetic Brier
    // fallback is gated behind ANALYST_ALLOW_SYNTHETIC for dev/no-Arcana
    // environments. The "empty results" path returns every entrant with
    // score 0 and a "no_arcana" marker so the live page can render the
    // waiting placeholder and settlement skips paying out.
    if (config.analyst.allowSyntheticFallback) {
      return runSyntheticContest(contestId, entries, this.questionCount);
    }
    return entries.map((e) => ({
      agentId: e.agentId,
      operator: e.operator,
      score: 0,
      detail: { source: "arcana_unavailable", marketsAvailable: 0 },
      progress: { kind: "analyst" as const, calls: [] },
    }));
  }
}

// ---------------------------------------------------------------------------
// Arcana-backed Analyst: real USDC trades on the Arcana Markets contract.
// ---------------------------------------------------------------------------

interface OpenArcanaMarket {
  marketId: bigint;
  title: string;
  category: string;
  endTime: bigint;
  yesPool: bigint;
  noPool: bigint;
}

/// Pick up to `limit` open markets that resolve inside our trading window.
/// Reads from arcana_markets (populated by the indexer + reconcile sweep)
/// so this stays a single DB query with no chain hop per round.
async function pickArcanaMarkets(limit: number): Promise<OpenArcanaMarket[]> {
  const { rows } = await query<{
    market_id: string;
    title: string;
    category: string;
    end_time: string;
    yes_pool: string;
    no_pool: string;
  }>(
    `select market_id, title, category,
            extract(epoch from end_time)::bigint::text as end_time,
            yes_pool, no_pool
       from arcana_markets
      where resolved = false
        and cancelled = false
        and end_time > now()
        and end_time < now() + interval '${ARCANA_RESOLUTION_WINDOW_SEC} seconds'
      order by end_time asc
      limit $1`,
    [limit],
  );
  return rows.map((r) => ({
    marketId: BigInt(r.market_id),
    title: r.title,
    category: r.category,
    endTime: BigInt(r.end_time),
    yesPool: BigInt(r.yes_pool),
    noPool: BigInt(r.no_pool),
  }));
}

function impliedYesProb(yesPool: bigint, noPool: bigint): number {
  const sum = yesPool + noPool;
  if (sum === 0n) return 0.5;
  return Number((yesPool * 10000n) / sum) / 10000;
}

/// Score for the Arcana branch: PnL across the agent's positions, expressed
/// as a non-negative integer so the existing applyRouting + payout merkle
/// logic doesn't need to handle negatives. Uses realized PnL when present
/// (the indexer writes it on MarketResolved) and falls back to marked-to-
/// market for still-open markets. Floor at 0 so an agent in the red still
/// surfaces in standings.
function arcanaScore(
  positions: Array<{
    stakeUsdc6: bigint;
    entryYesProb: number;
    currentYesProb: number;
    side: "yes" | "no";
    realizedPnlUsdc6?: bigint | null;
  }>,
): number {
  let pnlTotal = 0;
  for (const p of positions) {
    if (p.realizedPnlUsdc6 != null) {
      // Already resolved on chain. Trust the indexer's number.
      pnlTotal += Number(p.realizedPnlUsdc6);
      continue;
    }
    // Mark-to-market for open positions.
    const entryProb = p.side === "yes" ? p.entryYesProb : 1 - p.entryYesProb;
    const currentProb = p.side === "yes" ? p.currentYesProb : 1 - p.currentYesProb;
    if (entryProb <= 0) continue;
    const pnl = Number(p.stakeUsdc6) * (currentProb - entryProb) / entryProb;
    pnlTotal += pnl;
  }
  // Normalize: stake-weighted PnL is in USDC-6dec units. Scale so the score
  // sits in a comparable range to solver/scout (~hundreds to thousands).
  const score = pnlTotal / 1_000;
  return Math.max(0, Math.round(score));
}

async function runArcanaContest(
  contestId: number,
  entries: ContestEntryInput[],
  openMarkets: OpenArcanaMarket[],
): Promise<AgentResult[]> {
  const real = llmConfigured();
  return Promise.all(
    entries.map(async (e) => {
      const params = real ? await resolveRuntimeParams(e.agentId, e.tier).catch(() => null) : null;
      const positions = await runArcanaAgent(contestId, e, openMarkets, params);

      const stats = await loadAgentStats(e.agentId).catch(() => ({}));
      const equipped = await getLoadout("contest", contestId, e.agentId).catch(() => [] as string[]);
      const strength = effectiveStrength(e.tier, stats, equipped, "analyst");
      const rawScore = arcanaScore(positions);
      const finalScore = applyRouting(rawScore, strength, contestId * 1000 + e.agentId);

      // Calls array stays empty for the Arcana branch; the live stage uses
      // progress.arcana when present and falls back to calls when not. This
      // keeps the wire shape one union, no contest-flag bool needed.
      // Count tick budget + ticks used so the live stage shows "T 3/8"
      // per agent. Ticks consumed live in agent_decisions.
      const budget = tickBudget(e.tier, stats, equipped);
      const { rows: tickRows } = await query<{ n: string }>(
        `select count(*)::text as n from agent_decisions
          where agent_id = $1 and event_id = $2 and source = 'contest'`,
        [e.agentId, contestId],
      );
      const ticksUsed = Number(tickRows[0]?.n ?? 0);

      // Research spend happens in the tick scheduler (or the legacy pick
      // pass), so the scoring pass reads the audit rows back to surface
      // "this agent paid $X for news" on the live stage.
      const research = await sumAgentResearchSpend(contestId, e.agentId);

      return {
        agentId: e.agentId,
        operator: e.operator,
        score: finalScore,
        detail: {
          source: "arcana",
          marketsAvailable: openMarkets.length,
          marketsTraded: positions.length,
          rawScore,
          strength: {
            effective: Number(strength.effective.toFixed(2)),
            tierBase: strength.tierBase,
            training: Number(strength.training.toFixed(3)),
            traits: Number(strength.traits.toFixed(3)),
          },
        },
        progress: {
          kind: "analyst" as const,
          calls: [],
          ticksUsed,
          ticksBudget: budget,
          researchSpent6: research.total6 > 0n ? research.total6.toString() : undefined,
          researchLabel: research.total6 > 0n ? (research.label ?? undefined) : undefined,
          arcana: positions.map((p) => ({
            marketId: Number(p.marketId),
            title: p.title,
            side: p.side,
            stakeUsdc: p.stakeUsdc6.toString(),
            txHash: p.txHash ?? undefined,
            entryYesProb: Number(p.entryYesProb.toFixed(4)),
            currentYesProb: Number(p.currentYesProb.toFixed(4)),
            mtmPnLUsdc6: computeMtmPnl(p).toString(),
            resolved: p.resolved ?? false,
          })),
        },
      };
    }),
  );
}

function computeMtmPnl(p: {
  stakeUsdc6: bigint;
  entryYesProb: number;
  currentYesProb: number;
  side: "yes" | "no";
  realizedPnlUsdc6?: bigint | null;
}): bigint {
  if (p.realizedPnlUsdc6 != null) return p.realizedPnlUsdc6;
  const entryProb = p.side === "yes" ? p.entryYesProb : 1 - p.entryYesProb;
  const currentProb = p.side === "yes" ? p.currentYesProb : 1 - p.currentYesProb;
  if (entryProb <= 0) return 0n;
  const ratio = (currentProb - entryProb) / entryProb;
  return BigInt(Math.round(Number(p.stakeUsdc6) * ratio));
}

interface ArcanaPosition {
  marketId: bigint;
  title: string;
  side: "yes" | "no";
  stakeUsdc6: bigint;
  txHash?: string;
  entryYesProb: number;
  currentYesProb: number;
  /// Realized PnL in USDC 6-dec. Present once the market has resolved and
  /// the indexer has computed the payout for this position. null while the
  /// market is still open; arcanaScore falls back to marked-to-market.
  realizedPnlUsdc6?: bigint | null;
  /// Mirror of arcana_markets.resolved so the wire shape can show a "WON
  /// X USDC" badge instead of a mark-to-market estimate when applicable.
  resolved?: boolean;
}

/// Single-agent Arcana flow:
/// 1. Reuse positions already taken for this (contest, agent).
/// 2. Within the tier cap, ask the LLM to pick up to N more trades.
/// 3. Submit approve + buyShares for each pick. Persist agent_positions.
/// 4. Return the full position list (existing + new) for scoring + progress.
///
/// When tick mode is enabled (PREDICTION_TICKS=1, the default), this
/// function ONLY reads positions for scoring; trade creation lives
/// in the tick scheduler at coordinator/predictionTicks.ts. The runner
/// becomes a read-only scoring path; the scheduler owns position
/// generation. Set PREDICTION_TICKS=0 to revert to single-pass behavior.
async function runArcanaAgent(
  contestId: number,
  entry: ContestEntryInput,
  openMarkets: OpenArcanaMarket[],
  params: RuntimeParams | null,
): Promise<ArcanaPosition[]> {
  const cap = arcanaCapFor(entry.tier);
  if (cap.maxMarkets === 0) return [];

  // Existing positions for idempotency. If the preview pass already placed
  // trades, the live-window pass reads them back instead of re-trading.
  // Mapped to ArcanaPosition immediately so concat below stays one type.
  const stored = await readAgentPositions(contestId, entry.agentId);
  const existing: ArcanaPosition[] = stored.map((p) => {
    const market = openMarkets.find((om) => om.marketId === p.marketId);
    const currentYesProb = market ? impliedYesProb(market.yesPool, market.noPool) : p.entryYesProb;
    return {
      marketId: p.marketId,
      title: market?.title ?? p.title,
      side: p.side,
      stakeUsdc6: p.stakeUsdc6,
      txHash: p.txHash,
      entryYesProb: p.entryYesProb,
      currentYesProb,
      realizedPnlUsdc6: p.realizedPnlUsdc6,
      resolved: p.resolved,
    };
  });

  // Tick-mode gate: the tick scheduler is the single writer of new
  // positions. The runner just returns what's there at scoring time.
  if (config.analyst.predictionTicks) {
    return existing;
  }

  const traded = new Set(existing.map((p) => p.marketId.toString()));

  const slotsLeft = cap.maxMarkets - existing.length;
  const stakeLeft = cap.totalStakeUsdc6 - existing.reduce((acc, p) => acc + p.stakeUsdc6, 0n);
  if (slotsLeft <= 0 || stakeLeft <= 0n) return existing;

  const candidates = openMarkets.filter((m) => !traded.has(m.marketId.toString()));
  if (candidates.length === 0) return existing;

  // Pick trades. With LLM enabled, the model picks; without, fall back to a
  // deterministic "trade the first candidate at min stake" so the contest
  // still runs in dev without a paid API key.
  const picks = params?.llmEnabled
    ? await pickArcanaTrades(contestId, entry, candidates, cap, slotsLeft, stakeLeft, params)
    : fallbackPicks(candidates, cap, slotsLeft, stakeLeft);

  if (picks.length === 0) return existing;

  // Submit trades. Walk picks in order; stop early if we hit a balance issue.
  const newPositions: ArcanaPosition[] = [];
  const wallet = getAgentWallet(entry.agentId);
  if (!wallet) {
    // No hot-wallet infra configured (SCOUT_MASTER_MNEMONIC unset). Record
    // the intent so the stage shows the agent participated, but skip
    // the on-chain submission.
    return existing.concat(
      picks.map((pk) => ({
        marketId: pk.marketId,
        title: pk.title,
        side: pk.side,
        stakeUsdc6: pk.stakeUsdc6,
        entryYesProb: pk.entryYesProb,
        currentYesProb: pk.entryYesProb,
      })),
    );
  }

  // Read balance, then ask the autofund module to drip if needed. The
  // module enforces per-agent + global daily caps and is a no-op when the
  // agent already has enough. Re-read balance after if it dripped so the
  // approve/buyShares math reflects the topped-up balance.
  let balance = await getAgentUsdcBalance(entry.agentId);
  const drip = await maybeAutofundAgent({
    agentId: entry.agentId,
    tier: entry.tier,
    operator: entry.operator,
    hotWalletAddress: wallet.address,
    currentBalanceUsdc6: balance,
  }).catch((err) => {
    console.error(`autofund threw for agent ${entry.agentId}: ${err instanceof Error ? err.message : err}`);
    return { txHash: null, reason: "error" } as const;
  });
  if (drip.reason === "ok") {
    balance = await getAgentUsdcBalance(entry.agentId);
  }

  if (balance === 0n) {
    // Surfaces "skipped: unfunded hot wallet" in the audit. We still record
    // intent positions so the live page shows the agent on the stage.
    return existing.concat(
      picks.map((pk) => ({
        marketId: pk.marketId,
        title: pk.title,
        side: pk.side,
        stakeUsdc6: pk.stakeUsdc6,
        entryYesProb: pk.entryYesProb,
        currentYesProb: pk.entryYesProb,
      })),
    );
  }

  // Approve once for the total of all picks if allowance is short. Cheaper
  // than approving per trade.
  const totalNeeded = picks.reduce((acc, p) => acc + p.stakeUsdc6, 0n);
  const allowance = await getAgentUsdcAllowance(entry.agentId, config.arcana.address);
  if (allowance < totalNeeded) {
    try {
      await wallet.writeContract({
        address: config.external.USDC,
        abi: usdcMinimalAbi,
        functionName: "approve",
        args: [config.arcana.address, totalNeeded],
      });
    } catch (err) {
      console.error(`arcana approve failed for agent ${entry.agentId}: ${err instanceof Error ? err.message : err}`);
      return existing;
    }
  }

  // Place each trade. Per-trade failures don't abort the others.
  let walletBalance = balance;
  for (const pick of picks) {
    if (pick.stakeUsdc6 > walletBalance) continue;
    try {
      const hash = await wallet.writeContract({
        address: config.arcana.address,
        abi: arcanaMarketsAbi,
        functionName: "buyShares",
        args: [pick.marketId, pick.side === "yes", pick.stakeUsdc6],
      });
      walletBalance -= pick.stakeUsdc6;
      // Pre-write the position. SharesBought event from the indexer will
      // fill in tx_hash and block_number; we ALSO set tx_hash here so the
      // live frame on the very next standings broadcast has it without
      // waiting for the indexer round-trip.
      await insertAgentPosition({
        contestId,
        agentId: entry.agentId,
        operator: entry.operator,
        marketId: pick.marketId,
        side: pick.side,
        stakeUsdc6: pick.stakeUsdc6,
        entryYesPool: pick.entryYesPool,
        entryNoPool: pick.entryNoPool,
        txHash: hash,
      });
      newPositions.push({
        marketId: pick.marketId,
        title: pick.title,
        side: pick.side,
        stakeUsdc6: pick.stakeUsdc6,
        txHash: hash,
        entryYesProb: pick.entryYesProb,
        currentYesProb: pick.entryYesProb,
      });
    } catch (err) {
      console.error(`arcana buyShares failed (agent ${entry.agentId}, market ${pick.marketId}): ${err instanceof Error ? err.message : err}`);
    }
  }

  return existing.concat(newPositions);
}

interface ArcanaPick {
  marketId: bigint;
  title: string;
  side: "yes" | "no";
  stakeUsdc6: bigint;
  entryYesProb: number;
  entryYesPool: bigint;
  entryNoPool: bigint;
}

function fallbackPicks(
  candidates: OpenArcanaMarket[],
  cap: { maxMarkets: number; maxStakeUsdc6: bigint; totalStakeUsdc6: bigint },
  slotsLeft: number,
  stakeLeft: bigint,
): ArcanaPick[] {
  const picks: ArcanaPick[] = [];
  let remaining = stakeLeft;
  for (let i = 0; i < Math.min(slotsLeft, candidates.length); i++) {
    const m = candidates[i]!;
    const stake = cap.maxStakeUsdc6 < remaining ? cap.maxStakeUsdc6 : remaining;
    if (stake <= 0n) break;
    const entryYesProb = impliedYesProb(m.yesPool, m.noPool);
    picks.push({
      marketId: m.marketId,
      title: m.title,
      side: entryYesProb < 0.5 ? "yes" : "no", // contrarian default
      stakeUsdc6: stake,
      entryYesProb,
      entryYesPool: m.yesPool,
      entryNoPool: m.noPool,
    });
    remaining -= stake;
  }
  return picks;
}

async function pickArcanaTrades(
  contestId: number,
  entry: ContestEntryInput,
  candidates: OpenArcanaMarket[],
  cap: { maxMarkets: number; maxStakeUsdc6: bigint; totalStakeUsdc6: bigint },
  slotsLeft: number,
  stakeLeft: bigint,
  params: RuntimeParams,
): Promise<ArcanaPick[]> {
  // Cap the menu size we hand the model so the prompt stays small. We
  // already capped to ARCANA_MARKETS_PER_ROUND upstream; clamp again here.
  const menu = candidates.slice(0, Math.max(slotsLeft, 1));
  const menuLines = menu
    .map((m, i) => {
      const yesProb = impliedYesProb(m.yesPool, m.noPool);
      return `${i + 1}. id=${m.marketId} title="${m.title}" yes=${(yesProb * 100).toFixed(0)}% no=${((1 - yesProb) * 100).toFixed(0)}%`;
    })
    .join("\n");
  const maxPerMarketUsd = Number(cap.maxStakeUsdc6) / 1_000_000;
  const totalUsd = Number(stakeLeft) / 1_000_000;

  const systemPrompt = [
    "You are an ArcRun analyst trading binary prediction markets on Arcana.",
    "You pick up to N markets, each with a YES or NO side and a USDC stake.",
    `Hard cap: ${maxPerMarketUsd} USDC per market, ${totalUsd} USDC total across all picks.`,
    "Output one line per pick in EXACTLY this format:",
    "PICK <market_id> <YES|NO> <stake_usdc>",
    "End with one line: DONE",
  ].join(" ");

  // Tier-gated paid news pull (same mechanic as the tick scheduler) for
  // the legacy single-pass path. Null means trade on priors alone.
  let newsBlock = "";
  if (config.nanopay.analystNewsEndpoint) {
    const keyword = newsKeywordFor(menu.map((m) => m.title));
    const research = await paidAgentResearch({
      agentId: entry.agentId,
      contestId,
      puzzleIdx: 0,
      tier: entry.tier,
      endpoint: buildNewsUrl(config.nanopay.analystNewsEndpoint, keyword),
      label: config.nanopay.analystNewsLabel,
      chain: config.nanopay.analystNewsChain,
      summarize: summarizeNews,
    }).catch(() => null);
    if (research) {
      newsBlock = `NEWS (${research.label}, keyword "${keyword}"):\n${research.summary}\n`;
    }
  }

  const userPrompt = [
    newsBlock,
    `Open markets you may trade (${menu.length}):`,
    menuLines,
    `Pick at most ${slotsLeft} markets. Be selective: pass on a market by not picking it.`,
  ].filter(Boolean).join("\n");

  let response = "";
  let verdict: "correct" | "wrong" | "skipped" | "error" = "correct";
  let latencyMs = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cost = 0;
  try {
    const res = await callModel({
      model: params.model,
      systemPrompt,
      userPrompt,
      maxTokens: Math.min(params.maxTokens, 600),
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

  // The "answer" for the Arcana branch is a compact summary of the picks
  // the LLM made. Resolves later when the picks parse below; we set it
  // pre-parse using the raw lines so audit + live cell stay populated even
  // if no picks survive validation.
  const picks = verdict === "correct"
    ? parseArcanaPicks(response, menu, cap, slotsLeft, stakeLeft)
    : [];
  const answerSummary = picks.length > 0
    ? picks.map((p) => `${p.side.toUpperCase()} #${p.marketId} $${(Number(p.stakeUsdc6) / 1e6).toFixed(2)}`).join(" · ")
    : (verdict === "skipped" || verdict === "error") ? null : "no picks";

  await recordLlmRun({
    contestId,
    agentId: entry.agentId,
    operator: entry.operator,
    roundIdx: 0,
    puzzleIdx: 0,
    kind: "analyst",
    model: params.model,
    prompt: userPrompt,
    response,
    expected: null,
    answer: answerSummary,
    verdict,
    latencyMs,
    inputTokens,
    outputTokens,
    costUsd: cost,
  }).catch(() => { /* audit row best-effort */ });

  return picks;
}

const PICK_LINE = /^\s*PICK\s+(\d+)\s+(YES|NO)\s+(\d+(?:\.\d+)?)/i;

function parseArcanaPicks(
  text: string,
  menu: OpenArcanaMarket[],
  cap: { maxStakeUsdc6: bigint; totalStakeUsdc6: bigint },
  slotsLeft: number,
  stakeLeft: bigint,
): ArcanaPick[] {
  const byId = new Map(menu.map((m) => [m.marketId.toString(), m]));
  const picks: ArcanaPick[] = [];
  const seen = new Set<string>();
  let remaining = stakeLeft;

  for (const line of text.split("\n")) {
    if (picks.length >= slotsLeft) break;
    const m = line.match(PICK_LINE);
    if (!m) continue;
    const id = m[1]!;
    const side = (m[2]!.toLowerCase() as "yes" | "no");
    const stakeUsd = Number(m[3]!);
    if (!Number.isFinite(stakeUsd) || stakeUsd <= 0) continue;
    if (seen.has(id)) continue;
    const market = byId.get(id);
    if (!market) continue;

    let stake6 = BigInt(Math.floor(stakeUsd * 1_000_000));
    if (stake6 > cap.maxStakeUsdc6) stake6 = cap.maxStakeUsdc6;
    if (stake6 > remaining) stake6 = remaining;
    if (stake6 <= 0n) continue;

    const entryYesProb = impliedYesProb(market.yesPool, market.noPool);
    picks.push({
      marketId: market.marketId,
      title: market.title,
      side,
      stakeUsdc6: stake6,
      entryYesProb,
      entryYesPool: market.yesPool,
      entryNoPool: market.noPool,
    });
    seen.add(id);
    remaining -= stake6;
    if (remaining <= 0n) break;
  }
  return picks;
}

interface StoredPosition {
  marketId: bigint;
  side: "yes" | "no";
  stakeUsdc6: bigint;
  entryYesPool: bigint;
  entryNoPool: bigint;
  entryYesProb: number;
  currentYesProb: number;
  txHash?: string;
  title: string;
  realizedPnlUsdc6?: bigint | null;
  resolved: boolean;
}

async function readAgentPositions(
  contestId: number,
  agentId: number,
): Promise<StoredPosition[]> {
  const { rows } = await query<{
    market_id: string;
    side: "yes" | "no";
    stake_usdc: string;
    entry_yes_pool: string;
    entry_no_pool: string;
    tx_hash: string | null;
    pnl_usdc: string | null;
    title: string | null;
    resolved: boolean | null;
  }>(
    `select ap.market_id, ap.side, ap.stake_usdc, ap.entry_yes_pool, ap.entry_no_pool,
            ap.tx_hash, ap.pnl_usdc, m.title, m.resolved
       from agent_positions ap
       left join arcana_markets m on m.market_id = ap.market_id
      where ap.contest_id = $1 and ap.agent_id = $2`,
    [contestId, agentId],
  );
  return rows.map((r) => {
    const entryYesPool = BigInt(r.entry_yes_pool);
    const entryNoPool = BigInt(r.entry_no_pool);
    const entryYesProb = impliedYesProb(entryYesPool, entryNoPool);
    return {
      marketId: BigInt(r.market_id),
      side: r.side,
      stakeUsdc6: BigInt(r.stake_usdc),
      entryYesPool,
      entryNoPool,
      entryYesProb,
      currentYesProb: entryYesProb,
      txHash: r.tx_hash ?? undefined,
      title: r.title ?? "",
      realizedPnlUsdc6: r.pnl_usdc != null ? BigInt(r.pnl_usdc) : null,
      resolved: r.resolved ?? false,
    };
  });
}

async function insertAgentPosition(p: {
  contestId: number;
  agentId: number;
  operator: `0x${string}`;
  marketId: bigint;
  side: "yes" | "no";
  stakeUsdc6: bigint;
  entryYesPool: bigint;
  entryNoPool: bigint;
  txHash: string;
}) {
  await pool.query(
    `insert into agent_positions
       (contest_id, agent_id, operator, market_id, side, stake_usdc,
        entry_yes_pool, entry_no_pool, tx_hash)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      p.contestId,
      p.agentId,
      p.operator,
      p.marketId.toString(),
      p.side,
      p.stakeUsdc6.toString(),
      p.entryYesPool.toString(),
      p.entryNoPool.toString(),
      p.txHash,
    ],
  );
}

// ---------------------------------------------------------------------------
// Synthetic fallback: keeps contests running when Arcana has no markets.
// ---------------------------------------------------------------------------

async function runSyntheticContest(
  contestId: number,
  entries: ContestEntryInput[],
  questionCount: number,
): Promise<AgentResult[]> {
  let questions: PredictionQuestion[] = [];
  try {
    questions = await generatePredictionQuestions(contestId, questionCount);
  } catch {
    questions = [];
  }
  const real = llmConfigured() && questions.length > 0;

  return Promise.all(
    entries.map(async (e) => {
      const params = real ? await resolveRuntimeParams(e.agentId, e.tier).catch(() => null) : null;
      const predictions = params
        ? await runRealAnalyst(contestId, e, questions, params)
        : simulatePredictions(questions, e.tier, contestId * 1000 + e.agentId);

      const calls = predictions.map((p) => ({
        p: Number(p.p.toFixed(3)),
        outcome: p.outcome,
        correct: (p.p >= 0.5 ? 1 : 0) === p.outcome,
      }));

      const stats = await loadAgentStats(e.agentId).catch(() => ({}));
      const equipped = await getLoadout("contest", contestId, e.agentId).catch(() => [] as string[]);
      const strength = effectiveStrength(e.tier, stats, equipped, "analyst");
      const rawScore = analystScore(predictions);
      const finalScore = applyRouting(rawScore, strength, contestId * 1000 + e.agentId);

      return {
        agentId: e.agentId,
        operator: e.operator,
        score: finalScore,
        detail: {
          source: "synthetic",
          questions: questions.length,
          rawScore,
          strength: {
            effective: Number(strength.effective.toFixed(2)),
            tierBase: strength.tierBase,
            training: Number(strength.training.toFixed(3)),
            traits: Number(strength.traits.toFixed(3)),
          },
        },
        progress: { kind: "analyst" as const, calls },
      };
    }),
  );
}

interface CallOutcome {
  p: number;
  outcome: 0 | 1;
}

async function runRealAnalyst(
  contestId: number,
  entry: ContestEntryInput,
  questions: PredictionQuestion[],
  params: RuntimeParams,
): Promise<CallOutcome[]> {
  // Idempotent across preview passes: if we already have audit rows for
  // this (contest, agent), reconstruct predictions from the persisted
  // verdicts so the live-window passes don't burn budget.
  const cached = await readExistingRuns(contestId, entry.agentId, "analyst").catch(() => []);
  if (cached.length >= questions.length) {
    return questions.map((q, i) => {
      const row = cached.find((r) => r.puzzleIdx === i);
      const correct = row?.verdict === "correct";
      // p = 0.7 toward the truth on hits, away on misses. Good enough
      // for reconstruction; the actual p was already captured into
      // analystScore via the original pass.
      const p = correct ? (q.outcome === 1 ? 0.7 : 0.3) : (q.outcome === 1 ? 0.3 : 0.7);
      return { p, outcome: q.outcome };
    });
  }

  const out: CallOutcome[] = [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]!;
    const systemPrompt = buildSystemPrompt(params);
    const userPrompt = `${q.prompt}\nReply with YES or NO followed by your confidence as a decimal between 0.5 and 1.0. Example: "YES 0.8"`;

    let response = "";
    let p = 0.5;
    let verdict: "correct" | "wrong" | "skipped" | "error" = "skipped";
    let latencyMs = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let cost = 0;

    if (!params.llmEnabled) {
      // Tier 0/1 random guess. LUCK nudges toward the right side a bit so
      // the score isn't pure noise.
      const r = seededRng(contestId * 1000 + entry.agentId + i);
      const truthBias = params.luckBonus;
      const guessYes = r() < 0.5 + (q.outcome === 1 ? truthBias : -truthBias);
      p = guessYes ? 0.55 : 0.45;
      response = guessYes ? "guess YES" : "guess NO";
      latencyMs = 800 + Math.round(400 * r());
      verdict = (p >= 0.5 ? 1 : 0) === q.outcome ? "correct" : "wrong";
    } else {
      const attempts = 1 + params.retries;
      for (let attempt = 0; attempt < attempts; attempt++) {
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
          latencyMs += res.latencyMs;
          inputTokens += res.inputTokens;
          outputTokens += res.outputTokens;
          cost += res.costUsd;

          const j = judgePrediction(q, res.text);
          p = j.p;
          verdict = j.correct ? "correct" : "wrong";
          break;
        } catch (err) {
          verdict = "error";
          response = err instanceof Error ? err.message : String(err);
          if (err instanceof DailyKillError) {
            verdict = "skipped";
            break;
          }
        }
      }
    }

    out.push({ p, outcome: q.outcome });

    // Synthetic-branch answer: YES/NO call with the confidence the parser
    // extracted. p > 0.5 means YES, p < 0.5 means NO. Always populated so
    // the live cell shows just the call instead of the reasoning prefix.
    const call = p >= 0.5 ? "YES" : "NO";
    const conf = p >= 0.5 ? p : 1 - p;
    const answer = verdict === "skipped" || verdict === "error"
      ? null
      : `${call} ${conf.toFixed(2)}`;

    await recordLlmRun({
      contestId,
      agentId: entry.agentId,
      operator: entry.operator,
      roundIdx: 0,
      puzzleIdx: i,
      kind: "analyst",
      model: params.llmEnabled ? params.model : "guess",
      prompt: `${q.prompt}\n[snapshot: ${q.snapshot}]`,
      response,
      expected: q.outcome === 1 ? "YES" : "NO",
      answer,
      verdict,
      latencyMs,
      inputTokens,
      outputTokens,
      costUsd: cost,
    }).catch(() => { /* audit row best-effort */ });
  }

  return out;
}

function buildSystemPrompt(params: RuntimeParams): string {
  const lines = [
    "You are an ArcRun analyst agent predicting a YES/NO question about the Arc Testnet blockchain.",
    "Reply with exactly one line: YES or NO, followed by your confidence as a decimal between 0.5 and 1.0.",
    "Example: YES 0.85",
  ];
  if (params.tools.some((t) => t.name === "web_search")) {
    lines.push(
      "Use web_search to look up the current Arc Testnet state (block number, gas price, ArcRun contest count, etc.) before answering. Arc Testnet's block explorer lives at testnet.arcscan.app.",
    );
  } else if (params.tools.some((t) => t.name === "code_execution")) {
    lines.push("You may use code_execution for arithmetic but it cannot query live chain state. Reason from priors.");
  }
  lines.push("The LAST line of your output must be exactly: YES <conf> or NO <conf>");
  return lines.join(" ");
}

function simulatePredictions(
  questions: PredictionQuestion[],
  tier: number,
  seed: number,
): CallOutcome[] {
  const r = seededRng(seed);
  const skill = FALLBACK_SKILL[Math.min(Math.max(tier, 0), 4)]!;
  return questions.map((q) => {
    const truth = q.outcome;
    const p = clamp01(0.5 * (1 - skill) + truth * skill + (r() - 0.5) * 0.2);
    return { p, outcome: truth };
  });
}

/// Kept for back-compat with code that imported `generateQuestions` from
/// this module. Returns synthetic Question[] (not chain-backed). New code
/// should use generatePredictionQuestions from ./predictions/oracle.
export function generateQuestions(seed: number, count: number): Array<{ baseRate: number; outcome: 0 | 1 }> {
  const r = seededRng(seed);
  return Array.from({ length: count }, () => {
    const baseRate = 0.2 + r() * 0.6;
    const outcome: 0 | 1 = r() < baseRate ? 1 : 0;
    return { baseRate, outcome };
  });
}
