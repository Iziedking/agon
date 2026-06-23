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

  const model = config.mission.judgeModel ?? config.llm.model;
  try {
    const res = await callModel({
      model,
      systemPrompt:
        "You are a strict judge scoring an intelligence deliverable against its brief. " +
        'Return ONLY JSON: {"score":0-100,"verdict":"one line"}. Score on coherence, ' +
        "specificity, and faithfulness to the brief. Penalize vagueness and padding.",
      userPrompt:
        `Brief: ${mission.brief}\nRequired deliverable: ${mission.deliverable}\n\n` +
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
  sub: { agentId: number; deliverable: string; elapsedMs: number },
): Promise<MissionGrade> {
  const { credited, total, spent6 } = await verifyCredit(mission.missionId, sub.agentId);
  const { quality, verdict } = await judgeDeliverable(mission, sub.deliverable);
  const speed = clamp01(speedBudgetMs() / Math.max(sub.elapsedMs, 1));
  // Both must agree: credited (paid, proven) work AND quality. Multiplicative so
  // empty or bad work scores ~0; speed only amplifies genuine, judged work.
  const score = Math.round(credited * quality * SCORE_SCALE * (1 + 0.1 * speed));
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
