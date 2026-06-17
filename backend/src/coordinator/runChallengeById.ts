import { createWalletClient, http, parseAbi, zeroAddress } from "viem";
import type { Account } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { arcTestnet, publicClient } from "../chain/arc.js";
import { config } from "../config/index.js";
import { query } from "../db/pool.js";
import { AnalystRunner } from "../runners/analyst.js";
import { ScoutRunner } from "../runners/scout.js";
import { SolverRunner } from "../runners/solver.js";
import type { AgentResult, ContestEntryInput } from "../runners/types.js";
import { fundHotWallets, sweepHotWallets } from "./contestOps.js";
import { merkleRoot, payoutLeaf } from "./merkle.js";
import { computeDistribution, normalizeScoringMode } from "./payouts.js";
import { creditPoints, postValidatorFeedback } from "./reputation.js";
import { applyTraitMultipliers, awardPlacementTraits, fetchAgentMultipliers } from "./traits.js";
import { notify } from "../notifications/index.js";
import { getTierGate, tierAllowed } from "../lib/tierGate.js";
import { saveStandingsSnapshot } from "./standingsSnapshot.js";
import {
  applySyndicateMultipliers,
  fetchSyndicateMultipliers,
} from "./syndicateWar.js";
import {
  applyTrainingMultipliers,
  clampCombinedMultiplier,
  fetchTrainingMultipliers,
  flushTrainingQueue,
} from "./training.js";

/// Peer-challenge counterpart to runContestById. Locks a full or expired
/// challenge, scores its entrants with the runner matching the challenge kind,
/// posts the winner root, and persists payouts for claim proofs. Underfilled or
/// stale challenges are cancelled so entrants can refund. Coordinator-role only.

// Bound settlement receipt waits so a stuck tx can't hang the run forever (see
// the same const in runContestById).
const SETTLE_RECEIPT_TIMEOUT_MS = Number(process.env.SETTLE_RECEIPT_TIMEOUT_SECONDS ?? "90") * 1000;

const arenaAbi = parseAbi([
  "function getChallenge(uint256 id) view returns ((address creator,uint8 kind,uint8 status,bool isPrivate,uint16 platformFeeBps,uint128 stake,uint64 maxEntrants,uint64 joinDeadline,uint64 resolveDeadline,bytes32 winnerRoot))",
  "function entrantCount(uint256 id) view returns (uint64)",
  "function joined(uint256 id, address operator) view returns (bool)",
  "function nextChallengeId() view returns (uint256)",
  "function joinChallenge(uint256 id, uint256 agentId)",
  "function lockChallenge(uint256 id)",
  "function postWinnerRoot(uint256 id, bytes32 root)",
  "function cancelChallenge(uint256 id)",
]);
const registryAbi = parseAbi([
  "function getTier(uint256 agentId, uint8 cType) view returns (uint16)",
  "function agentsOf(address owner) view returns (uint256[])",
  "function createAgent(string metadataURI) returns (uint256)",
]);
const usdcAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

// ChallengeKind to ContestType family, for tier reads and the runner choice.
// PREDICTION to ANALYST, PUZZLE to SOLVER, VOLUME to SCOUT, CUSTOM to SOLVER.
const KIND_TO_CTYPE = [1, 2, 0, 2];

// Per-kind score randomness, applied AFTER the runner's scoring so a low-tier
// agent can sometimes upset a high-tier one in noisy kinds. The runner's own
// ±3% global gaming guard is layered with this. Defaults:
// PREDICTION is markets and noisy, PUZZLE is skill-heavy, VOLUME is moderately
// noisy, CUSTOM splits the difference. Override per kind via env, e.g.
// `CHALLENGE_RANDOMNESS_PREDICTION=0.30`.
const KIND_NAMES = ["PREDICTION", "PUZZLE", "VOLUME", "CUSTOM"] as const;
const KIND_DEFAULTS = [0.25, 0.05, 0.1, 0.2];

function kindRandomness(kind: number): number {
  const name = KIND_NAMES[kind];
  if (name) {
    const env = process.env[`CHALLENGE_RANDOMNESS_${name}`];
    if (env) {
      const n = Number(env);
      if (Number.isFinite(n) && n >= 0) return n;
    }
  }
  return KIND_DEFAULTS[kind] ?? 0;
}

