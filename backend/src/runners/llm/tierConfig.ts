import { config } from "../../config/index.js";
import { query } from "../../db/pool.js";

/// Tier defines which CAPABILITIES an agent unlocks. Every tier that calls
/// the LLM uses the same single model (config.llm.model, default Haiku
/// 4.5); tiers differ in what tools they're allowed to attach, how many
/// tokens they can spend, and whether they get retries. Upgrading from
/// tier 2 to tier 3 grants a calculator; tier 3 to tier 4 grants the
/// internet. Real, observable, paid-for capability rather than a model
/// swap.
///
/// The cheapest path stays cheap: tier 0 and tier 1 skip the LLM entirely
/// and just guess, which costs $0.

export const STAT_NAMES = ["POWER", "PRECISION", "SPEED", "ENDURANCE", "LUCK", "FOCUS"] as const;
export type StatName = (typeof STAT_NAMES)[number];

export type ToolSpec = { type: string; name: string };

export interface TierCapabilities {
  /// false = no LLM call. The runner produces a random-guess outcome.
  /// LUCK still applies on tier 1 so the guess has a small nudge.
  llmEnabled: boolean;
  /// Server-side tools attached to the call. Empty for low tiers.
  tools: ToolSpec[];
  /// Token ceiling for the response. Folded with the agent's POWER stat.
  maxTokensBase: number;
  /// Internal retries on parse failure / tool error.
  retries: number;
  /// Human-readable description shown in the upgrade flow.
  label: string;
}

/// Pure tier mapping with no stat fold-in. Keep this small and readable;
/// the runtime params (after stats) come from resolveRuntimeParams below.
export function tierToCapabilities(tier: number): TierCapabilities {
  const t = Math.max(0, Math.min(4, tier));
  switch (t) {
    case 0:
      return { llmEnabled: false, tools: [], maxTokensBase: 0, retries: 0, label: "guess only" };
    case 1:
      return { llmEnabled: false, tools: [], maxTokensBase: 0, retries: 0, label: "guess + luck" };
    case 2:
      return {
        llmEnabled: true,
        tools: [],
        maxTokensBase: 300,
        retries: 0,
        label: "agent thinks",
      };
    case 3:
      return {
        llmEnabled: true,
        tools: [{ type: "code_execution_20250522", name: "code_execution" }],
        maxTokensBase: 600,
        retries: 1,
        label: "agent + calculator",
      };
    case 4:
    default:
      return {
        llmEnabled: true,
        tools: [
          { type: "code_execution_20250522", name: "code_execution" },
          { type: "web_search_20260209", name: "web_search" },
        ],
        maxTokensBase: 1500,
        retries: 2,
        label: "agent + calculator + internet",
      };
  }
}

export interface RuntimeParams extends TierCapabilities {
  model: string;
  maxTokens: number;
  temperature: number;
  parallelSolves: number;
  fewShotCount: number;
  /// Tiebreaker dice nudge. LUCK level * 0.01.
  luckBonus: number;
}

/// Read the agent's stats and fold them into runtime params on top of the
/// tier capabilities. Stats remain meaningful for tiers that don't have
/// llmEnabled (LUCK still adds a guess bonus); for LLM-enabled tiers, the
/// stats fine-tune the call (POWER/PRECISION/SPEED/FOCUS) without changing
/// which tools are attached.
/// Tier 4 may run on a smarter model when LLM_MODEL_TIER4 is set in the
/// env (typical mainnet config). Tiers 0..3 always use the default
/// LLM_MODEL, which keeps testnet cost flat.
export function modelForTier(tier: number): string {
  // Per-tier reasoning models (tier 0..4): llama / gpt for the lower tiers via
  // OpenRouter, Haiku for tier 4. LLM_MODEL_TIER4 still wins for tier 4 if set
  // (e.g. a smarter mainnet model), then the per-tier table, then the default.
  if (tier >= 4 && config.llm.modelTier4) return config.llm.modelTier4;
  const t = Math.max(0, Math.min(4, Math.floor(tier)));
  return config.llm.tierModels[t] ?? config.llm.model;
}

