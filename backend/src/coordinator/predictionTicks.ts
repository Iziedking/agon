import { parseAbi } from "viem";
import { pool, query } from "../db/pool.js";
import { config } from "../config/index.js";
import { publicClient } from "../chain/arc.js";

/// Minimal ABI to read a contest's on-chain end time (the DB doesn't store it).
const contestEndAbi = parseAbi([
  "function getContest(uint256 contestId) view returns ((uint8 contestType,uint8 status,uint16 winnerCutBps,uint16 topN,uint16 platformFeeBps,address sponsor,address protocolTarget,bytes32 metric,uint64 startTime,uint64 endTime,uint256 prizePool,bytes32 finalRoot))",
]);
import { usdcMinimalAbi, arcanaMarketsAbi } from "../chain/abi.js";
import { fetchPinnedArcanaMarkets } from "../lib/arcanaPins.js";
import {
  getAgentWallet,
  getAgentUsdcBalance,
  getAgentUsdcAllowance,
} from "../lib/agentWallet.js";
import { maybeAutofundAgent } from "../lib/autofund.js";
import { callModel, llmConfigured, DailyKillError } from "../runners/llm/client.js";
import {
  resolveRuntimeParams,
  loadAgentStats,
  arcanaCapFor,
} from "../runners/llm/tierConfig.js";
import { getLoadout } from "../auth/loadouts.js";
import {
  tickBudget,
  hedgeCostMultiplier,
  impliedYesProb,
} from "../scoring/prediction.js";
import {
  paidAgentResearch,
  newsKeywordFor,
  buildNewsUrl,
  summarizeNews,
} from "../nanopayments/research.js";

/// Tick-driven prediction model.
///
/// Each agent gets `tickBudget(tier, stats, equipped)` decisions across the
/// trade window. Time-driven: the scheduler wakes every TICK_INTERVAL_SEC,
/// walks open events, and fires one tick per agent whose next-tick-at has
/// elapsed.
///
/// Settlement reads positions from `agent_positions` (the existing table)
/// and scores via `computePredictionPayouts` in scoring/prediction.ts. The
/// existing analyst runner still works for back-compat when tick mode is
/// disabled; with tick mode on, the runner just gates and returns existing
/// positions for scoring without firing new LLM calls.

/// Action surface the LLM picks per tick.
type TickAction = "OPEN_YES" | "OPEN_NO" | "HEDGE_YES" | "HEDGE_NO" | "HOLD";

const TICK_ACTIONS: TickAction[] = ["OPEN_YES", "OPEN_NO", "HEDGE_YES", "HEDGE_NO", "HOLD"];

export interface TickContext {
  source: "contest" | "challenge";
  eventId: number;
  agentId: number;
  operator: `0x${string}`;
  tier: number;
  /// Window-end epoch ms. Used to pace ticks evenly.
  endsAtMs: number;
}

export interface TickOutcome {
  tickIdx: number;
  action: TickAction;
  marketId: number | null;
  stakeUsdc6: bigint | null;
  txHash: string | null;
  rationale: string;
}

/// Count how many ticks an agent has used on a given event.
async function countTicks(source: string, eventId: number, agentId: number): Promise<number> {
  const { rows } = await query<{ n: string }>(
    `select count(*)::text as n from agent_decisions
      where source = $1 and event_id = $2 and agent_id = $3`,
    [source, eventId, agentId],
  );
  return Number(rows[0]?.n ?? 0);
}

/// Read the agent's prior decisions on this event so the LLM has lookback
/// context. FOCUS stat governs how many we surface.
async function priorDecisions(
  source: string,
  eventId: number,
  agentId: number,
  limit: number,
): Promise<Array<{ tick_idx: number; action: string; market_id: string | null; stake_usdc: string | null }>> {
  const { rows } = await query<{
    tick_idx: number;
    action: string;
    market_id: string | null;
    stake_usdc: string | null;
  }>(
    `select tick_idx, action, market_id, stake_usdc::text
       from agent_decisions
      where source = $1 and event_id = $2 and agent_id = $3
      order by tick_idx desc limit $4`,
    [source, eventId, agentId, Math.max(1, limit)],
  );
  return rows.reverse();
}