function applyRandomness(results: AgentResult[], factor: number): AgentResult[] {
  if (factor <= 0) return results;
  return results.map((r) => ({
    ...r,
    score: Math.max(0, r.score * (1 + (Math.random() * 2 - 1) * factor)),
  }));
}

function coordinatorWallet() {
  if (!config.coordinator.privateKey) throw new Error("COORDINATOR_PRIVATE_KEY required to resolve challenges");
  const pk = config.coordinator.privateKey.startsWith("0x")
    ? config.coordinator.privateKey
    : `0x${config.coordinator.privateKey}`;
  return createWalletClient({ account: privateKeyToAccount(pk as `0x${string}`) as Account, chain: arcTestnet, transport: http(config.rpcHttp) });
}

function coordinatorAddr(): `0x${string}` {
  if (!config.coordinator.privateKey) throw new Error("COORDINATOR_PRIVATE_KEY required");
  const pk = config.coordinator.privateKey.startsWith("0x")
    ? config.coordinator.privateKey
    : `0x${config.coordinator.privateKey}`;
  return privateKeyToAccount(pk as `0x${string}`).address;
}

/// Lazy-claimed bot agent the coordinator uses to auto-fill underfilled
/// challenges so solo challenges still run instead of cancelling for
/// refund. Cached after first read.
let cachedBotAgentId: number | null = null;
async function ensureCoordinatorAgent(): Promise<number> {
  if (cachedBotAgentId !== null) return cachedBotAgentId;
  const registry = config.contracts.AgentRegistry;
  const owner = coordinatorAddr();
  const existing = (await publicClient.readContract({
    address: registry,
    abi: registryAbi,
    functionName: "agentsOf",
    args: [owner],
  })) as readonly bigint[];
  if (existing.length > 0) {
    cachedBotAgentId = Number(existing[0]);
    return cachedBotAgentId;
  }
  // No agent yet; claim one. createAgent emits the new id; simplest path is
  // to read nextAgentId before the write (it's the id that will be assigned).
  // Falls back to re-reading agentsOf after the tx if needed.
  //
  // metadataURI MUST be non-empty: the ERC-8004 IdentityRegistry rejects an
  // empty URI (reverts 0xae921357), which made every auto-fill fail and the bot
  // agent never get created — so solo challenges kept cancelling. Use the same
  // canonical URI the frontend mints user agents with.
  const wallet = coordinatorWallet();
  const hash = await wallet.writeContract({
    address: registry,
    abi: registryAbi,
    functionName: "createAgent",
    args: ["arcrun://agent/v1"],
    account: wallet.account!,
    chain: arcTestnet,
  });
  await publicClient.waitForTransactionReceipt({ hash, timeout: SETTLE_RECEIPT_TIMEOUT_MS });
  const after = (await publicClient.readContract({
    address: registry,
    abi: registryAbi,
    functionName: "agentsOf",
    args: [owner],
  })) as readonly bigint[];
  if (after.length === 0) throw new Error("coordinator claimed an agent but agentsOf still empty");
  cachedBotAgentId = Number(after[0]);
  console.log(`coordinator: claimed bot agent #${cachedBotAgentId} for challenge auto-fill`);
  return cachedBotAgentId;
}

/// Approve the arena to pull a stake from the coordinator wallet (idempotent;
/// only re-approves when allowance is short). Coordinator already holds USDC
/// for contest pools, so the same balance covers challenge stakes.
async function ensureArenaAllowance(stake: bigint): Promise<void> {
  const wallet = coordinatorWallet();
  const owner = coordinatorAddr();
  const usdc = config.external.USDC;
  const arena = config.contracts.ChallengeArena;
  const current = (await publicClient.readContract({
    address: usdc,
    abi: usdcAbi,
    functionName: "allowance",
    args: [owner, arena],
  })) as bigint;
  if (current >= stake) return;
  const hash = await wallet.writeContract({
    address: usdc,
    abi: usdcAbi,
    functionName: "approve",
    args: [arena, (1n << 96n)],
    account: wallet.account!,
    chain: arcTestnet,
  });
  await publicClient.waitForTransactionReceipt({ hash, timeout: SETTLE_RECEIPT_TIMEOUT_MS });
}

