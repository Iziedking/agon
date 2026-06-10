import { config } from "../config/index.js";
import { query } from "../db/pool.js";
import { notify } from "../notifications/index.js";
import type { AgentResult } from "../runners/types.js";

/// Agent training: six stats, each 0..20, each level adds 1% to the relevant
/// scoring component. Multipliers from training stack with trait multipliers
/// from `coordinator/traits.ts`. The combined cap (tier + traits + training)
/// is enforced in the coordinator scoring pass via MAX_COMBINED_MULTIPLIER.

export type Stat = "power" | "precision" | "speed" | "endurance" | "luck" | "focus";

export const STATS: Stat[] = ["power", "precision", "speed", "endurance", "luck", "focus"];
export const MAX_STAT_LEVEL = 20;

/// Cost ladder: level N → N+1 costs (N+1) × 50 Cycles. Hardcoded curve.
/// Add `speedupSteps` to charge extra at queue time for shaving wall-clock.
export function cyclesCost(fromLevel: number, speedupSteps = 0): bigint {
  const base = (fromLevel + 1) * 50;
  const extra = Math.max(0, speedupSteps) * config.training.speedupCyclesPerStep;
  return BigInt(base + extra);
}

/// Time ladder: level N → N+1 takes (N+1) × baseSecondsPerLevel real seconds,
/// minus `speedupSteps × speedupSecondsPerStep`, floored at MIN_SECONDS so a
/// fully sped-up training still has a visible wait. Pulled from env so test
/// environments can shrink the whole thing.
export function secondsCost(fromLevel: number, speedupSteps = 0): number {
  const base = (fromLevel + 1) * config.training.baseSecondsPerLevel;
  const cut = Math.max(0, speedupSteps) * config.training.speedupSecondsPerStep;
  return Math.max(config.training.minSeconds, base - cut);
}

/// How many speedup steps can meaningfully reduce the wait at this level.
/// Anything beyond this just bottoms out at MIN_SECONDS while still charging
/// cycles, so the endpoint clamps the request at this value.
export function maxSpeedupSteps(fromLevel: number): number {
  const base = (fromLevel + 1) * config.training.baseSecondsPerLevel;
  const span = Math.max(0, base - config.training.minSeconds);
  return Math.floor(span / config.training.speedupSecondsPerStep);
}

/// Public shape returned by the GET /training endpoint so the UI can render
/// the speedup slider without duplicating constants.
export function speedupParams() {
  return {
    cyclesPerStep: config.training.speedupCyclesPerStep,
    secondsPerStep: config.training.speedupSecondsPerStep,
    minSeconds: config.training.minSeconds,
    baseSecondsPerLevel: config.training.baseSecondsPerLevel,
  };
}

/// Each level of any stat adds 1% to the agent's score multiplier. Six stats
/// at max = +120%. The combined cap below pulls it back to +250% (3.5x).
const PER_LEVEL_BONUS = 0.01;

/// Combined ceiling across tier, traits, and training. Keeps maxed agents
/// strong but not unbeatable; placing pays even against a maxed field.
export const MAX_COMBINED_MULTIPLIER = 3.5;

/// Fetch each agent's training multiplier. Returns a Map<agentId, multiplier>;
/// agents not in the map default to 1.0 (no training).
export async function fetchTrainingMultipliers(agentIds: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (agentIds.length === 0) return out;

  const { rows } = await query<{ agent_id: string; level_sum: string }>(
    `select agent_id::text as agent_id, sum(level)::text as level_sum
       from agent_stats
       where agent_id = any($1::bigint[])
       group by agent_id`,
    [agentIds],
  );

  for (const r of rows) {
    const sum = Number(r.level_sum);
    if (Number.isFinite(sum) && sum > 0) {
      out.set(Number(r.agent_id), 1 + sum * PER_LEVEL_BONUS);
    }
  }
  return out;
}

/// Apply training multipliers to a scored set. Pure; returns a new array.
export function applyTrainingMultipliers(
  results: AgentResult[],
  trainingMult: Map<number, number>,
): AgentResult[] {
  return results.map((r) => ({
    ...r,
    score: Math.max(0, r.score * (trainingMult.get(r.agentId) ?? 1)),
  }));
}

/// Clamp the combined effective multiplier across tier / traits / training.
/// Called once at the end of the scoring pipeline. We don't unwind individual
/// multipliers; instead, we compare each result's adjusted score against the
/// agent's hypothetical un-multiplied baseline and clamp the implied
/// multiplier to MAX_COMBINED_MULTIPLIER. In practice the runner already
/// produces the baseline; this clamps post-multipliers in proportion.
export function clampCombinedMultiplier(
  results: AgentResult[],
  baselines: Map<number, number>,
): AgentResult[] {
  return results.map((r) => {
    const base = baselines.get(r.agentId);
    if (!base || base <= 0) return r;
    const implied = r.score / base;
    if (implied <= MAX_COMBINED_MULTIPLIER) return r;
    return { ...r, score: base * MAX_COMBINED_MULTIPLIER };
  });
}

/// Promote any agent whose `completes_at` is in the past. Idempotent: if no
/// row matches, returns 0. Called on every training-state read (lazy
/// completion, no cron required).
export async function flushTrainingQueue(agentId?: number): Promise<number> {
  const filter = agentId != null ? "and agent_id = $1" : "";
  const args = agentId != null ? [agentId] : [];

  const { rows } = await query<{
    agent_id: string;
    stat: string;
    from_level: number;
    to_level: number;
    cycles_spent: string;
  }>(
    `select agent_id::text, stat, from_level, to_level, cycles_spent::text
       from training_queue
       where completes_at <= now() ${filter}`,
    args,
  );

  if (rows.length === 0) return 0;

  for (const r of rows) {
    const aid = Number(r.agent_id);
    // Upsert the new stat level (does NOT lower).
    await query(
      `insert into agent_stats (agent_id, stat, level)
         values ($1, $2, $3)
         on conflict (agent_id, stat) do update set level = greatest(agent_stats.level, excluded.level)`,
      [aid, r.stat, r.to_level],
    );
    // Append the log entry.
    await query(
      `insert into training_log (agent_id, stat, from_level, to_level, cycles_spent)
         values ($1, $2, $3, $4, $5)`,
      [aid, r.stat, r.from_level, r.to_level, r.cycles_spent],
    );
    // Drop from the queue.
    await query("delete from training_queue where agent_id = $1", [aid]);
    // Notify the owner that training finished.
    const ownerRow = await query<{ owner: string; name: string | null }>(
      "select owner, name from agents where id = $1",
      [aid],
    );
    const owner = ownerRow.rows[0]?.owner;
    if (owner) {
      const agentName = ownerRow.rows[0]?.name || `agent #${aid}`;
      void notify(owner, {
        kind: "training_done",
        title: "Training complete",
        body: `${agentName} reached ${r.stat} level ${r.to_level}. ready for the next contest.`,
        href: "/workshop",
        context: { agentId: aid, stat: r.stat, level: r.to_level },
      });
    }
  }
  return rows.length;
}