/// When did this agent last tick on this event? Returns 0 if never.
async function lastTickAt(source: string, eventId: number, agentId: number): Promise<number> {
  const { rows } = await query<{ ts: string }>(
    `select coalesce(max(extract(epoch from decided_at) * 1000)::bigint, 0)::text as ts
       from agent_decisions
      where source = $1 and event_id = $2 and agent_id = $3`,
    [source, eventId, agentId],
  );
  return Number(rows[0]?.ts ?? 0);
}

/// Has this agent already taken a position on the given market? Drives
/// HEDGE eligibility (you can only HEDGE if you have an OPEN to hedge).
async function existingSidesOnMarket(
  eventId: number,
  agentId: number,
  marketId: number,
): Promise<{ yes: bigint; no: bigint }> {
  const { rows } = await query<{ side: string; total: string }>(
    `select side, sum(stake_usdc)::text as total
       from agent_positions
      where contest_id = $1 and agent_id = $2 and market_id = $3
      group by side`,
    [eventId, agentId, marketId],
  );
  let yes = 0n;
  let no = 0n;
  for (const r of rows) {
    if (r.side === "yes") yes += BigInt(r.total);
    if (r.side === "no") no += BigInt(r.total);
  }
  return { yes, no };
}

/// Compute when this agent's next tick should fire, in epoch ms. Splits
/// remaining wall-clock evenly across remaining ticks.
function nextTickAtMs(
  endsAtMs: number,
  ticksUsed: number,
  budget: number,
  lastTickMs: number,
): number {
  const ticksRemaining = Math.max(1, budget - ticksUsed);
  const nowMs = Date.now();
  const timeRemaining = Math.max(0, endsAtMs - nowMs);
  const stride = timeRemaining / ticksRemaining;
  // Anchor: spread evenly from last tick (or now if never ticked).
  const anchor = lastTickMs > 0 ? lastTickMs : nowMs;
  return anchor + stride;
}

interface AgentEligibility {
  ticksUsed: number;
  budget: number;
  dueAtMs: number;
  fewShotCount: number;
  equippedTraits: string[];
}

async function checkEligibility(ctx: TickContext): Promise<AgentEligibility | null> {
  const stats = await loadAgentStats(ctx.agentId).catch(() => ({} as Record<string, number>));
  const equipped = await getLoadout(ctx.source, ctx.eventId, ctx.agentId).catch(() => [] as string[]);
  const budget = tickBudget(ctx.tier, stats, equipped);
  if (budget === 0) return null;
  const ticksUsed = await countTicks(ctx.source, ctx.eventId, ctx.agentId);
  if (ticksUsed >= budget) return null;
  const last = await lastTickAt(ctx.source, ctx.eventId, ctx.agentId);
  const due = nextTickAtMs(ctx.endsAtMs, ticksUsed, budget, last);
  // FOCUS stat governs lookback prompt depth (3 base + 1 per 3 levels, max 10)
  const focus = (stats as { FOCUS?: number }).FOCUS ?? 0;
  const fewShotCount = Math.max(3, Math.min(10, 3 + Math.floor(focus / 3)));
  return { ticksUsed, budget, dueAtMs: due, fewShotCount, equippedTraits: equipped };
}

