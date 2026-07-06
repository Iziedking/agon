import { createWalletClient, http, parseAbi, zeroAddress } from "viem";
import type { Account } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { arcTestnet, publicClient } from "../chain/arc.js";
import { config } from "../config/index.js";
import { query } from "../db/pool.js";
import { AnalystRunner } from "../runners/analyst.js";
import { ScoutRunner } from "../runners/scout.js";
import { SolverRunner } from "../runners/solver.js";
import { loadMission } from "../runners/missions/generator.js";
import { getSpecialistForFragment } from "../runners/missions/specialists.js";
import { refundMissionFees, refundMissionBuys, markMissionStatus } from "../runners/missions/fees.js";
import { MissionRunner } from "../runners/missions/runner.js";
import type { AgentResult, ContestEntryInput } from "../runners/types.js";

/// Build the "you placed" notification, worded for a mission or a contest. A
/// mission rides a contest, so the same settlement path serves both — this just
/// labels it and links to the right page.
async function winNotice(contestId: number, rank: number, amount: bigint) {
  const isMission = (await query("select 1 from missions where contest_id = $1 limit 1", [contestId])).rows.length > 0;
  const noun = isMission ? "mission" : "contest";
  return {
    kind: "contest_win" as const,
    title: `You placed #${rank} in ${noun} #${contestId}`,
    body: `prize ${(Number(amount) / 1e6).toFixed(2)} USDC. claim it from the ${noun} page.`,
    href: isMission ? `/missions/${contestId}` : `/contests/${contestId}`,
    context: { contestId, rank, amount: amount.toString() },
  };
}
import { fundHotWallets, sweepHotWallets } from "./contestOps.js";
import { applyReputation, creditPoints, postValidatorFeedback, qualifiedField, recordSyndicateContributions } from "./reputation.js";
import { merkleRoot, payoutLeaf } from "./merkle.js";
import { computeDistribution, normalizeScoringMode } from "./payouts.js";
import { applyTraitMultipliers, awardPlacementTraits, awardWinStreaks, fetchAgentMultipliers } from "./traits.js";
import { notify } from "../notifications/index.js";
import { getTierGate, tierAllowed } from "../lib/tierGate.js";
import { saveStandingsSnapshot } from "./standingsSnapshot.js";
import {
  applyTrainingMultipliers,
  clampCombinedMultiplier,
  fetchTrainingMultipliers,
  flushTrainingQueue,
} from "./training.js";
import {
  applySyndicateMultipliers,
  fetchSyndicateMultipliers,
} from "./syndicateWar.js";

/// Generic contest engine: take a real, open contest, assemble the field of
/// every operator who entered (from the indexer's entries table, with each
/// agent's tier read from AgentRegistry), stream standings over the window,
/// then run the right runner over the whole field and settle on-chain.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Cap how long we wait for a settlement tx receipt. Without this, a tx that
// never mines (a stuck coordinator nonce) hangs the run forever, which under
// the single-flight guard means the contest never retries. Bounded, the run
// fails, the guard clears, and the next sweep retries cleanly (the persisted-
// payout guard keeps the retry on the same merkle root).
const SETTLE_RECEIPT_TIMEOUT_MS = Number(process.env.SETTLE_RECEIPT_TIMEOUT_SECONDS ?? "90") * 1000;

const engineAbi = parseAbi([
  "function getContest(uint256 contestId) view returns ((uint8 contestType,uint8 status,uint16 winnerCutBps,uint16 topN,uint16 platformFeeBps,address sponsor,address protocolTarget,bytes32 metric,uint64 startTime,uint64 endTime,uint256 prizePool,bytes32 finalRoot))",
  "function postScoreRoot(uint256 contestId,bytes32 root)",
  "function settle(uint256 contestId)",
  "function cancelContest(uint256 contestId)",
]);
const registryAbi = parseAbi(["function getTier(uint256 agentId, uint8 cType) view returns (uint16)"]);

function coordinatorWallet() {
  if (!config.coordinator.privateKey) throw new Error("COORDINATOR_PRIVATE_KEY required to settle");
  const pk = config.coordinator.privateKey.startsWith("0x")
    ? config.coordinator.privateKey
    : `0x${config.coordinator.privateKey}`;
  const account = privateKeyToAccount(pk as `0x${string}`);
  return createWalletClient({ account: account as Account, chain: arcTestnet, transport: http(config.rpcHttp) });
}

