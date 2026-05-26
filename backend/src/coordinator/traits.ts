import { MAX_AGENT_MULTIPLIER, RARITY_MULTIPLIER, TRAITS, traitById, type Rarity, type Trait } from "../auth/traits.js";
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

// --- Placement awards (contest top-3, challenge top-3) ---
//
// Closes the gameplay loop: play -> place top -> earn a trait -> play stronger.
// The mystery box is the non-whale shortcut to traits; placements are the
// skill-based path. Different rarity weights per rank so #1 carries real
// odds of pulling something rare.

const RANK_WEIGHTS: Record<number, Record<Rarity, number>> = {
  1: { common: 25, rare: 35, epic: 28, legendary: 12 },
  2: { common: 45, rare: 32, epic: 17, legendary: 6 },
  3: { common: 55, rare: 28, epic: 13, legendary: 4 },
};
const FALLBACK_WEIGHTS: Record<Rarity, number> = { common: 60, rare: 25, epic: 12, legendary: 3 };

function pickForRank(rank: number, pool: Trait[]): Trait | null {
  if (pool.length === 0) return null;
  const weights = RANK_WEIGHTS[rank] ?? FALLBACK_WEIGHTS;
  const total = pool.reduce((sum, t) => sum + weights[t.rarity], 0);
  let r = Math.random() * total;
  for (const t of pool) {
    r -= weights[t.rarity];
    if (r <= 0) return t;
  }
  return pool[pool.length - 1] ?? null;
}

/// Award one trait to each top-N finisher in a contest or challenge. The
/// rarity weights shift in the winners' favor: #1 carries a 12% legendary
/// chance versus 3% on a mystery roll, #2 a 6% chance, #3 a 4% chance. Skips
/// agents that already own every trait, and dedupes on (agent_id, trait_id).
/// Best-effort; per-agent failures log but do not unwind anything.
export async function awardPlacementTraits(
  source: "contest" | "challenge",
  sourceId: number,
  ranked: AgentResult[],
  topN = 3,
): Promise<void> {
  if (ranked.length === 0) return;
  const sorted = [...ranked].sort((a, b) => b.score - a.score);
  const seats = Math.min(topN, sorted.length);
  for (let i = 0; i < seats; i++) {
    const rank = i + 1;
    const r = sorted[i]!;
    try {
      const ownedRows = await query<{ trait_id: string }>(
        "select trait_id from agent_traits where agent_id = $1",
        [r.agentId],
      );
      const owned = new Set(ownedRows.rows.map((row) => row.trait_id));
      const pool = TRAITS.filter((t) => !owned.has(t.id));
      if (pool.length === 0) {
        console.log(`${source} ${sourceId} rank ${rank}: agent ${r.agentId} already owns every trait, skipping`);
        continue;
      }
      const trait = pickForRank(rank, pool);
      if (!trait) continue;
      await query(
        "insert into agent_traits (agent_id, trait_id, source, source_ref) values ($1, $2, $3, $4) on conflict (agent_id, trait_id) do nothing",
        [r.agentId, trait.id, source, String(sourceId)],
      );
      console.log(`${source} ${sourceId} rank ${rank}: agent ${r.agentId} earned ${trait.rarity} trait ${trait.id}`);
    } catch (err) {
      console.error(`${source} ${sourceId} rank ${rank} trait award failed:`, err instanceof Error ? err.message : err);
    }
  }
}