/// Fire one tick for one agent. Returns null if the agent is ineligible
/// (no budget, no ticks remaining, or no LLM key + tier > 0 wants LLM).
export async function fireAgentTick(ctx: TickContext): Promise<TickOutcome | null> {
  const eligibility = await checkEligibility(ctx);
  if (!eligibility) return null;
  if (Date.now() < eligibility.dueAtMs) return null;

  const pinned = await fetchPinnedArcanaMarkets(ctx.eventId);
  if (pinned.length === 0) {
    // Nothing to trade on; skip without recording (next tick may have
    // markets if Arcana ships some mid-window).
    return null;
  }

  const cap = arcanaCapFor(ctx.tier);
  if (cap.maxMarkets === 0) return null;

  const params = llmConfigured()
    ? await resolveRuntimeParams(ctx.agentId, ctx.tier).catch(() => null)
    : null;

  // Build prompt. Show current pools, agent's existing exposure per
  // market, and the agent's recent decisions for context.
  const marketLines: string[] = [];
  for (const m of pinned) {
    const sides = await existingSidesOnMarket(ctx.eventId, ctx.agentId, Number(m.marketId));
    const entryYesProb = impliedYesProb(m.entryYesPool, m.entryNoPool);
    const heldYes = Number(sides.yes) / 1e6;
    const heldNo = Number(sides.no) / 1e6;
    marketLines.push(
      `id=${m.marketId} "${m.title}" yes=${(entryYesProb * 100).toFixed(0)}% your_yes=$${heldYes.toFixed(2)} your_no=$${heldNo.toFixed(2)}`,
    );
  }
  const prior = await priorDecisions(ctx.source, ctx.eventId, ctx.agentId, eligibility.fewShotCount);
  const priorLines = prior.length === 0
    ? ["(no prior decisions this round)"]
    : prior.map((p) => `t${p.tick_idx}: ${p.action}${p.market_id ? ` market=${p.market_id}` : ""}${p.stake_usdc ? ` stake=$${(Number(p.stake_usdc) / 1e6).toFixed(2)}` : ""}`);

  const maxStakeUsd = Number(cap.maxStakeUsdc6) / 1_000_000;

  const systemPrompt = [
    "You are an ArcRun analyst agent making one decision in a Prediction market round.",
    "On each tick you pick exactly one action:",
    "  OPEN_YES: open a new YES position on a market",
    "  OPEN_NO: open a new NO position",
    "  HEDGE_YES: buy YES to hedge an existing NO position on that market",
    "  HEDGE_NO: buy NO to hedge an existing YES position",
    "  HOLD: skip this tick",
    `Cap per market: $${maxStakeUsd} USDC. Cap per round: ${cap.maxMarkets} markets.`,
    "Output ONE LINE in this format:",
    "DECISION <action> <market_id|->\\ <stake_usdc|->",
    "Where '-' means no market or no stake (only valid with HOLD).",
    "Then one more line:",
    "REASON <short why>",
  ].join(" ");

  // Tier-gated paid news pull: top-tier analysts buy fresh headlines about
  // the pinned markets before deciding. Null (lower tier, no endpoint,
  // drained budget, payment rejected) means the tick proceeds on priors alone.
  let newsBlock: string[] = [];
  if (params?.llmEnabled && config.nanopay.analystNewsEndpoint) {
    const keyword = newsKeywordFor(pinned.map((m) => m.title));
    const research = await paidAgentResearch({
      agentId: ctx.agentId,
      contestId: ctx.source === "contest" ? ctx.eventId : undefined,
      challengeId: ctx.source === "challenge" ? ctx.eventId : undefined,
      puzzleIdx: eligibility.ticksUsed,
      tier: ctx.tier,
      endpoint: buildNewsUrl(config.nanopay.analystNewsEndpoint, keyword),
      label: config.nanopay.analystNewsLabel,
      chain: config.nanopay.analystNewsChain,
      summarize: summarizeNews,
    }).catch(() => null);
    if (research) {
      newsBlock = [`NEWS (${research.label}, keyword "${keyword}"):`, research.summary];
    }
  }

  const userPrompt = [
    `tick ${eligibility.ticksUsed + 1} of ${eligibility.budget}`,
    ...newsBlock,
    "MARKETS:",
    ...marketLines,
    "YOUR PRIOR DECISIONS:",
    ...priorLines,
    "Pick your action.",
  ].join("\n");

  let response = "";
  let rationale = "";
  let action: TickAction = "HOLD";
  let marketId: number | null = null;
  let stakeUsdc6: bigint | null = null;

  if (!params || !params.llmEnabled) {
    // No-LLM path (tier 1, or no API key). Default to HOLD but flip a
    // small chance to OPEN on the first available market with min stake
    // so tier 1 still trades occasionally.
    if (eligibility.ticksUsed === 0 && pinned[0]) {
      action = "OPEN_YES";
      marketId = Number(pinned[0].marketId);
      stakeUsdc6 = cap.maxStakeUsdc6 / 2n;
      rationale = "tier-1 default open";
    } else {
      rationale = "tier-1 no LLM hold";
    }
  } else {
    try {
      const res = await callModel({
        model: params.model,
        systemPrompt,
        userPrompt,
        maxTokens: Math.min(params.maxTokens, 300),
        temperature: params.temperature,
        tools: params.tools,
      });
      response = res.text;
      const parsed = parseDecision(response);
      action = parsed.action;
      marketId = parsed.marketId;
      stakeUsdc6 = parsed.stake6;
      rationale = parsed.rationale;
    } catch (err) {
      if (err instanceof DailyKillError) {
        rationale = "daily kill switch";
      } else {
        rationale = err instanceof Error ? err.message.slice(0, 120) : "error";
      }
      action = "HOLD";
    }
  }

  // Validate + clamp.
  if (action !== "HOLD") {
    const market = pinned.find((m) => Number(m.marketId) === marketId);
    if (!market) {
      action = "HOLD";
      marketId = null;
      stakeUsdc6 = null;
      rationale = (rationale ? rationale + " · " : "") + "market id not in pinned set";
    } else {
      const isHedge = action === "HEDGE_YES" || action === "HEDGE_NO";
      if (isHedge) {
        const sides = await existingSidesOnMarket(ctx.eventId, ctx.agentId, marketId!);
        const oppositeSide = action === "HEDGE_YES" ? sides.no : sides.yes;
        if (oppositeSide === 0n) {
          // Hedge without an existing position is just an OPEN.
          action = action === "HEDGE_YES" ? "OPEN_YES" : "OPEN_NO";
        }
      }
      // Clamp stake to tier cap and apply hedge discount.
      let stake = stakeUsdc6 ?? cap.maxStakeUsdc6 / 2n;
      if (stake > cap.maxStakeUsdc6) stake = cap.maxStakeUsdc6;
      if (action === "HEDGE_YES" || action === "HEDGE_NO") {
        const mult = hedgeCostMultiplier(eligibility.equippedTraits);
        stake = BigInt(Math.floor(Number(stake) * mult));
      }
      stakeUsdc6 = stake;
    }
  }

  // Submit on chain if non-HOLD. Persist row regardless.
  let txHash: string | null = null;
  if (action !== "HOLD" && marketId !== null && stakeUsdc6 !== null && stakeUsdc6 > 0n) {
    txHash = await submitTickTrade(ctx.agentId, ctx.operator, marketId, action, stakeUsdc6).catch((err) => {
      rationale = (rationale ? rationale + " · " : "") + `submit failed: ${err instanceof Error ? err.message.slice(0, 80) : "error"}`;
      return null;
    });
    if (txHash === null) {
      // Rollback to HOLD so we don't claim a non-existent trade.
      action = "HOLD";
      marketId = null;
      stakeUsdc6 = null;
    }
  }

  await pool.query(
    `insert into agent_decisions
       (source, event_id, agent_id, operator, tick_idx, action, market_id, stake_usdc, tx_hash, rationale)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (source, event_id, agent_id, tick_idx) do nothing`,
    [
      ctx.source,
      ctx.eventId,
      ctx.agentId,
      ctx.operator,
      eligibility.ticksUsed,
      action,
      marketId,
      stakeUsdc6 ? stakeUsdc6.toString() : null,
      txHash,
      rationale.slice(0, 500),
    ],
  );

  return {
    tickIdx: eligibility.ticksUsed,
    action,
    marketId,
    stakeUsdc6,
    txHash,
    rationale,
  };
}