/// The real field: every entered agent and its tier for this contest's
/// family. Tier is snapshotted by the indexer on EntryRegistered, so the
/// row carries it and the hot path (called every 2.5s during the live
/// window) reads from the row instead of round-tripping to the chain
/// once per agent per tick. Legacy rows with `tier IS NULL` fall back
/// to a live read and backfill the row so the next tick uses the
/// cached value.
async function fetchField(contestId: number, cType: number): Promise<ContestEntryInput[]> {
  // Exclude any operative who withdrew from this mission within the join window:
  // they were refunded and must not be run or scored. No-op for ordinary
  // contests (no withdrawal rows).
  const { rows } = await query<{ agent_id: string; operator: string; tier: number | null }>(
    `select e.agent_id, e.operator, e.tier from entries e
      where e.contest_id = $1
        and not exists (select 1 from mission_withdrawals w
                        where w.contest_id = e.contest_id and lower(w.operator) = lower(e.operator))
      order by e.agent_id`,
    [contestId],
  );
  const field: ContestEntryInput[] = [];
  for (const r of rows) {
    let tier = r.tier;
    if (tier === null) {
      try {
        tier = Number(
          (await publicClient.readContract({
            address: config.contracts.AgentRegistry,
            abi: registryAbi,
            functionName: "getTier",
            args: [BigInt(r.agent_id), cType],
          })) as number,
        );
        // Backfill so subsequent ticks read from the row.
        await query("update entries set tier = $3 where contest_id = $1 and agent_id = $2", [
          contestId,
          r.agent_id,
          tier,
        ]);
      } catch {
        // RPC blip: treat as tier 0 for this tick. The indexer or a
        // later tick will fix the row.
        tier = 0;
      }
    }
    field.push({ agentId: Number(r.agent_id), operator: r.operator as `0x${string}`, tier: Number(tier) });
  }
  // Enforce the tier gate: drop any entry whose agent tier falls outside the
  // host's chosen range so an on-chain bypass can't score or win. Contest
  // entries carry no stake, so there is nothing to refund.
  const gate = await getTierGate("contest", contestId);
  if (gate) {
    const before = field.length;
    const allowed = field.filter((e) => tierAllowed(gate, e.tier));
    if (allowed.length !== before) {
      console.log(`contest ${contestId}: tier gate ${gate.minTier}-${gate.maxTier} dropped ${before - allowed.length} out-of-range entr${before - allowed.length === 1 ? "y" : "ies"}`);
    }
    return allowed;
  }
  return field;
}

/// Lineup preview while the ENTRY (join) window is open. We deliberately do
/// NOT run the real puzzle/analysis/volume here: doing so made agents appear to
/// finish ("4/6 solved") before the join timer even ended. Instead every type
/// shows a tier-based lineup, so the open window reads as "agents assembling,
/// join still open". The authoritative run (finalScores) happens once at
/// settlement, after entries close, and reveals the real result.
async function previewScores(_cType: number, _contestId: number, field: ContestEntryInput[]): Promise<AgentResult[]> {
  return field.map((e) => ({ agentId: e.agentId, operator: e.operator, score: (e.tier + 1) * 100, detail: {} }));
}

// Contest puzzle sets are wider than the old fixed 6 so a Solver campaign
// spans more categories. Entries stay open until endTime and scoring happens
// once at settlement (fair: every agent faces the same set), so this is a
// single set, not the challenge's progressive rounds.
const SOLVER_CONTEST_PUZZLES = Number(process.env.SOLVER_CONTEST_PUZZLES ?? "12");

/// Authoritative scoring at settlement. Volume (Scout) and Puzzle (Solver) run
/// the REAL work as a live streamed race when given a broadcast ctx: the runner
/// emits a standings frame after every swap / solve so the economy tape fills
/// while viewers watch the post-close window, then we score and settle. Analyst
/// ignores ctx (its real Arcana trades already stream via the tick scheduler
/// during the open window).
async function finalScores(
  cType: number,
  contestId: number,
  field: ContestEntryInput[],
  ctx?: { broadcast: (message: unknown) => void; deadlineMs: number; source: "contest"; endsAtMs: number },
): Promise<AgentResult[]> {
  // A mission rides a solver-type contest on-chain; when this contest is tagged
  // in the missions table, run the MissionRunner instead of the family runner.
  const mission = await loadMission(contestId);
  if (mission) return runMission(contestId, field);
  if (cType === 0) return new ScoutRunner(5).run(contestId, field, ctx);
  if (cType === 1) return new AnalystRunner().run(contestId, field);
  return new SolverRunner(SOLVER_CONTEST_PUZZLES).run(contestId, field, ctx);
}