async function fetchField(challengeId: number, cType: number): Promise<ContestEntryInput[]> {
  // Same pattern as the contest runner: prefer the indexer's cached
  // tier so the hot path skips an RPC per agent per tick. Backfill on
  // a legacy null row.
  const { rows } = await query<{ agent_id: string; operator: string; tier: number | null }>(
    "select agent_id, operator, tier from challenge_entries where challenge_id = $1 order by agent_id",
    [challengeId],
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
        await query(
          "update challenge_entries set tier = $3 where challenge_id = $1 and agent_id = $2",
          [challengeId, r.agent_id, tier],
        );
      } catch {
        tier = 0;
      }
    }
    field.push({ agentId: Number(r.agent_id), operator: r.operator as `0x${string}`, tier: Number(tier) });
  }
  // Enforce the tier gate: drop any entry whose agent tier is out of range so
  // it can't score or take the pot. The frontend blocks out-of-range agents
  // before they stake; this is the settlement-side backstop.
  const gate = await getTierGate("challenge", challengeId);
  if (gate) {
    const allowed = field.filter((e) => tierAllowed(gate, e.tier));
    if (allowed.length !== field.length) {
      console.log(`challenge ${challengeId}: tier gate ${gate.minTier}-${gate.maxTier} dropped ${field.length - allowed.length} out-of-range entr${field.length - allowed.length === 1 ? "y" : "ies"}`);
    }
    return allowed;
  }
  return field;
}

async function scoreField(cType: number, challengeId: number, field: ContestEntryInput[]): Promise<AgentResult[]> {
  if (cType === 0) return new ScoutRunner(5).run(challengeId, field);
  if (cType === 1) return new AnalystRunner().run(challengeId, field);
  return new SolverRunner(6).run(challengeId, field);
}

/// Live preview of a locked challenge, used to broadcast standings frames before
/// the authoritative scoring. Scout is real on-chain, so its preview is a pure
/// tier-based proxy (mirrors the contest preview).
async function previewScores(cType: number, challengeId: number, field: ContestEntryInput[]): Promise<AgentResult[]> {
  if (cType === 1) return new AnalystRunner().run(challengeId, field);
  if (cType === 2) return new SolverRunner(6).run(challengeId, field);
  return field.map((e) => ({ agentId: e.agentId, operator: e.operator, score: (e.tier + 1) * 100, detail: {} }));
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
      // Carry runner progress through (solver cells, analyst calls, scout txs).
      progress: r.progress,
    }));
}

// Each challenge gets at most one preview pass per process lifetime so the
// sweeper does not re-stream every minute if scoring is retried.
const previewed = new Set<number>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/// OPEN or LOCKED challenges, newest-first scan. The resolver decides per id
/// whether to lock, resolve, cancel, or wait.
export async function findActiveChallenges(lookback = 100): Promise<number[]> {
  const arena = config.contracts.ChallengeArena;
  const next = (await publicClient.readContract({ address: arena, abi: arenaAbi, functionName: "nextChallengeId" })) as bigint;
  const latest = Number(next) - 1;
  const floor = Math.max(0, latest - lookback + 1);
  const active: number[] = [];
  for (let id = latest; id >= floor; id--) {
    const ch = await publicClient.readContract({ address: arena, abi: arenaAbi, functionName: "getChallenge", args: [BigInt(id)] });
    const status = Number(ch.status);
    if (ch.creator !== zeroAddress && (status === 0 || status === 1)) active.push(id);
  }
  return active.reverse();
}

