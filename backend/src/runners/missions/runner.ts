/// The MissionRunner: drives each operative through the make-or-buy loop
/// (docs/missions.md section 3). Per operative, per fragment, the operative's own
/// LLM decides MAKE (pay an x402 service) or BUY (an on-chain A2A payment to a
/// specialist); the operative then synthesizes a deliverable from what it
/// gathered and submits. Every spend is a real on-chain settlement captured for
/// the live economy tape and the grader's credit-requires-payment gate.
///
/// v1 covers the SOLVER and ANALYST domains (the x402 + A2A loop). The SCOUT
/// domain (on-chain DeFi execution) is a later batch; this runner refuses a scout
/// mission rather than half-run it.

import { config } from "../../config/index.js";
import { query } from "../../db/pool.js";
import { callModel, llmConfigured } from "./../llm/client.js";
import { modelForTier } from "./../llm/tierConfig.js";
import { deriveHotWallet } from "../scout.js";
import { payX402 } from "../../nanopayments/index.js";
import type {
  AgentResult,
  ContestEntryInput,
  Runner,
  TapeEvent,
} from "../types.js";
import type { Commission, FragmentDecision, MakeOrBuy, MissionFragment } from "./types.js";
import { loadMission } from "./generator.js";
import { getSpecialistForFragment } from "./specialists.js";
import { buyIntel } from "./a2a.js";
import { gradeSubmission, type MissionGrade } from "./grader.js";

/// USDC 6-decimals as a short human string for prompts and labels.
function fmtUsdc6(v: bigint | string): string {
  const n = typeof v === "string" ? BigInt(v || "0") : v;
  return (Number(n) / 1e6).toFixed(4);
}

/// Bounds one operative's whole run so a hung RPC / API can't wedge the field.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

/// The options available for a fragment, computed once per mission (specialists
/// and services are the same for every operative).
interface FragmentOptions {
  fragment: MissionFragment;
  /// Whether an x402 service can MAKE this fragment.
  canMake: boolean;
  /// Specialist price (USDC 6-dec string) when a BUY is available, else null.
  buyPrice6: string | null;
  specialistAgentId: number | null;
}

export class MissionRunner implements Runner {
  readonly kind = "solver" as const; // missions ride a solver-type contest on-chain

  async run(contestId: number, entries: ContestEntryInput[]): Promise<AgentResult[]> {
    const mission = await loadMission(contestId);
    if (!mission) {
      throw new Error(`contest ${contestId} is not a mission`);
    }
    if (mission.domain === "scout") {
      throw new Error("scout-domain missions are not wired yet (later batch)");
    }

    // Resolve each fragment's options once.
    const options: FragmentOptions[] = [];
    for (const f of mission.fragments) {
      const specialist = await getSpecialistForFragment(contestId, f.id);
      options.push({
        fragment: f,
        canMake: !!f.service,
        buyPrice6: specialist ? specialist.price6 : null,
        specialistAgentId: specialist ? specialist.agentId : null,
      });
    }

    const perOpMs = Number(process.env.MISSION_OPERATIVE_TIMEOUT_MS ?? "120000");
    const results: AgentResult[] = [];
    for (const entry of entries) {
      try {
        const r = await withTimeout(
          this.runOperative(mission, options, entry),
          perOpMs,
          `operative ${entry.agentId}`,
        );
        results.push(r);
      } catch (err) {
        // A failed operative scores zero but never blocks the rest of the field.
        console.warn(`[mission] operative ${entry.agentId} failed: ${err instanceof Error ? err.message : err}`);
        results.push({
          agentId: entry.agentId,
          operator: entry.operator,
          score: 0,
          detail: { domain: mission.domain, error: String(err instanceof Error ? err.message : err), fragmentsCredited: 0 },
        });
      }
    }
    return results;
  }

