import { config } from "../config/index.js";
import { query } from "../db/pool.js";
import { notify } from "../notifications/index.js";
import type { AgentResult } from "../runners/types.js";

/// Agent training: six stats, each 0..5. A level is a PERMANENT boost to the
/// abilities that stat governs, via the curve in scoring/strength.ts
/// (TRAIN_LEVEL_BONUS). Training is the permanent edge; traits are the temporary
/// equipped one. Higher levels take much longer to train, and Cycles buy back
/// wall-clock.

export type Stat = "power" | "precision" | "speed" | "endurance" | "luck" | "focus";

export const STATS: Stat[] = ["power", "precision", "speed", "endurance", "luck", "focus"];
/// Five permanent levels per stat (down from twenty). The effect curve lives in
/// scoring/strength.ts.
export const MAX_STAT_LEVEL = 5;

/// Cost ladder: level N → N+1 costs (N+1) × 50 Cycles. Add `speedupSteps` to
/// charge extra at queue time for shaving wall-clock.
export function cyclesCost(fromLevel: number, speedupSteps = 0): bigint {
  const base = (fromLevel + 1) * 50;
  const extra = Math.max(0, speedupSteps) * config.training.speedupCyclesPerStep;
  return BigInt(base + extra);
}

const HOUR = 3600;

/// Real seconds to reach a target LEVEL (1..5). Level 1 keeps the present quick
/// time; then it climbs hard: 24h, 72h, 5 days, 7 days. The whole ladder scales
/// by TRAINING_TIME_SCALE so test environments can shrink it.
function levelSeconds(targetLevel: number): number {
  const t = Math.max(1, Math.min(MAX_STAT_LEVEL, targetLevel));
  const ladder: Record<number, number> = {
    1: config.training.baseSecondsPerLevel,
    2: 24 * HOUR,
    3: 72 * HOUR,
    4: 120 * HOUR, // 5 days
    5: 168 * HOUR, // 7 days
  };
  const base = ladder[t] ?? 168 * HOUR;
  return Math.max(config.training.minSeconds, Math.round(base * config.training.timeScale));
}

/// Time ladder for level N → N+1, minus `speedupSteps × speedupSecondsPerStep`,
/// floored at MIN_SECONDS so a fully sped-up training still has a visible wait.
export function secondsCost(fromLevel: number, speedupSteps = 0): number {
  const base = levelSeconds(fromLevel + 1);
  const cut = Math.max(0, speedupSteps) * config.training.speedupSecondsPerStep;
  return Math.max(config.training.minSeconds, base - cut);
}

/// How many speedup steps can meaningfully reduce the wait at this level.
/// Anything beyond this just bottoms out at MIN_SECONDS while still charging
/// cycles, so the endpoint clamps the request at this value.
export function maxSpeedupSteps(fromLevel: number): number {
  const base = levelSeconds(fromLevel + 1);
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

/// Training's score effect now lives in each runner (analyst bakes it into
/// effectiveStrength; scout turns it into more swaps). Re-applying it here was
/// a double-count that let an upgraded agent overrun a clearly better
/// performer. This returns an empty map (every agent defaults to 1.0) so the
/// coordinator pass no longer re-multiplies training; the call sites stay so
/// the pipeline shape is unchanged. PER_LEVEL_BONUS is kept for reference.
export async function fetchTrainingMultipliers(agentIds: number[]): Promise<Map<number, number>> {
  void PER_LEVEL_BONUS;
  void agentIds;
  return new Map<number, number>();
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