const DECISION_RE = /^\s*DECISION\s+(OPEN_YES|OPEN_NO|HEDGE_YES|HEDGE_NO|HOLD)\s+(\S+)\s+(\S+)/im;
const REASON_RE = /^\s*REASON\s+(.+)/im;

function parseDecision(text: string): {
  action: TickAction;
  marketId: number | null;
  stake6: bigint | null;
  rationale: string;
} {
  const m = text.match(DECISION_RE);
  const r = text.match(REASON_RE);
  const rationale = r ? r[1]!.trim().slice(0, 200) : "";
  if (!m) {
    return { action: "HOLD", marketId: null, stake6: null, rationale: rationale || "unparseable" };
  }
  const action = m[1] as TickAction;
  if (!TICK_ACTIONS.includes(action)) {
    return { action: "HOLD", marketId: null, stake6: null, rationale: rationale || "unknown action" };
  }
  if (action === "HOLD") {
    return { action, marketId: null, stake6: null, rationale };
  }
  const id = Number(m[2]);
  const stake = Number(m[3]);
  if (!Number.isFinite(id) || !Number.isFinite(stake) || stake <= 0) {
    return { action: "HOLD", marketId: null, stake6: null, rationale: rationale || "bad args" };
  }
  return {
    action,
    marketId: id,
    stake6: BigInt(Math.floor(stake * 1_000_000)),
    rationale,
  };
}