  /// Runs the full loop for one operative: decide make/buy per fragment, execute
  /// (real on-chain settlements), synthesize, persist, and shape the result.
  private async runOperative(
    mission: Commission,
    options: FragmentOptions[],
    entry: ContestEntryInput,
  ): Promise<AgentResult> {
    const startedAt = Date.now();
    const decisions = await this.decide(mission, options, entry.tier);

    const events: TapeEvent[] = [];
    const fragmentData: Array<{ ask: string; data: unknown }> = [];
    const decisionRows: FragmentDecision[] = [];

    // Execute decisions sequentially: one operative wallet sends the A2A
    // transfers, so serial execution keeps the nonce ordering clean.
    for (const opt of options) {
      const d = decisions.get(opt.fragment.id) ?? { choice: "skip" as MakeOrBuy, reason: "no decision" };
      const row: FragmentDecision = {
        fragmentId: opt.fragment.id,
        choice: d.choice,
        reason: d.reason,
        settled: false,
        spent6: "0",
      };

      if (d.choice === "make" && opt.canMake && opt.fragment.service) {
        const made = await this.make(mission, opt, entry).catch((err) => {
          console.warn(`[mission] make failed f=${opt.fragment.id}: ${err instanceof Error ? err.message : err}`);
          return null;
        });
        if (made && made.settled && made.txHash) {
          row.settled = true;
          row.txHash = made.txHash;
          row.spent6 = made.spent6;
          row.data = made.data;
          fragmentData.push({ ask: opt.fragment.ask, data: made.data });
          events.push(this.tape(entry.agentId, made.spent6, made.txHash, opt.fragment.service.chain, opt.fragment.service.label));
        }
      } else if (d.choice === "buy" && opt.buyPrice6) {
        const bought = await buyIntel({ missionId: mission.missionId, fragmentId: opt.fragment.id, buyerAgentId: entry.agentId }).catch((err) => {
          console.warn(`[mission] buy failed f=${opt.fragment.id}: ${err instanceof Error ? err.message : err}`);
          return null;
        });
        if (bought && bought.ok && bought.txHash) {
          row.settled = true;
          row.txHash = bought.txHash;
          row.spent6 = bought.price6 ?? "0";
          row.data = bought.intel;
          row.specialistAgentId = bought.sellerAgentId;
          fragmentData.push({ ask: opt.fragment.ask, data: bought.intel });
          events.push(this.tape(entry.agentId, bought.price6 ?? "0", bought.txHash, "arc", `intel from agent ${bought.sellerAgentId}`));
        }
      }
      // 'skip' (or a failed make/buy) leaves the row unsettled.

      decisionRows.push(row);
      await this.persistDecision(mission.missionId, entry.agentId, row);
    }

    const deliverable = await this.synthesize(mission, fragmentData, entry.tier);
    const elapsedMs = Date.now() - startedAt;

    // Grade: the judge scores quality and the credit gate re-verifies on-chain
    // payment proof per fragment. The grade owns the final, deterministic score.
    const grade = await gradeSubmission(mission, { agentId: entry.agentId, deliverable, elapsedMs });
    await this.persistSubmission(mission.missionId, entry, deliverable, elapsedMs, grade);

    const correct = decisionRows.map((r) => r.settled);
    return {
      agentId: entry.agentId,
      operator: entry.operator,
      score: grade.score,
      detail: {
        domain: mission.domain,
        templateId: mission.templateId,
        fragmentsTotal: mission.fragments.length,
        fragmentsCredited: grade.creditedFragments,
        quality: grade.quality,
        verdict: grade.verdict,
        spent6: grade.spent6,
        decisions: decisionRows,
        deliverable,
        elapsedMs,
        strength: { effective: grade.creditedFragments, tierBase: entry.tier, training: 0, traits: 0 },
      },
      progress: {
        kind: "solver",
        events,
        correct,
        total: mission.fragments.length,
      },
    };
  }