/// The USDC an operative needs to BUY every fragment on the A2A rail: the sum of
/// the price it will actually be quoted per fragment (the same specialist
/// getSpecialistForFragment picks — operator sellers preferred, else the platform
/// shelf), plus a gas reserve per fragment (USDC is gas on Arc) and a margin.
/// A FLAT float (the old default, 2 USDC) sits below the intel price band for any
/// real pool, so every BUY was declined "buyer underfunded" and the mission
/// cancelled with nobody credited — the recurring internal-mission cancel.
async function operativeFloatUsdcFor(contestId: number): Promise<number> {
  const mission = await loadMission(contestId);
  if (!mission) return config.mission.operativeFloatUsdc;
  const GAS_RESERVE6 = BigInt(Math.round(Number(process.env.MISSION_GAS_RESERVE_USDC ?? "0.05") * 1e6));
  let total6 = 0n;
  for (const f of mission.fragments) {
    const spec = await getSpecialistForFragment(contestId, f.id).catch(() => null);
    if (spec) total6 += BigInt(spec.price6) + GAS_RESERVE6;
  }
  if (total6 === 0n) return config.mission.operativeFloatUsdc;
  // 15% margin so a small price move or a second-choice seller still clears.
  const withMargin = Number((total6 * 115n) / 100n) / 1e6;
  return Math.max(config.mission.operativeFloatUsdc, withMargin);
}

/// Funds each operative the USDC float it needs to BUY intel from specialists over
/// the A2A rail (sized per mission, see operativeFloatUsdcFor), runs the
/// MissionRunner, then sweeps the leftover floats back. The float is PER OPERATIVE,
/// bounded by MISSION_FUND_MAX_USDC as a per-operative ceiling (a runaway operator
/// price can't front an absurd sum). The total scales with the field, which is
/// fine: the float is working capital recovered by the post-run sweep, so a big
/// field is not starved the way a field-wide total cap starved it. A cap that
/// bites is logged. Falls through to an unfunded run (BUY paths just decline) when
/// no master mnemonic is set.
async function runMission(contestId: number, field: ContestEntryInput[]): Promise<AgentResult[]> {
  const ids = field.map((e) => e.agentId);
  const need = await operativeFloatUsdcFor(contestId);
  const perOp = Math.min(need, config.mission.fundMaxUsdc);
  if (perOp > 0 && config.scout.masterMnemonic) {
    if (perOp < need) {
      console.warn(
        `[mission ${contestId}] operative float capped at ${perOp.toFixed(2)} USDC (need ${need.toFixed(2)}) by the per-operative ceiling MISSION_FUND_MAX_USDC=${config.mission.fundMaxUsdc}; some BUYs may decline. Raise MISSION_FUND_MAX_USDC.`,
      );
    }
    await fundHotWallets(ids, perOp).catch((err) =>
      console.warn(`[mission] fund failed: ${err instanceof Error ? err.message : err}`),
    );
  }
  const results = await new MissionRunner().run(contestId, field);
  if (config.scout.masterMnemonic) {
    await sweepHotWallets(ids).catch((err) =>
      console.warn(`[mission] sweep failed: ${err instanceof Error ? err.message : err}`),
    );
  }
  // The bar: a mission only pays out if at least one operative cleared
  // MISSION_MIN_SCORE. If nobody did (junk deliverables score near zero), pay
  // no one — returning [] routes the contest into the no-scoring-entrants path,
  // which cancels and refunds the sponsor.
  const best = results.reduce((m, r) => Math.max(m, r.score), 0);
  if (config.mission.minScore > 0 && best < config.mission.minScore) {
    console.log(
      `[mission ${contestId}] no operative met the bar (best ${Math.round(best)} < ${config.mission.minScore}); cancelling and refunding — no agent could fulfill it within the window`,
    );
    return [];
  }
  return results;
}

function standings(results: AgentResult[]) {
  return results
    .slice()
    .sort((a, b) => b.score - a.score)
    .map((r, i) => ({
      rank: i + 1,
      agentId: r.agentId,
      operator: r.operator,
      score: Math.round(r.score),
      // Carry the runner's progress through to the wire so the frontend stage
      // renders real per-agent state (solver cells, analyst calls, scout tx
      // hashes) instead of deriving visible state from the score.
      progress: r.progress,
    }));
}

