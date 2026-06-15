import { TRAITS, pickRandomOfRarity, type MysteryRarity, type Rarity, type Trait } from "../auth/traits.js";
import { query } from "../db/pool.js";
import { notify } from "../notifications/index.js";
import type { AgentResult } from "../runners/types.js";

/// Trait → score wiring for the coordinator.
///
/// Trait EFFECTS now come from the EQUIPPED loadout inside each runner, tier and
/// rarity scaled: scout turns them into bigger / more swaps, solver into
/// reasoning capability, analyst into a score multiplier and more trades. So the
/// coordinator no longer applies a flat owned-trait multiplier here.

/// Kept as a 1.0 no-op so the coordinator's applyTraitMultipliers pipeline is
/// unchanged. The real, loadout-based trait effect lives in the runners.
export async function fetchAgentMultipliers(agentIds: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  for (const id of agentIds) out.set(id, 1);
  return out;
}

/// Award one unowned trait of `rarity` to an agent (the win-streak path). Skips
/// silently if the agent already owns every trait of that rarity.
async function awardStreakTrait(
  agentId: number,
  operator: string,
  rarity: MysteryRarity,
  contestId: number,
  streak: number,
): Promise<void> {
  const ownedRows = await query<{ trait_id: string }>(
    "select trait_id from agent_traits where agent_id = $1",
    [agentId],
  );
  const owned = new Set(ownedRows.rows.map((r) => r.trait_id));
  const trait = pickRandomOfRarity(rarity, owned);
  if (!trait) return;
  await query(
    "insert into agent_traits (agent_id, trait_id, source, source_ref) values ($1, $2, 'streak', $3) on conflict (agent_id, trait_id) do nothing",
    [agentId, trait.id, String(contestId)],
  );
  console.log(`win streak ${streak}: agent ${agentId} earned ${rarity} trait ${trait.id}`);
  void notify(operator, {
    kind: "mystery_win",
    title: `${streak}-win streak: ${rarity} trait unlocked`,
    body: `${trait.name} (${rarity}). equip it before your next entry.`,
    href: "/workshop",
    context: { traitId: trait.id, rarity, agentId, streak },
  });
}

/// Update consecutive-win streaks after a contest settles. The #1 finisher's
/// streak bumps; every other entrant's resets to 0. A streak of 5 unlocks a
/// rare trait, 10 a legendary (then the streak resets so the next legendary is
/// another genuine 10-win climb). Best-effort; failures log but do not unwind.
export async function awardWinStreaks(contestId: number, ranked: AgentResult[]): Promise<void> {
  if (ranked.length === 0) return;
  const sorted = [...ranked].sort((a, b) => b.score - a.score);
  const winner = sorted[0]!;
  try {
    const row = await query<{ streak: number }>(
      `insert into win_streaks (operator, streak) values ($1, 1)
         on conflict (operator) do update set streak = win_streaks.streak + 1, updated_at = now()
         returning streak`,
      [winner.operator.toLowerCase()],
    );
    const streak = Number(row.rows[0]?.streak ?? 1);
    const others = sorted.slice(1).map((r) => r.operator.toLowerCase());
    if (others.length > 0) {
      await query("update win_streaks set streak = 0, updated_at = now() where operator = any($1::text[])", [others]);
    }
    if (streak >= 10) {
      await awardStreakTrait(winner.agentId, winner.operator, "legendary", contestId, streak);
      await query("update win_streaks set streak = 0, updated_at = now() where operator = $1", [winner.operator.toLowerCase()]);
    } else if (streak === 5) {
      await awardStreakTrait(winner.agentId, winner.operator, "rare", contestId, streak);
    }
  } catch (err) {
    console.error(`win-streak update for contest ${contestId} failed:`, err instanceof Error ? err.message : err);
  }
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
  1: { common: 50, rare: 38, legendary: 12 },
  2: { common: 65, rare: 29, legendary: 6 },
  3: { common: 72, rare: 24, legendary: 4 },
};
const FALLBACK_WEIGHTS: Record<Rarity, number> = { common: 72, rare: 25, legendary: 3 };

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
  // Traits are mystery-only: the daily mystery box is the sole way to earn a
  // trait. Placement drops are off so winning a contest doesn't also hand out
  // traits (it confused operators who only claimed once). Set
  // PLACEMENT_TRAITS_ENABLED=1 to bring win-drops back.
  if (process.env.PLACEMENT_TRAITS_ENABLED !== "1") return;
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