  /// The autonomous make-or-buy decision. One LLM call returns a choice per
  /// fragment; a heuristic fallback runs when the model is unavailable or its
  /// output is malformed (buy when a specialist is cheaper/only option, make when
  /// a service is the only option, skip when neither exists).
  private async decide(
    mission: Commission,
    options: FragmentOptions[],
    tier: number,
  ): Promise<Map<string, { choice: MakeOrBuy; reason: string }>> {
    const out = new Map<string, { choice: MakeOrBuy; reason: string }>();
    const fallback = () => {
      for (const o of options) {
        let choice: MakeOrBuy = "skip";
        if (o.buyPrice6 && o.canMake) choice = "buy"; // both available: prefer the ready intel
        else if (o.buyPrice6) choice = "buy";
        else if (o.canMake) choice = "make";
        out.set(o.fragment.id, { choice, reason: "heuristic" });
      }
    };

    if (!llmConfigured()) {
      fallback();
      return out;
    }

    const lines = options
      .map((o) => {
        const make = o.canMake ? (o.fragment.service?.label ?? "a data service") : "unavailable";
        const buy = o.buyPrice6 ? `${fmtUsdc6(o.buyPrice6)} USDC from a specialist agent` : "unavailable";
        return `${o.fragment.id}: "${o.fragment.ask}" | make: ${make} | buy: ${buy}`;
      })
      .join("\n");
    const system =
      "You are an autonomous operative agent on a paid mission. For each fragment, " +
      "decide MAKE (pay the data service), BUY (pay a specialist agent for ready " +
      "intel), or SKIP. Prefer BUY when it is the only option or clearly cheaper/" +
      "faster; MAKE when you want fresh first-hand data; SKIP only when a fragment " +
      "is irrelevant to the deliverable. Return ONLY a JSON array.";
    const user =
      `Brief: ${mission.brief}\nDeliverable: ${mission.deliverable}\n\nFragments:\n${lines}\n\n` +
      `Return: [{"fragmentId":"...","choice":"make|buy|skip","reason":"short"}]`;

    try {
      const res = await callModel({
        model: modelForTier(tier),
        systemPrompt: system,
        userPrompt: user,
        maxTokens: 500,
        temperature: 0.4,
      });
      const arr = parseJsonArray(res.text);
      if (!arr) throw new Error("no json array");
      for (const item of arr) {
        const id = String((item as Record<string, unknown>).fragmentId ?? "");
        const choiceRaw = String((item as Record<string, unknown>).choice ?? "skip").toLowerCase();
        const choice: MakeOrBuy = choiceRaw === "make" || choiceRaw === "buy" ? (choiceRaw as MakeOrBuy) : "skip";
        const reason = String((item as Record<string, unknown>).reason ?? "");
        if (id) out.set(id, { choice, reason });
      }
      // Any fragment the model skipped naming falls back to the heuristic.
      for (const o of options) {
        if (!out.has(o.fragment.id)) {
          const choice: MakeOrBuy = o.buyPrice6 ? "buy" : o.canMake ? "make" : "skip";
          out.set(o.fragment.id, { choice, reason: "heuristic (unspecified)" });
        }
      }
      // Repair impossible choices (chose make with no service, etc).
      for (const o of options) {
        const cur = out.get(o.fragment.id)!;
        if (cur.choice === "make" && !o.canMake) cur.choice = o.buyPrice6 ? "buy" : "skip";
        if (cur.choice === "buy" && !o.buyPrice6) cur.choice = o.canMake ? "make" : "skip";
      }
      return out;
    } catch {
      fallback();
      return out;
    }
  }

  /// MAKE: pay the fragment's x402 service. Real USDC settlement via the existing
  /// nanopayments path (which records the nanopayments row and returns the tx).
  private async make(
    mission: Commission,
    opt: FragmentOptions,
    entry: ContestEntryInput,
  ): Promise<{ settled: boolean; txHash?: string; spent6: string; data: unknown }> {
    const service = opt.fragment.service!;
    const tier = entry.tier;
    const perPuzzle = config.nanopay.perPuzzleByTier[Math.min(Math.max(tier, 0), 4)] ?? 0;
    const budget6 = BigInt(Math.round(perPuzzle * 1e6));
    const payWallet = config.nanopay.walletAddress ?? deriveHotWallet(entry.agentId).address;

    const res = await payX402({
      agentId: entry.agentId,
      contestId: mission.missionId,
      puzzleIdx: fragmentIndex(mission, opt.fragment.id),
      tier,
      endpoint: service.endpoint,
      endpointLabel: service.label,
      payload: { query: opt.fragment.ask },
      budgetRemaining6: budget6,
      walletAddress: payWallet,
      chain: service.chain,
    });
    return {
      settled: res.status === "settled",
      txHash: res.txHash,
      spent6: res.usdcAmount6.toString(),
      data: res.response ?? null,
    };
  }