/// Approve USDC + call buyShares for an OPEN/HEDGE action. Reuses the
/// same agent-wallet + autofund pattern as the legacy analyst runner.
async function submitTickTrade(
  agentId: number,
  operator: `0x${string}`,
  marketId: number,
  action: TickAction,
  stakeUsdc6: bigint,
): Promise<string> {
  const wallet = getAgentWallet(agentId);
  if (!wallet) throw new Error("no agent wallet (set SCOUT_MASTER_MNEMONIC)");

  let balance = await getAgentUsdcBalance(agentId);
  const drip = await maybeAutofundAgent({
    agentId,
    tier: 0, // Caller already filtered out tier-0; pass 0 here lets autofund pick safely
    operator,
    hotWalletAddress: wallet.address,
    currentBalanceUsdc6: balance,
  }).catch(() => ({ txHash: null, reason: "error" } as const));
  if (drip.reason === "ok") balance = await getAgentUsdcBalance(agentId);

  if (balance < stakeUsdc6) throw new Error(`balance ${balance} < stake ${stakeUsdc6}`);

  const allowance = await getAgentUsdcAllowance(agentId, config.arcana.address);
  if (allowance < stakeUsdc6) {
    await wallet.writeContract({
      address: config.external.USDC,
      abi: usdcMinimalAbi,
      functionName: "approve",
      args: [config.arcana.address, stakeUsdc6 * 10n],
    });
  }

  const isYes = action === "OPEN_YES" || action === "HEDGE_YES";
  const hash = await wallet.writeContract({
    address: config.arcana.address,
    abi: arcanaMarketsAbi,
    functionName: "buyShares",
    args: [BigInt(marketId), isYes, stakeUsdc6],
  });

  // Persist into agent_positions so the existing scoring path + indexer
  // line up. Side reflects the actual on-chain trade (HEDGE_YES still
  // bought YES shares).
  const market = await publicClient.readContract({
    address: config.arcana.address,
    abi: arcanaMarketsAbi,
    functionName: "markets",
    args: [BigInt(marketId)],
  });
  const yesPool = (market as readonly unknown[])[3] as bigint;
  const noPool = (market as readonly unknown[])[4] as bigint;

  // contest_id column stores either contest or challenge id (single
  // namespace by the indexer's existing convention).
  await pool.query(
    `insert into agent_positions
       (contest_id, agent_id, operator, market_id, side, stake_usdc,
        entry_yes_pool, entry_no_pool, tx_hash)
     values (
       (select event_id from agent_decisions where tx_hash = $1 limit 1),
       $2, $3, $4, $5, $6, $7, $8, $1
     ) on conflict do nothing`,
    [hash, agentId, operator, marketId, isYes ? "yes" : "no", stakeUsdc6.toString(), yesPool.toString(), noPool.toString()],
  );

  return hash;
}

// ---------------------------------------------------------------------------
// Scheduler loop. Started from autopilot.
// ---------------------------------------------------------------------------

const TICK_SWEEP_MS = 15_000;

interface OpenAnalystEvent {
  source: "contest" | "challenge";
  eventId: number;
  endsAtMs: number;
  entries: Array<{ agentId: number; operator: `0x${string}`; tier: number }>;
}

