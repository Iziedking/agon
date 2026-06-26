/// The mission grader (docs/missions.md section 5). Two checks, and a deliverable
/// must pass BOTH:
///   1. Quality — an LLM judge scores the deliverable against the brief.
///   2. Credit-requires-payment (the keystone) — a fragment only counts when its
///      claimed settlement is backed by a real on-chain proof row (a settled
///      a2a_trades for a BUY, a settled nanopayments for a MAKE). The grader
///      re-verifies this from the proof tables; it does NOT trust the runner's
///      optimistic flags, so a deliverable cannot claim work it did not pay for.
/// The two combine multiplicatively, so empty or low-quality work scores ~0 while
/// genuine, well-judged, paid-for work ranks highest. Deterministic on the money
/// path: the judge is pinned to temperature 0.

import { callModel, llmConfigured } from "../llm/client.js";
import { config } from "../../config/index.js";
import { query } from "../../db/pool.js";
import { loadAgentStats } from "../llm/tierConfig.js";
import { getLoadout } from "../../auth/loadouts.js";
import { effectiveStrength, type ContestType } from "../../scoring/strength.js";
import type { Commission } from "./types.js";

const SCORE_SCALE = 1000;

export interface MissionGrade {
  agentId: number;
  creditedFragments: number;
  totalFragments: number;
  /// 0..1 from the judge.
  quality: number;
  verdict: string;
  /// Verified spend, USDC 6-decimals as a string.
  spent6: string;
  /// Final deterministic score fed into the merkle payout.
  score: number;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function speedBudgetMs(): number {
  return Number(process.env.MISSION_SPEED_BUDGET_MS ?? "60000");
}

/// Re-verifies credit on-chain. A fragment counts only when its decision settled
/// AND the matching proof row exists with the same tx. This is the gate that
/// makes the judge un-gameable: quality says "is it good", the proof says "did
/// the work happen", and only their intersection scores.
export async function verifyCredit(
  missionId: number,
  agentId: number,
): Promise<{ credited: number; total: number; spent6: bigint }> {
  const { rows } = await query<{
    fragment_id: string;
    choice: string;
    settled: boolean;
    tx_hash: string | null;
    spent_usdc_6: string;
  }>(
    `select fragment_id, choice, settled, tx_hash, spent_usdc_6
       from mission_decisions
      where contest_id = $1 and agent_id = $2`,
    [missionId, agentId],
  );

  let credited = 0;
  let spent6 = 0n;
  for (const r of rows) {
    if (!r.settled || !r.tx_hash) continue;
    let proven = false;
    if (r.choice === "buy") {
      const { rows: p } = await query(
        `select 1 from a2a_trades
          where contest_id = $1 and buyer_agent_id = $2 and fragment_id = $3
            and status = 'settled' and tx_hash = $4
          limit 1`,
        [missionId, agentId, r.fragment_id, r.tx_hash],
      );
      proven = p.length > 0;
    } else if (r.choice === "make") {
      const { rows: p } = await query(
        `select 1 from nanopayments
          where contest_id = $1 and agent_id = $2 and status = 'settled' and tx_hash = $3
          limit 1`,
        [missionId, agentId, r.tx_hash],
      );
      proven = p.length > 0;
    }
    if (proven) {
      credited += 1;
      spent6 += BigInt(r.spent_usdc_6 || "0");
    }
  }
  return { credited, total: rows.length, spent6 };
}

/// The quality judge: an agent scoring an agent's deliverable. Pinned to
/// temperature 0 for determinism. Returns 0 for an empty deliverable and a
/// neutral 0.5 when no model is available, so the credit gate still drives
/// ranking in a keyless dev environment.
export async function judgeDeliverable(
  mission: Commission,
  deliverable: string,
): Promise<{ quality: number; verdict: string }> {
  const empty = !deliverable || deliverable.startsWith("(no fragments");
  if (empty) return { quality: 0, verdict: "empty deliverable" };
  if (!llmConfigured()) return { quality: 0.5, verdict: "ungraded (no judge model)" };

  // Ground-truth intel the deliverable was supposed to reflect — the same pieces
  // the platform holds and specialists sell. Grading is a 1:1 FIT to this: a
  // deliverable that uses every fact accurately scores high; missing, contradicted,
  // or unsourced/invented content scores low. This is what makes the intel
  // genuinely necessary to pass, not decorative.
  const intel = mission.fragments
    .filter((f) => f.truth != null)
    .map((f, i) => {
      const t = typeof f.truth === "string" ? f.truth : JSON.stringify(f.truth);
      return `${i + 1}. [${f.kind}] ${f.ask}\n   ground truth: ${t}`;
    })
    .join("\n");
  const hasIntel = intel.length > 0;

  const model = config.mission.judgeModel ?? config.llm.model;
  try {
    const res = await callModel({
      model,
      systemPrompt: hasIntel
        ? "You are a strict judge scoring how faithfully an intelligence deliverable reflects the " +
          "GROUND-TRUTH intel it had to use. A 1:1 fit — every ground-truth fact used accurately — scores " +
          "90-100. Each missing, contradicted, vague, or invented/unsourced claim lowers the score sharply. " +
          'Return ONLY JSON: {"score":0-100,"verdict":"one line"}.'
        : "You are a strict judge scoring an intelligence deliverable against its brief. " +
          'Return ONLY JSON: {"score":0-100,"verdict":"one line"}. Score on coherence, ' +
          "specificity, and faithfulness to the brief. Penalize vagueness and padding.",
      userPrompt: hasIntel
        ? `Brief: ${mission.brief}\nRequired deliverable: ${mission.deliverable}\n\n` +
          `GROUND-TRUTH INTEL (what a correct deliverable must reflect, 1:1):\n${intel}\n\n` +
          `Submitted deliverable:\n${deliverable}`
        : `Brief: ${mission.brief}\nRequired deliverable: ${mission.deliverable}\n\n` +
          `Submitted deliverable:\n${deliverable}`,
      maxTokens: 200,
      temperature: 0,
    });
    const m = res.text.match(/\{[\s\S]*\}/);
    if (!m) return { quality: 0.5, verdict: "unparsed judge output" };
    const parsed = JSON.parse(m[0]) as { score?: unknown; verdict?: unknown };
    const score = Number(parsed.score);
    const quality = Number.isFinite(score) ? clamp01(score / 100) : 0.5;
    return { quality, verdict: String(parsed.verdict ?? "") };
  } catch {
    return { quality: 0.5, verdict: "judge error" };
  }
}

/// Grades one operative's submission: verified credit x judged quality, with a
/// small speed amplifier on real work. Empty or rejected work scores ~0.
export async function gradeSubmission(
  mission: Commission,
  sub: { agentId: number; deliverable: string; elapsedMs: number; tier: number },
): Promise<MissionGrade> {
  const { credited, total, spent6 } = await verifyCredit(mission.missionId, sub.agentId);
  const { quality, verdict } = await judgeDeliverable(mission, sub.deliverable);

  // Tier x training x traits — the SAME strength model contests use, now active
  // for missions. Capability genuinely matters: a higher tier and a trained,
  // well-equipped agent earn a bigger multiplier, which offsets the latency of
  // the smarter (slower) model that tier runs on.
  const stats = await loadAgentStats(sub.agentId).catch(() => ({}));
  const equipped = await getLoadout("contest", mission.missionId, sub.agentId).catch(() => [] as string[]);
  const ctype: ContestType = mission.domain === "analyst" ? "analyst" : mission.domain === "scout" ? "scout" : "solver";
  const strength = effectiveStrength(sub.tier, stats, equipped, ctype).effective;

  // Speed is the secondary differentiator (the race): faster strictly scores
  // higher so two fast agents no longer tie at a clamp, but it never out-muscles
  // a clearly stronger agent. MISSION_SPEED_WEIGHT tunes how much the race counts.
  const speedScore = Math.min(20, speedBudgetMs() / Math.max(sub.elapsedMs, 1));
  const speedWeight = Number(process.env.MISSION_SPEED_WEIGHT ?? "0.5");

  // credited (paid, proven) AND quality both gate (multiplicative → empty/bad
  // work scores ~0); strength and speed scale genuine work.
  const score = Math.round(credited * quality * SCORE_SCALE * strength * (1 + speedWeight * speedScore));
  return {
    agentId: sub.agentId,
    creditedFragments: credited,
    totalFragments: total,
    quality,
    verdict,
    spent6: spent6.toString(),
    score,
  };
}