export async function resolveChallengeById(challengeId: number, broadcast: (message: unknown) => void): Promise<void> {
  const arena = config.contracts.ChallengeArena;
  const ch = await publicClient.readContract({ address: arena, abi: arenaAbi, functionName: "getChallenge", args: [BigInt(challengeId)] });
  if (ch.creator === zeroAddress) return;

  let status = Number(ch.status);
  if (status === 2 || status === 3) return; // already settled or cancelled

  const nowSec = Math.floor(Date.now() / 1000);
  const cType = KIND_TO_CTYPE[Number(ch.kind)] ?? 2;
  const entrants = Number(
    (await publicClient.readContract({ address: arena, abi: arenaAbi, functionName: "entrantCount", args: [BigInt(challengeId)] })) as bigint,
  );

  const wallet = coordinatorWallet();
  async function send(params: Parameters<typeof wallet.writeContract>[0]) {
    const hash = await wallet.writeContract(params as never);
    await publicClient.waitForTransactionReceipt({ hash, timeout: SETTLE_RECEIPT_TIMEOUT_MS });
    return hash;
  }
  async function cancel(reason: string) {
    console.log(`challenge ${challengeId}: ${reason}; cancelling so entrants refund`);
    await send({ address: arena, abi: arenaAbi, functionName: "cancelChallenge", args: [BigInt(challengeId)] });
    broadcast({ type: "challenge_settled", challengeId, winners: [] });
  }

  if (status === 0) {
    // OPEN: lock once full or the join window has closed, with 2+ entrants.
    let liveEntrants = entrants;
    const full = liveEntrants >= Number(ch.maxEntrants);
    const joinEnded = nowSec >= Number(ch.joinDeadline);

    // Auto-fill: any time a non-coordinator-created challenge sits at 1
    // entrant, the coordinator joins it with a bot agent so it actually runs
    // instead of cancelling for refund at the join deadline. Default ON; set
    // AUTOPILOT_FILL_CHALLENGES=0 to disable. Only runs while the window is
    // still open and the coordinator isn't the creator (no self-join loop).
    const fillOn = (process.env.AUTOPILOT_FILL_CHALLENGES ?? "1") !== "0";
    if (
      fillOn &&
      liveEntrants === 1 &&
      !joinEnded &&
      ch.creator.toLowerCase() !== coordinatorAddr().toLowerCase()
    ) {
      try {
        const already = (await publicClient.readContract({
          address: arena,
          abi: arenaAbi,
          functionName: "joined",
          args: [BigInt(challengeId), coordinatorAddr()],
        })) as boolean;
        if (!already) {
          const botAgentId = await ensureCoordinatorAgent();
          await ensureArenaAllowance(ch.stake);
          console.log(`challenge ${challengeId}: auto-filling with bot agent #${botAgentId} (stake ${ch.stake})`);
          await send({
            address: arena,
            abi: arenaAbi,
            functionName: "joinChallenge",
            args: [BigInt(challengeId), BigInt(botAgentId)],
          });
          liveEntrants = Number(
            (await publicClient.readContract({
              address: arena,
              abi: arenaAbi,
              functionName: "entrantCount",
              args: [BigInt(challengeId)],
            })) as bigint,
          );
        }
      } catch (err) {
        console.error(`challenge ${challengeId}: auto-fill failed:`, err instanceof Error ? err.message : err);
        // Fall through to the standard wait/cancel path.
      }
    }

    if (!full && !joinEnded) return; // still filling (or waiting for the join window to close)
    if (liveEntrants < 2) {
      await cancel(`underfilled (${liveEntrants} entrants)`);
      return;
    }
    console.log(`challenge ${challengeId}: locking with ${liveEntrants} entrants`);
    await send({ address: arena, abi: arenaAbi, functionName: "lockChallenge", args: [BigInt(challengeId)] });
    status = 1;
  }

  if (status === 1) {
    // LOCKED: resolve before the deadline, else cancel for refunds.
    if (nowSec > Number(ch.resolveDeadline)) {
      await cancel("resolve window missed");
      return;
    }

    // Retry-safe resolve. The previous shape did one shot: score, persist
    // payouts, postWinnerRoot, broadcast. If postWinnerRoot threw (RPC blip,
    // gas, deadline crossed mid-flight), the function exited; the next sweep
    // re-ran scoring with fresh randomness so the merkle root no longer
    // matched the persisted payouts, and the deadline check eventually
    // cancelled the whole thing. The fix: if payouts are already persisted
    // from a previous attempt, skip scoring and reuse them so postWinnerRoot
    // retries with the same root until it lands.
    const existing = await query<{ rank: number; operator: string; amount: string }>(
      "select rank, operator, amount from challenge_payouts where challenge_id = $1 order by rank",
      [challengeId],
    );

    let payouts: { operator: `0x${string}`; amount: bigint }[];
    // Set on the FRESH scoring pass; drives the post-settlement rewards that now
    // run AFTER postWinnerRoot (so a slow/failing reward can't delay settlement
    // past the resolve deadline). Null on the retry path (rewards already ran).
    let scoredResults: AgentResult[] | null = null;

    if (existing.rows.length > 0) {
      // Retry path. Skip field fetch, scoring, preview, and trait award; they
      // already ran on the first attempt. Only postWinnerRoot retries here.
      payouts = existing.rows.map((r) => ({
        operator: r.operator as `0x${string}`,
        amount: BigInt(r.amount),
      }));
      console.log(
        `challenge ${challengeId}: retrying postWinnerRoot with ${payouts.length} previously persisted payout(s)`,
      );
    } else {
      // Fresh resolve path.
      const field = await fetchField(challengeId, cType);
      if (cType === 0 && field.length > 0) {
        // Volume (Scout) challenges only produce a score when each agent's hot
        // wallet has USDC to move. If the mnemonic or coordinator key is unset,
        // funding can't run, wallets stay empty, every score is 0, and the
        // challenge later cancels for "no scoring entrants". Log it loudly so
        // that root cause is obvious instead of a silent cancellation.
        if (config.scout.masterMnemonic && config.coordinator.privateKey) {
          await fundHotWallets(field.map((e) => ({ agentId: e.agentId, tier: e.tier })));
        } else {
          console.warn(
            `challenge ${challengeId}: VOLUME challenge but hot-wallet funding is OFF ` +
              `(SCOUT_MASTER_MNEMONIC=${config.scout.masterMnemonic ? "set" : "unset"}, ` +
              `COORDINATOR_PRIVATE_KEY=${config.coordinator.privateKey ? "set" : "unset"}). ` +
              `Agents will move no volume and this challenge will cancel for no scoring entrants.`,
          );
        }
      }

      // Per-kind randomness; preview frames re-roll so the race visibly
      // shuffles, the final scoring rolls once for the authoritative winner.
      const factor = kindRandomness(Number(ch.kind));

      // Trait + training + syndicate-war multipliers are stable across the
      // locked field, so fetch once and reuse for every preview frame and the
      // authoritative scoring. Combined multiplier capped at 3.5x.
      const ids = field.map((e) => e.agentId);
      const operators = field.map((e) => e.operator);
      await flushTrainingQueue().catch(() => 0);
      const [traitMult, trainMult, synMult] = await Promise.all([
        fetchAgentMultipliers(ids),
        fetchTrainingMultipliers(ids),
        fetchSyndicateMultipliers(operators),
      ]);

      let baseResults: AgentResult[];
      if (cType === 0) {
        // VOLUME (Scout): run the REAL swap race live. The runner does
        // USDC<->EURC round-trips from each hot wallet, broadcasting a
        // standings frame after every leg so the tx tape fills as the
        // countdown ticks. Swapping stops 60s before the resolve deadline.
        // Trait/training boost already became MORE swaps inside the runner,
        // so the volume the agents actually moved is the score.
        // End the race 120s before the resolve deadline so scoring + the
        // postWinnerRoot tx have room even if the last swap overruns. (Was 60s,
        // too tight once a slow real swap could overrun the cutoff.)
        const deadlineMs = Number(ch.resolveDeadline) * 1000 - 120_000;
        console.log(
          `challenge ${challengeId}: streaming live scout swap race to ${field.length} entrant(s), ending 60s before resolve deadline`,
        );
        baseResults = await new ScoutRunner(5).run(challengeId, field, {
          broadcast,
          deadlineMs,
          source: "challenge",
        });
      } else if (cType === 2) {
        // PUZZLE / CUSTOM (Solver): post puzzles in rounds (more puzzles,
        // wider categories) and stream the solve feed live, stopping 60s
        // before the resolve deadline. Trait/training boost applies through
        // the runner; the field is locked so every entrant faces the same
        // growing set.
        // End the race 120s before the resolve deadline so scoring + the
        // postWinnerRoot tx have room even if the last swap overruns. (Was 60s,
        // too tight once a slow real swap could overrun the cutoff.)
        const deadlineMs = Number(ch.resolveDeadline) * 1000 - 120_000;
        console.log(
          `challenge ${challengeId}: streaming live puzzle solve to ${field.length} entrant(s), ending 60s before resolve deadline`,
        );
        baseResults = await new SolverRunner(6).run(challengeId, field, {
          broadcast,
          deadlineMs,
          source: "challenge",
        });
      } else {
        // Stream a preview race so the challenge detail board animates before
        // the winner root posts. Only on the first sweep that sees this
        // challenge locked in this process, and only when there is enough
        // resolve window left to fit the preview.
        const previewSecs = Number(process.env.CHALLENGE_PREVIEW_SECONDS ?? "20");
        const haveTime = Number(ch.resolveDeadline) - nowSec > previewSecs + 5;
        if (!previewed.has(challengeId) && field.length >= 2 && haveTime) {
          previewed.add(challengeId);
          const previewUntil = Date.now() + previewSecs * 1000;
          console.log(
            `challenge ${challengeId}: streaming ${previewSecs}s preview to ${field.length} entrant(s) (kind ${ch.kind}, randomness ±${(factor * 100).toFixed(0)}%)`,
          );
          while (Date.now() < previewUntil) {
            const preview = await previewScores(cType, challengeId, field);
            const baselines = new Map(preview.map((r) => [r.agentId, r.score] as const));
            const withTraits = applyTraitMultipliers(preview, traitMult);
            const withTraining = applyTrainingMultipliers(withTraits, trainMult);
            const withSyndicate = applySyndicateMultipliers(withTraining, synMult);
            const clamped = clampCombinedMultiplier(withSyndicate, baselines);
            broadcast({ type: "challenge_standings", challengeId, entries: standings(applyRandomness(clamped, factor)) });
            await sleep(2500);
          }
        }

        baseResults = await scoreField(cType, challengeId, field);
      }
      const baselines = new Map(baseResults.map((r) => [r.agentId, r.score] as const));
      // PUZZLE / CUSTOM (solver, cType 2) is pure skill: no upgrade
      // multipliers, so the best solver wins. PREDICTION + VOLUME apply
      // trait/syndicate (training already counts once in the runner, so its
      // coordinator pass is a no-op). Per-kind randomness still applies.
      const results =
        cType === 2
          ? applyRandomness(baseResults, factor)
          : applyRandomness(
              clampCombinedMultiplier(
                applySyndicateMultipliers(applyTrainingMultipliers(applyTraitMultipliers(baseResults, traitMult), trainMult), synMult),
                baselines,
              ),
              factor,
            );

      // Final standings frame with the authoritative progress so the live
      // stage gets the real per-agent state (Scout tx hashes especially)
      // before the settled banner clears it.
      const finalStandings = standings(results);
      broadcast({ type: "challenge_standings", challengeId, entries: finalStandings });
      // Persist for replay: a refresh of the settled challenge reconstructs the
      // full result for anyone who didn't watch it live.
      void saveStandingsSnapshot("challenge", challengeId, finalStandings);

      const pot = ch.stake * BigInt(entrants);
      const fee = (pot * BigInt(ch.platformFeeBps)) / 10_000n;
      // Dispatcher reads the challenge's scoring_mode. Non-Arcana
      // challenges fall back to rank-based; Arcana challenges use
      // pnl_mtm / pnl_realized / volume depending on what the creator
      // picked at create time.
      const modeRow = await query<{ scoring_mode: string | null; payout_preset: string | null; payout_config: unknown }>(
        "select scoring_mode, payout_preset, payout_config from challenges where id = $1",
        [challengeId],
      );
      const scoringMode = normalizeScoringMode(modeRow.rows[0]?.scoring_mode);
      const payoutPreset = modeRow.rows[0]?.payout_preset ?? null;
      const payoutConfig = modeRow.rows[0]?.payout_config ?? null;

      // PNL_REALIZED gate: same logic as runContestById. Bail
      // early if pinned markets unresolved and under 48h. Resolver sweep
      // retries every 60s.
      if (scoringMode === "pnl_realized") {
        const { rows: pending } = await query<{ resolved: boolean }>(
          `select coalesce(m.resolved, false) as resolved
             from contest_arcana_markets pm
             left join arcana_markets m on m.market_id = pm.market_id
            where pm.contest_id = $1`,
          [challengeId],
        );
        const unresolved = pending.filter((r) => !r.resolved);
        if (unresolved.length > 0) {
          const resolveDeadlineMs = Number(ch.resolveDeadline) * 1000;
          const elapsedMs = Date.now() - resolveDeadlineMs;
          const TIMEOUT_MS = 48 * 60 * 60 * 1000;
          if (elapsedMs < TIMEOUT_MS) {
            const remaining = Math.round((TIMEOUT_MS - elapsedMs) / 1000 / 60);
            console.log(
              `challenge ${challengeId}: PNL_REALIZED waiting on ${unresolved.length} unresolved market(s), ${remaining}min until timeout`,
            );
            return;
          }
          console.log(
            `challenge ${challengeId}: PNL_REALIZED 48h timeout, settling on resolved markets only`,
          );
        }
      }

      payouts = computeDistribution(payoutPreset, payoutConfig, scoringMode, results, pot - fee);
      if (payouts.length === 0) {
        // A LOCKED challenge can only be cancelled after its resolve deadline,
        // so leave it; if it never scores, the deadline path above cancels it
        // on a later sweep and entrants refund.
        const zeroScores = results.filter((r) => r.score <= 0).length;
        const detail = cType === 0
          ? ` (VOLUME: ${zeroScores}/${results.length} agents moved no USDC — check hot-wallet funding and SCOUT_REAL_SWAPS / the swap adapter)`
          : "";
        console.log(`challenge ${challengeId}: no scoring entrants yet; will retry until resolve deadline${detail}`);
        return;
      }

      for (let i = 0; i < payouts.length; i++) {
        await query(
          "insert into challenge_payouts (challenge_id, rank, operator, amount) values ($1, $2, $3, $4) on conflict (challenge_id, rank) do nothing",
          [challengeId, i + 1, payouts[i]!.operator.toLowerCase(), payouts[i]!.amount.toString()],
        );
      }

      // Settlement (postWinnerRoot, below) runs FIRST, before any reward. The
      // rewards — placement traits, Cycles, the ERC-8004 giveFeedback txs, and
      // the hot-wallet sweep — used to run here, ahead of postWinnerRoot, and a
      // slow or failing one (e.g. an out-of-gas validator wallet hanging on
      // giveFeedback) pushed the winner-root tx past the resolve deadline, so it
      // reverted and the whole challenge cancelled. Stash the results and do the
      // rewards AFTER the root is posted instead.
      scoredResults = results;
    }

    const root = merkleRoot(payouts.map((p) => payoutLeaf(p.operator, p.amount)));
    try {
      await send({ address: arena, abi: arenaAbi, functionName: "postWinnerRoot", args: [BigInt(challengeId), root] });
    } catch (err) {
      // Don't cancel the challenge from here. Leave it LOCKED; the next sweep
      // hits the retry branch above and tries postWinnerRoot again with the
      // same persisted payouts. Only the deadline-missed check cancels.
      console.error(
        `challenge ${challengeId}: postWinnerRoot failed; will retry on next sweep:`,
        err instanceof Error ? err.message : err,
      );
      return;
    }

    console.log(`challenge ${challengeId} resolved with ${payouts.length} winner(s)`);
    broadcast({
      type: "challenge_settled",
      challengeId,
      winners: payouts.map((p, i) => ({ rank: i + 1, operator: p.operator, amount: p.amount.toString() })),
    });

    // Post-settlement rewards, AFTER the winner root is posted so none of them
    // can delay or block settlement (the bug that cancelled volume challenges:
    // an out-of-gas validator giveFeedback ran before postWinnerRoot and ate the
    // resolve window). Only on the fresh scoring pass; each is best-effort.
    if (scoredResults) {
      await awardPlacementTraits("challenge", challengeId, scoredResults).catch((err) =>
        console.error(`challenge ${challengeId}: placement trait awards failed:`, err instanceof Error ? err.message : err),
      );
      await creditPoints(challengeId, cType, scoredResults).catch((err) =>
        console.error(`challenge ${challengeId}: creditPoints failed:`, err instanceof Error ? err.message : err),
      );
      await postValidatorFeedback("challenge", challengeId, cType, scoredResults).catch((err) =>
        console.error(`challenge ${challengeId}: validator feedback failed:`, err instanceof Error ? err.message : err),
      );
      if (cType === 0 && config.scout.masterMnemonic && config.coordinator.privateKey) {
        await sweepHotWallets(scoredResults.map((r) => r.agentId)).catch((err) =>
          console.error(`challenge ${challengeId}: sweep failed: ${err instanceof Error ? err.message : err}`),
        );
      }
    }
    for (let i = 0; i < payouts.length; i++) {
      const p = payouts[i]!;
      void notify(p.operator, {
        kind: "challenge_win",
        title: `You won challenge #${challengeId}`,
        body: `pot ${(Number(p.amount) / 1e6).toFixed(2)} USDC. claim it from the challenge page.`,
        href: `/challenges/${challengeId}`,
        context: { challengeId, rank: i + 1, amount: p.amount.toString() },
      });
    }
  }
}