async function findOpenAnalystEvents(): Promise<OpenAnalystEvent[]> {
  const out: OpenAnalystEvent[] = [];
  // Open analyst contests (contest_type = 1). The contests table doesn't store
  // an end time, so we select the open ones and read endTime on-chain per
  // contest to filter out closed windows and drive the tick countdown.
  const { rows: contests } = await query<{
    id: string;
    entries: string;
  }>(
    `select c.id::text,
            coalesce(
              json_agg(json_build_object('agent_id', e.agent_id, 'operator', e.operator)) filter (where e.agent_id is not null),
              '[]'::json
            )::text as entries
       from contests c
       left join entries e on e.contest_id = c.id
      where c.status = 'open' and c.contest_type = 1
      group by c.id`,
  );
  for (const c of contests) {
    let endsAtMs = 0;
    try {
      const onchain = await publicClient.readContract({
        address: config.contracts.ContestEngine,
        abi: contestEndAbi,
        functionName: "getContest",
        args: [BigInt(c.id)],
      });
      endsAtMs = Number((onchain as { endTime: bigint }).endTime) * 1000;
    } catch {
      continue; // can't read the contest; skip this tick
    }
    if (endsAtMs <= Date.now()) continue; // window closed; the settler handles it
    const parsed = JSON.parse(c.entries) as Array<{ agent_id: number; operator: string }>;
    const entries = await Promise.all(
      parsed.map(async (e) => ({
        agentId: Number(e.agent_id),
        operator: e.operator as `0x${string}`,
        tier: await readAgentAnalystTier(Number(e.agent_id)),
      })),
    );
    out.push({
      source: "contest",
      eventId: Number(c.id),
      endsAtMs,
      entries,
    });
  }
  // Open prediction challenges (kind = 1)
  const { rows: challenges } = await query<{
    id: string;
    entries: string;
    end_time: string;
  }>(
    `select ch.id::text,
            coalesce(
              json_agg(json_build_object('agent_id', ce.agent_id, 'operator', ce.operator)) filter (where ce.agent_id is not null),
              '[]'::json
            )::text as entries,
            (extract(epoch from now()) + 60)::bigint::text as end_time
       from challenges ch
       left join challenge_entries ce on ce.challenge_id = ch.id
      where ch.status = 'locked' and ch.kind = 1
      group by ch.id`,
  );
  // For challenges we don't have end_time in the schema; the resolver
  // sweeper handles cancellation/refund. Use a 60s placeholder so the
  // scheduler still ticks the agents within the LOCKED window. Real
  // end-time comes from the chain via getChallenge; cheap to plug in
  // here later if needed.
  for (const ch of challenges) {
    const parsed = JSON.parse(ch.entries) as Array<{ agent_id: number; operator: string }>;
    const entries = await Promise.all(
      parsed.map(async (e) => ({
        agentId: Number(e.agent_id),
        operator: e.operator as `0x${string}`,
        tier: await readAgentAnalystTier(Number(e.agent_id)),
      })),
    );
    out.push({
      source: "challenge",
      eventId: Number(ch.id),
      endsAtMs: Number(ch.end_time) * 1000,
      entries,
    });
  }
  return out;
}

async function readAgentAnalystTier(agentId: number): Promise<number> {
  const { rows } = await query<{ tier: number }>(
    "select analyst_tier as tier from agents where id = $1",
    [agentId],
  );
  return Math.max(0, Math.min(4, Number(rows[0]?.tier ?? 0)));
}

/// Long-running scheduler. Runs alongside contest + challenge autopilot
/// loops; one tick per agent per sweep when due. Failures inside a tick
/// are logged but don't crash the scheduler.
export async function startTickScheduler(
  broadcast: (msg: unknown) => void,
): Promise<void> {
  if (process.env.PREDICTION_TICKS === "0") {
    console.log("prediction tick scheduler disabled (PREDICTION_TICKS=0)");
    return;
  }
  console.log(`prediction tick scheduler on: sweeping every ${TICK_SWEEP_MS / 1000}s`);
  for (;;) {
    try {
      const events = await findOpenAnalystEvents();
      for (const ev of events) {
        for (const entry of ev.entries) {
          try {
            const outcome = await fireAgentTick({
              source: ev.source,
              eventId: ev.eventId,
              agentId: entry.agentId,
              operator: entry.operator,
              tier: entry.tier,
              endsAtMs: ev.endsAtMs,
            });
            if (outcome && outcome.action !== "HOLD") {
              console.log(
                `tick ${ev.source}/${ev.eventId} agent=${entry.agentId} t${outcome.tickIdx} ${outcome.action} market=${outcome.marketId} stake=${outcome.stakeUsdc6 ? Number(outcome.stakeUsdc6) / 1e6 : 0}`,
              );
              // Nudge the live page that a new position landed. Standings
              // socket will pick it up on next coordinator broadcast; this
              // is a lightweight hint so the narrative line ticks faster.
              broadcast({
                type: "tick",
                source: ev.source,
                eventId: ev.eventId,
                agentId: entry.agentId,
                action: outcome.action,
                marketId: outcome.marketId,
              });
            }
          } catch (err) {
            console.error(
              `tick failed ${ev.source}/${ev.eventId} agent=${entry.agentId}: ${err instanceof Error ? err.message : err}`,
            );
          }
        }
      }
    } catch (err) {
      console.error("tick scheduler sweep failed:", err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, TICK_SWEEP_MS));
  }
}
