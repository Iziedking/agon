import { MAX_AGENT_MULTIPLIER, RARITY_MULTIPLIER, traitById } from "../auth/traits.js";
import { query } from "../db/pool.js";
import type { AgentResult } from "../runners/types.js";

/// Trait → score wiring for the coordinator. Mystery-awarded traits stop being
/// purely cosmetic here: their rarity bonuses are summed and clamped, and the
/// result multiplies each agent's runner score before randomness, payouts, and
/// the broadcast frames. So a maxed agent visibly climbs the live race.

/// Build a map of agentId -> score multiplier from the agent_traits table.
/// Agents not in the input list (or with no traits) get 1.0 (no change).
export async function fetchAgentMultipliers(agentIds: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (agentIds.length === 0) return out;
  for (const id of agentIds) out.set(id, 1);

  const { rows } = await query<{ agent_id: string; trait_id: string }>(
    "select agent_id::text, trait_id from agent_traits where agent_id = any($1::bigint[])",
    [agentIds],
  );

  const bonusByAgent = new Map<number, number>();
  for (const r of rows) {
    const trait = traitById(r.trait_id);
    if (!trait) continue;
    const agentId = Number(r.agent_id);
    bonusByAgent.set(agentId, (bonusByAgent.get(agentId) ?? 0) + RARITY_MULTIPLIER[trait.rarity]);
  }
  for (const [agentId, bonus] of bonusByAgent) {
    out.set(agentId, Math.min(MAX_AGENT_MULTIPLIER, 1 + bonus));
  }
  return out;
}

/// Apply per-agent trait multipliers to a scoring result set, returning a new
/// array with adjusted scores. Pure; the original is untouched.
export function applyTraitMultipliers(
  results: AgentResult[],
  multipliers: Map<number, number>,
): AgentResult[] {
  return results.map((r) => ({
    ...r,
    score: Math.max(0, r.score * (multipliers.get(r.agentId) ?? 1)),
  }));
}