export async function resolveRuntimeParams(agentId: number, tier: number): Promise<RuntimeParams> {
  const base = tierToCapabilities(tier);
  const stats = await readAgentStats(agentId);
  // POWER: + 50 tokens per level, capped at +1000 above the tier base.
  const maxTokens = Math.min(
    base.maxTokensBase + 1000,
    base.maxTokensBase + 50 * (stats.POWER ?? 0),
  );
  // PRECISION: temperature drops 0.7 -> 0.2 across 0..20.
  const temperature = Math.max(0.2, 0.7 - 0.025 * (stats.PRECISION ?? 0));
  // SPEED: 1 -> 5 parallel solves.
  const parallelSolves = Math.max(1, Math.min(5, 1 + Math.floor((stats.SPEED ?? 0) / 5)));
  // FOCUS: 3 -> 10 few-shot examples.
  const fewShotCount = Math.max(3, Math.min(10, 3 + Math.floor((stats.FOCUS ?? 0) / 3)));
  // LUCK: 0.01 nudge per level.
  const luckBonus = (stats.LUCK ?? 0) * 0.01;

  // Testing belt: strip web_search (the only paid server-tool), clamp
  // tokens, kill retries. Tier 4 keeps code_execution because that's free
  // and exercises the tool path during test runs.
  const tools = config.llm.testing
    ? base.tools.filter((t) => t.name !== "web_search")
    : base.tools;
  const finalMaxTokens = config.llm.testing ? Math.min(200, maxTokens) : maxTokens;
  const retries = config.llm.testing ? 0 : base.retries;

  return {
    ...base,
    tools,
    retries,
    model: modelForTier(tier),
    maxTokens: finalMaxTokens,
    temperature,
    parallelSolves,
    fewShotCount,
    luckBonus,
  };
}

/// Public so the runners can fold stat levels into the
/// `effectiveStrength` multiplier from `scoring/strength.ts` without
/// duplicating the DB query.
export async function loadAgentStats(agentId: number): Promise<Partial<Record<StatName, number>>> {
  return readAgentStats(agentId);
}

/// Trade caps for Analyst contests routed through Arcana Markets. Stake is
/// in USDC 6-dec bigints; "markets" caps how many distinct markets an agent
/// can take a position in per round. Tier 0 is ineligible; the entry runner
/// excludes them from Arcana Analyst contests so they don't burn gas for no
/// payoff.
export interface ArcanaCap {
  maxMarkets: number;
  maxStakeUsdc6: bigint;
  /// Hard cap on total stake across all markets for one round. Default is
  /// maxMarkets * maxStakeUsdc6 unless we want to throttle further.
  totalStakeUsdc6: bigint;
}

const ARCANA_CAPS: ArcanaCap[] = [
  // tier 0: not eligible. Encoded as zero so a defensive caller sees no caps.
  { maxMarkets: 0, maxStakeUsdc6: 0n, totalStakeUsdc6: 0n },
  // tier 1: 1 market x $2
  { maxMarkets: 1, maxStakeUsdc6: 2_000_000n, totalStakeUsdc6: 2_000_000n },
  // tier 2: 2 markets x $5
  { maxMarkets: 2, maxStakeUsdc6: 5_000_000n, totalStakeUsdc6: 10_000_000n },
  // tier 3: 3 markets x $15
  { maxMarkets: 3, maxStakeUsdc6: 15_000_000n, totalStakeUsdc6: 45_000_000n },
  // tier 4: 5 markets x $50
  { maxMarkets: 5, maxStakeUsdc6: 50_000_000n, totalStakeUsdc6: 250_000_000n },
];

export function arcanaCapFor(tier: number): ArcanaCap {
  return ARCANA_CAPS[Math.min(Math.max(tier, 0), 4)]!;
}

async function readAgentStats(agentId: number): Promise<Partial<Record<StatName, number>>> {
  const { rows } = await query<{ stat: string; level: number }>(
    "select stat, level from agent_stats where agent_id = $1",
    [agentId],
  );
  const out: Partial<Record<StatName, number>> = {};
  for (const r of rows) {
    if ((STAT_NAMES as readonly string[]).includes(r.stat)) {
      out[r.stat as StatName] = r.level;
    }
  }
  return out;
}