/// Reveal a fraction of the authoritative result: each agent's progress arrays
/// are sliced to the first `frac` of their items and the score scaled to match,
/// so a sequence of increasing fractions plays the real work back as a visible
/// race (cells filling, tx tape growing, scores climbing) before the final
/// frame locks it in. Honest: the revealed items are the real ones, fewer early.
function revealProgress(results: AgentResult[], frac: number): AgentResult[] {
  const cut = <T>(arr: T[], f: number) => arr.slice(0, Math.max(1, Math.ceil(arr.length * f)));
  return results.map((r) => {
    const score = Math.round(r.score * frac);
    const p = r.progress;
    if (!p) return { ...r, score };
    if (p.kind === "solver") {
      return {
        ...r,
        score,
        progress: {
          ...p,
          correct: cut(p.correct, frac),
          perPuzzleMs: p.perPuzzleMs ? cut(p.perPuzzleMs, frac) : undefined,
          spent: p.spent ? cut(p.spent, frac) : undefined,
          spentLabels: p.spentLabels ? cut(p.spentLabels, frac) : undefined,
        },
      };
    }
    if (p.kind === "scout") {
      return {
        ...r,
        score,
        progress: {
          ...p,
          recent: cut(p.recent, frac),
          recentVolumes: p.recentVolumes ? cut(p.recentVolumes, frac) : undefined,
        },
      };
    }
    if (p.kind === "analyst") {
      return { ...r, score, progress: { ...p, calls: cut(p.calls, frac) } };
    }
    return { ...r, score };
  });
}