  /// Synthesizes the deliverable from the gathered fragments. LLM when available,
  /// else a plain concatenation so a submission always exists.
  private async synthesize(
    mission: Commission,
    gathered: Array<{ ask: string; data: unknown }>,
    tier: number,
  ): Promise<string> {
    if (gathered.length === 0) return "(no fragments sourced)";
    const bundle = gathered.map((g, i) => `(${i + 1}) ${g.ask}\n${stringifyData(g.data)}`).join("\n\n");
    if (!llmConfigured()) {
      return `Synthesis from ${gathered.length} fragment(s):\n${bundle}`;
    }
    try {
      const res = await callModel({
        model: modelForTier(tier),
        systemPrompt:
          "You are an operative agent producing the mission deliverable. Synthesize the " +
          "gathered fragments into the required deliverable. Be concise and concrete; use " +
          "only what the fragments support.",
        userPrompt: `Brief: ${mission.brief}\nDeliverable required: ${mission.deliverable}\n\nGathered fragments:\n${bundle}`,
        maxTokens: 500,
        temperature: 0.5,
      });
      return res.text.trim() || `Synthesis from ${gathered.length} fragment(s):\n${bundle}`;
    } catch {
      return `Synthesis from ${gathered.length} fragment(s):\n${bundle}`;
    }
  }

  private tape(agentId: number, amount6: string, txHash: string, chain: string, label: string): TapeEvent {
    return { agentId, verb: "PAY", amount6, token: "USDC", txHash, chain, label, ts: Date.now() };
  }

  private async persistDecision(missionId: number, agentId: number, r: FragmentDecision): Promise<void> {
    await query(
      `insert into mission_decisions
         (contest_id, agent_id, fragment_id, choice, reason, settled, tx_hash, spent_usdc_6, specialist_agent_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (contest_id, agent_id, fragment_id) do update set
         choice=excluded.choice, reason=excluded.reason, settled=excluded.settled,
         tx_hash=excluded.tx_hash, spent_usdc_6=excluded.spent_usdc_6,
         specialist_agent_id=excluded.specialist_agent_id`,
      [missionId, agentId, r.fragmentId, r.choice, r.reason, r.settled, r.txHash ?? null, r.spent6 ?? "0", r.specialistAgentId ?? null],
    );
  }

  private async persistSubmission(
    missionId: number,
    entry: ContestEntryInput,
    deliverable: string,
    elapsedMs: number,
    grade: MissionGrade,
  ): Promise<void> {
    const judged = {
      quality: grade.quality,
      verdict: grade.verdict,
      credited: grade.creditedFragments,
      total: grade.totalFragments,
      spent6: grade.spent6,
    };
    await query(
      `insert into mission_submissions (contest_id, agent_id, operator, deliverable, elapsed_ms, score, judged)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (contest_id, agent_id) do update set
         deliverable=excluded.deliverable, elapsed_ms=excluded.elapsed_ms,
         score=excluded.score, judged=excluded.judged`,
      [missionId, entry.agentId, entry.operator.toLowerCase(), deliverable, elapsedMs, grade.score, JSON.stringify(judged)],
    );
  }
}

function fragmentIndex(mission: Commission, fragmentId: string): number {
  const i = mission.fragments.findIndex((f) => f.id === fragmentId);
  return i < 0 ? 0 : i;
}

function stringifyData(d: unknown): string {
  if (d == null) return "(none)";
  if (typeof d === "string") return d;
  try {
    return JSON.stringify(d).slice(0, 600);
  } catch {
    return String(d);
  }
}

function parseJsonArray(text: string): unknown[] | null {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return null;
  try {
    const v = JSON.parse(m[0]);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