export async function runContestById(contestId: number, broadcast: (message: unknown) => void): Promise<void> {
  const engine = config.contracts.ContestEngine;
  const c = await publicClient.readContract({
    address: engine,
    abi: engineAbi,
    functionName: "getContest",
    args: [BigInt(contestId)],
  });
  if (c.sponsor === zeroAddress) {
    console.log(`contest ${contestId} does not exist`);
    return;
  }
  if (Number(c.status) !== 1) {
    console.log(`contest ${contestId} is not OPEN (status ${Number(c.status)}); nothing to run`);
    return;
  }

  const cType = Number(c.contestType);
  const endsAtMs = Number(c.endTime) * 1000;
  console.log(`running contest ${contestId} (type ${cType}); entries close at ${new Date(endsAtMs).toISOString()}`);

  // Stream standings of the real field while the entry window is open. Each
  // frame applies trait + training + syndicate-war multipliers so the live
  // race visibly reflects everything the agent brings to the table. Combined
  // multiplier is capped at 3.5x (MAX_COMBINED_MULTIPLIER).
  while (Date.now() < endsAtMs) {
    const field = await fetchField(contestId, cType);
    const ids = field.map((e) => e.agentId);
    const operators = field.map((e) => e.operator);
    // Promote any expired training queue rows before reading multipliers.
    await flushTrainingQueue().catch(() => 0);
    const preview = field.length > 0 ? await previewScores(cType, contestId, field) : [];
    const baselines = new Map(preview.map((r) => [r.agentId, r.score] as const));
    const [traitMult, trainMult, synMult] = await Promise.all([
      fetchAgentMultipliers(ids),
      fetchTrainingMultipliers(ids),
      fetchSyndicateMultipliers(operators),
    ]);
    // Puzzle (solver, cType 2) is pure skill: no tier/trait/training/syndicate
    // multiplier, so the best solver wins. Volume + prediction still apply the
    // multipliers. (Training is neutralized inside fetchTrainingMultipliers
    // since it already counts once in the runner.)
    const boosted =
      cType === 2
        ? preview
        : clampCombinedMultiplier(
            applySyndicateMultipliers(applyTrainingMultipliers(applyTraitMultipliers(preview, traitMult), trainMult), synMult),
            baselines,
          );
    broadcast({ type: "standings", contestId, endsAt: endsAtMs, entries: standings(boosted) });
    await sleep(2500);
  }

  // Window closed. Wait a beat so chain time is past endTime, then settle.
  await sleep(3000);

  // Retry-safe settlement. If a previous sweep already scored this contest and
  // persisted its payout tree, reuse it so postScoreRoot/settle retry with the
  // SAME merkle root. Re-running the real race on a retry would roll fresh
  // randomness and the new root would not match the persisted payouts (the
  // exact bug runChallengeById already guards against). On the retry path we
  // skip scoring, the reveal, and the post-settlement rewards (they ran on the
  // first attempt); only the two on-chain txs retry.
  {
    const persisted = await query<{ rank: number; operator: string; amount: string }>(
      "select rank, operator, amount from payouts where contest_id = $1 order by rank",
      [contestId],
    );
    if (persisted.rows.length > 0) {
      const payouts = persisted.rows.map((r) => ({ operator: r.operator as `0x${string}`, amount: BigInt(r.amount) }));
      console.log(`contest ${contestId}: retrying settlement with ${payouts.length} previously persisted payout(s)`);
      const wallet = coordinatorWallet();
      const send = async (params: Parameters<typeof wallet.writeContract>[0]) => {
        const hash = await wallet.writeContract(params as never);
        await publicClient.waitForTransactionReceipt({ hash, timeout: SETTLE_RECEIPT_TIMEOUT_MS });
        return hash;
      };
      const root = merkleRoot(payouts.map((p) => payoutLeaf(p.operator, p.amount)));
      await send({ address: engine, abi: engineAbi, functionName: "postScoreRoot", args: [BigInt(contestId), root] });
      await send({ address: engine, abi: engineAbi, functionName: "settle", args: [BigInt(contestId)] });
      console.log(`contest ${contestId} settled on-chain (retry) with ${payouts.length} winner(s)`);
      broadcast({
        type: "settled",
        contestId,
        winners: payouts.map((p, i) => ({ rank: i + 1, operator: p.operator, amount: p.amount.toString() })),
      });
      for (let i = 0; i < payouts.length; i++) {
        const p = payouts[i]!;
        void notify(p.operator, await winNotice(contestId, i + 1, p.amount));
      }
      return;
    }
  }

  let field = await fetchField(contestId, cType);

  // Off-chain qualification gate (no-op unless QUALIFY_MIN_POINTS is set).
  field = await qualifiedField(field);

  // Scout scoring runs real on-chain operations from each agent's hot wallet, so
  // those wallets need USDC first. Top them up from the coordinator wallet (one
  // Arc USDC balance covers gas and transfers). Pure contests skip this.
  if (cType === 0 && field.length > 0 && config.scout.masterMnemonic && config.coordinator.privateKey) {
    console.log(`contest ${contestId}: topping up ${field.length} Scout hot wallet(s) to their tier funding cap (max ${config.scout.fundMaxUsdc} USDC)`);
    await fundHotWallets(field.map((e) => ({ agentId: e.agentId, tier: e.tier })));
  }

  // Volume (Scout) and Puzzle (Solver) run the real work as a live streamed
  // race in this post-close window: the runner broadcasts a standings frame per
  // swap / solve so the economy tape fills while viewers watch, then we score
  // and settle. The race is time-bounded (CONTEST_RACE_SECONDS, the runner caps
  // it again internally) so scoring + the two settlement txs land inside the
  // sweeper's per-event timeout. postScoreRoot is valid because we are already
  // past endTime here. Analyst burst-scores (its trades streamed during open).
  // Scout uses the full trait-aware window (up to ~180s); the runner stops the
  // race earlier for a bare field and caps itself internally. Solver caps its own
  // solve window well under this. Scoring + the two settle txs then fit inside the
  // 240s sweeper budget.
  const streamed = cType === 0 || cType === 2;
  const raceSeconds = Number(process.env.CONTEST_RACE_SECONDS ?? "420");
  const raceCtx = streamed
    ? { broadcast, deadlineMs: Date.now() + raceSeconds * 1000, source: "contest" as const, endsAtMs }
    : undefined;
  if (streamed && field.length > 0) {
    console.log(
      `contest ${contestId}: streaming live ${cType === 0 ? "scout swap" : "puzzle solve"} race to ${field.length} entrant(s) for up to ${raceSeconds}s`,
    );
  }

  const baseResults = await finalScores(cType, contestId, field, raceCtx);
  // Authoritative scoring picks up trait + training + syndicate-war
  // multipliers so the on-chain payout reflects the same boosts viewers
  // saw on the live race. Combined multiplier capped at 3.5x.
  await flushTrainingQueue().catch(() => 0);
  const ids = field.map((e) => e.agentId);
  const operators = field.map((e) => e.operator);
  const baselines = new Map(baseResults.map((r) => [r.agentId, r.score] as const));
  const [traitMult, trainMult, synMult] = await Promise.all([
    fetchAgentMultipliers(ids),
    fetchTrainingMultipliers(ids),
    fetchSyndicateMultipliers(operators),
  ]);
  // Puzzle (solver) settles on pure skill: no upgrade multipliers. Volume +
  // prediction apply trait/syndicate (training already counts once in the
  // runner, so its coordinator pass is a no-op).
  const results =
    cType === 2
      ? baseResults
      : clampCombinedMultiplier(
          applySyndicateMultipliers(applyTrainingMultipliers(applyTraitMultipliers(baseResults, traitMult), trainMult), synMult),
          baselines,
        );

  // Visible "agents at work" replay, ONLY for the non-streamed (Analyst) path.
  // Scout and Solver already streamed the real work live in the race above, so
  // replaying it would double the activity; they skip straight to the final
  // frame. Analyst can still play its deterministic result back progressively.
  // Default off (CONTEST_REVEAL_SECONDS=0); the streamed race is the real show.
  const revealMs = Number(process.env.CONTEST_REVEAL_SECONDS ?? "0") * 1000;
  if (!streamed && revealMs > 0 && results.length > 0) {
    const STEPS = 8;
    for (let s = 1; s < STEPS; s++) {
      broadcast({
        type: "standings",
        contestId,
        endsAt: endsAtMs,
        entries: standings(revealProgress(results, s / STEPS)),
      });
      await sleep(revealMs / STEPS);
    }
  }

  // One final standings frame with the authoritative progress, so Scout's real
  // tx hashes land on the live stage just before the settled banner takes
  // over. Analyst/Solver progress is deterministic per agent, so this frame
  // just confirms what viewers already saw.
  const finalStandings = standings(results);
  broadcast({ type: "standings", contestId, endsAt: endsAtMs, entries: finalStandings });
  // Persist the final frame so a refresh of the settled event replays the full
  // result (volumes, tx, solver cells) for anyone who didn't watch it live.
  void saveStandingsSnapshot("contest", contestId, finalStandings);

  const platformFee = (c.prizePool * BigInt(c.platformFeeBps)) / 10_000n;
  const claimable = c.prizePool - platformFee;
  // Pick the payout curve based on the creator's scoring_mode (Arcana
  // contests only; Scout/Solver fall through to the rank-based curve
  // inside the dispatcher). Default null = pnl_mtm.
  const modeRow = await query<{
    scoring_mode: string | null;
    payout_preset: string | null;
    payout_config: unknown;
    end_block: string | null;
  }>(
    "select scoring_mode, payout_preset, payout_config, created_block::text as end_block from contests where id = $1",
    [contestId],
  );
  const scoringMode = normalizeScoringMode(modeRow.rows[0]?.scoring_mode);
  const payoutPreset = modeRow.rows[0]?.payout_preset ?? null;
  const payoutConfig = modeRow.rows[0]?.payout_config ?? null;

  // PNL_REALIZED gate: if any pinned market is still unresolved and we're
  // under the 48h timeout, bail. The autopilot sweeper retries every 60s
  // and will pick this contest up once markets resolve. Past 48h, we
  // settle with what's resolved (treat unresolved positions as 0 PnL).
  if (scoringMode === "pnl_realized") {
    const { rows: pending } = await query<{ market_id: string; resolved: boolean }>(
      `select pm.market_id, coalesce(m.resolved, false) as resolved
         from contest_arcana_markets pm
         left join arcana_markets m on m.market_id = pm.market_id
        where pm.contest_id = $1`,
      [contestId],
    );
    const unresolved = pending.filter((r) => !r.resolved);
    if (unresolved.length > 0) {
      const elapsedMs = Date.now() - endsAtMs;
      const TIMEOUT_MS = 48 * 60 * 60 * 1000;
      if (elapsedMs < TIMEOUT_MS) {
        const remaining = Math.round((TIMEOUT_MS - elapsedMs) / 1000 / 60);
        console.log(
          `contest ${contestId}: PNL_REALIZED waiting on ${unresolved.length} unresolved market(s), ${remaining}min until timeout`,
        );
        return;
      }
      console.log(
        `contest ${contestId}: PNL_REALIZED 48h timeout, settling with ${pending.length - unresolved.length} resolved market(s), unresolved positions get 0 PnL`,
      );
    }
  }

  const payouts = computeDistribution(payoutPreset, payoutConfig, scoringMode, results, claimable);

  // Persist the payout tree (in leaf order) so the claim-proof endpoint can
  // rebuild the exact tree and serve each winner their proof.
  for (let i = 0; i < payouts.length; i++) {
    await query(
      "insert into payouts (contest_id, rank, operator, amount) values ($1, $2, $3, $4) on conflict (contest_id, rank) do nothing",
      [contestId, i + 1, payouts[i]!.operator.toLowerCase(), payouts[i]!.amount.toString()],
    );
  }

  const wallet = coordinatorWallet();
  async function send(params: Parameters<typeof wallet.writeContract>[0]) {
    const hash = await wallet.writeContract(params as never);
    await publicClient.waitForTransactionReceipt({ hash, timeout: SETTLE_RECEIPT_TIMEOUT_MS });
    return hash;
  }

  if (payouts.length === 0) {
    console.log(`contest ${contestId}: no scoring entrants; cancelling and refunding the sponsor`);
    await send({ address: engine, abi: engineAbi, functionName: "cancelContest", args: [BigInt(contestId)] });
    // Mission close: return the operatives' join fees and the specialists'
    // intel purchases (a void mission costs nobody), then mark it cancelled.
    // All no-op for ordinary contests.
    await refundMissionFees(contestId).catch((err) =>
      console.error(`contest ${contestId}: mission fee refund failed:`, err instanceof Error ? err.message : err),
    );
    await refundMissionBuys(contestId).catch((err) =>
      console.error(`contest ${contestId}: mission intel-buy refund failed:`, err instanceof Error ? err.message : err),
    );
    await markMissionStatus(contestId, "cancelled");
    broadcast({ type: "settled", contestId, winners: [] });
    return;
  }

  const root = merkleRoot(payouts.map((p) => payoutLeaf(p.operator, p.amount)));
  await send({ address: engine, abi: engineAbi, functionName: "postScoreRoot", args: [BigInt(contestId), root] });
  await send({ address: engine, abi: engineAbi, functionName: "settle", args: [BigInt(contestId)] });
  await markMissionStatus(contestId, "settled");
  console.log(`contest ${contestId} settled on-chain with ${payouts.length} winner(s)`);

  broadcast({
    type: "settled",
    contestId,
    winners: payouts.map((p, i) => ({ rank: i + 1, operator: p.operator, amount: p.amount.toString() })),
  });

  // Notify each winner that they placed and can claim.
  for (let i = 0; i < payouts.length; i++) {
    const p = payouts[i]!;
    void notify(p.operator, await winNotice(contestId, i + 1, p.amount));
  }

  // Post-settlement rewards (best-effort, each logs on failure):
  // in-game reputation, Cycles, ERC-8004 validator feedback, and one
  // placement-tagged trait per top-3 finisher.
  await applyReputation(contestId, results);
  await recordSyndicateContributions("contest", contestId, results).catch((err) =>
    console.error(`contest ${contestId}: syndicate contributions failed:`, err instanceof Error ? err.message : err),
  );
  await creditPoints(contestId, cType, results);
  await postValidatorFeedback("contest", contestId, cType, results);
  await awardPlacementTraits("contest", contestId, results).catch((err) =>
    console.error(`contest ${contestId}: placement trait awards failed:`, err instanceof Error ? err.message : err),
  );
  // Consecutive-win streaks: the #1 finisher climbs, everyone else resets. 5 in
  // a row unlocks a rare trait, 10 a legendary. The skill path to traits.
  await awardWinStreaks(contestId, results).catch((err) =>
    console.error(`contest ${contestId}: win-streak update failed:`, err instanceof Error ? err.message : err),
  );

  // Scout-only: pull any leftover USDC out of each agent's hot wallet
  // back to the coordinator. fundHotWallets topped them up before
  // scoring; without a sweep that float leaks across contests. Leaves
  // a small reserve (SCOUT_SWEEP_RESERVE_USDC, default 0.05) so the
  // next round can pay gas without re-funding from scratch.
  if (cType === 0 && field.length > 0 && config.scout.masterMnemonic && config.coordinator.privateKey) {
    await sweepHotWallets(field.map((e) => e.agentId)).catch((err) =>
      console.error(`contest ${contestId}: sweep failed: ${err instanceof Error ? err.message : err}`),
    );
  }
}
