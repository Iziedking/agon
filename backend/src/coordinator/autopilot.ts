import { createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { arcTestnet, publicClient } from "../chain/arc.js";
import { config } from "../config/index.js";
import { coordinatorAddress, findDueContests, findOpenContests, openContest } from "./contestOps.js";
import { runContestById } from "./runContestById.js";
import { findActiveChallenges, resolveChallengeById } from "./runChallengeById.js";
import { startArcanaClaimerLoop } from "../lib/arcanaClaimer.js";
import { pinArcanaMarketsForContest } from "../lib/arcanaPins.js";

/// Self-driving contest loop. With a funded COORDINATOR_PRIVATE_KEY in place, the
/// coordinator opens a contest, streams its standings over the window, funds Scout
/// entrants when needed, settles on-chain (or refunds itself if nobody entered),
/// waits a gap, and opens the next one. The coordinator wallet funds each pool
/// (and recovers it on cancel), so it needs USDC.
///
/// Env (all optional, sensible defaults):
///   AUTOPILOT=0                            turn it off even with a key set
///   AUTOPILOT_TYPE=rotate                  solver | analyst | scout | rotate (default rotates across all three)
///   AUTOPILOT_POOL_USDC_MIN=1              lower bound of the randomized pool, USDC
///   AUTOPILOT_POOL_USDC_MAX=10             upper bound of the randomized pool, USDC
///   AUTOPILOT_POOL_USDC=...                legacy single value; if set, used as both min and max
///   AUTOPILOT_DURATION_SECONDS_MIN=180     lower bound of the join window, seconds (3 min default)
///   AUTOPILOT_DURATION_SECONDS_MAX=1500    upper bound of the join window, seconds (25 min default)
///   AUTOPILOT_DURATION_SECONDS=...         legacy fixed window; if set, used as both min and max
///   AUTOPILOT_GAP_SECONDS=360              pause between one contest settling and the next opening (6 min default)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/// Pick a random integer in [min, max] inclusive. Swaps the bounds if
/// they're inverted in env so a typo can't turn it into a negative range.
function randInt(min: number, max: number): number {
  const lo = Math.floor(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  if (hi <= lo) return lo;
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

const ROTATION = ["solver", "analyst", "scout"] as const;
const TYPE_NAMES = ["scout", "analyst", "solver"]; // contract index to name

function nextType(configured: string, cycle: number): string {
  return configured === "rotate" ? ROTATION[cycle % ROTATION.length]! : configured;
}

/// Contests currently being run, so the main loop and the due-sweeper never act
/// on the same contest at once. The check-and-add is synchronous (no await
/// between), so two callers can't both pass the guard for the same id.
const inFlight = new Set<number>();

async function runOnce(contestId: number, broadcast: (message: unknown) => void): Promise<void> {
  if (inFlight.has(contestId)) return;
  inFlight.add(contestId);
  try {
    await runContestById(contestId, broadcast);
  } finally {
    inFlight.delete(contestId);
  }
}

/// Settle any contest whose window has closed, including ones hosted by other
/// operators (the main loop only runs the coordinator's own). Runs concurrently
/// with the open-loop; the in-flight guard keeps them from colliding.
async function startDueSweeper(broadcast: (message: unknown) => void): Promise<void> {
  const everyMs = Number(process.env.AUTOPILOT_SWEEP_SECONDS ?? "60") * 1000;
  for (;;) {
    await sleep(everyMs);
    try {
      const due = await findDueContests();
      for (const info of due) {
        if (inFlight.has(info.id)) continue;
        console.log(`autopilot: settling due contest ${info.id}`);
        await runOnce(info.id, broadcast);
      }
    } catch (err) {
      console.error("autopilot sweeper failed:", err instanceof Error ? err.message : err);
    }
  }
}

/// Peer challenges: lock, score, resolve, and refund-cancel. Separate in-flight
/// set since challenge ids and contest ids are different id spaces.
const challengeInFlight = new Set<number>();

async function resolveChallengeOnce(id: number, broadcast: (message: unknown) => void): Promise<void> {
  if (challengeInFlight.has(id)) return;
  challengeInFlight.add(id);
  try {
    await resolveChallengeById(id, broadcast);
  } finally {
    challengeInFlight.delete(id);
  }
}

async function startChallengeSweeper(broadcast: (message: unknown) => void): Promise<void> {
  const everyMs = Number(process.env.AUTOPILOT_SWEEP_SECONDS ?? "60") * 1000;
  for (;;) {
    await sleep(everyMs);
    try {
      const active = await findActiveChallenges();
      for (const id of active) {
        if (challengeInFlight.has(id)) continue;
        await resolveChallengeOnce(id, broadcast);
      }
    } catch (err) {
      console.error("autopilot challenge sweeper failed:", err instanceof Error ? err.message : err);
    }
  }
}

const arenaCreateAbi = parseAbi([
  "function createChallenge(uint8 kind, uint128 stake, uint64 maxEntrants, uint64 joinDeadline, uint64 resolveDeadline, bool isPrivate)",
]);

/// Randomly creates peer challenges on the same cadence as contests, so the
/// /live lobby and /challenges page always have something happening even
/// when no human has hosted one. The coordinator auto-fills its own
/// challenges with a second bot entrant via runChallengeById's auto-fill so
/// they actually run instead of cancelling on the join deadline.
///
/// Disabled by default. Set AUTOPILOT_RANDOM_CHALLENGES=1 to enable.
async function startRandomChallengeLoop(broadcast: (message: unknown) => void): Promise<void> {
  const enabled = (process.env.AUTOPILOT_RANDOM_CHALLENGES ?? "0") === "1";
  if (!enabled) return;
  if (!config.coordinator.privateKey) {
    console.warn("autopilot: random challenges enabled but COORDINATOR_PRIVATE_KEY missing; skipping");
    return;
  }

  const stakeMin = Number(process.env.AUTOPILOT_CHALLENGE_STAKE_MIN ?? "0.5");
  const stakeMax = Number(process.env.AUTOPILOT_CHALLENGE_STAKE_MAX ?? "2");
  // Join window: random per cycle inside [min, max]. Legacy single-value
  // env (AUTOPILOT_CHALLENGE_JOIN_SECONDS) is honored as both bounds for
  // back-compat. Default range matches the contest autopilot: 3-25 min.
  const legacyJoin = process.env.AUTOPILOT_CHALLENGE_JOIN_SECONDS;
  const joinMin = Number(process.env.AUTOPILOT_CHALLENGE_JOIN_SECONDS_MIN ?? legacyJoin ?? "180");
  const joinMax = Number(process.env.AUTOPILOT_CHALLENGE_JOIN_SECONDS_MAX ?? legacyJoin ?? "1500");
  const resolveSecs = Number(process.env.AUTOPILOT_CHALLENGE_RESOLVE_SECONDS ?? "1800");
  const cycleSecs = Number(process.env.AUTOPILOT_CHALLENGE_CYCLE_SECONDS ?? "600");
  const kinds = (process.env.AUTOPILOT_CHALLENGE_KINDS ?? "0,1,2,3")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 3);

  console.log(
    `autopilot: random challenges every ${cycleSecs}s, stake ${stakeMin}-${stakeMax} USDC, join window ${joinMin}-${joinMax}s, kinds ${kinds.join(",")}`,
  );

  const pk = config.coordinator.privateKey.startsWith("0x")
    ? config.coordinator.privateKey
    : `0x${config.coordinator.privateKey}`;
  const wallet = createWalletClient({
    account: privateKeyToAccount(pk as `0x${string}`),
    chain: arcTestnet,
    transport: http(config.rpcHttp),
  });

  for (;;) {
    try {
      const kind = kinds[Math.floor(Math.random() * kinds.length)]!;
      const stakeUsdc = Math.round((stakeMin + Math.random() * (stakeMax - stakeMin)) * 100) / 100;
      const stake = BigInt(Math.round(stakeUsdc * 1e6));
      const joinSecs = randInt(joinMin, joinMax);
      const now = Math.floor(Date.now() / 1000);
      const joinDeadline = BigInt(now + joinSecs);
      const resolveDeadline = BigInt(now + joinSecs + resolveSecs);
      // Read the id this tx will get BEFORE sending. Safe under the
      // single-writer autopilot; if multiple writers race, the indexer's
      // ChallengeCreated handler also pins, so the pin lands either way.
      const claimingId = (await publicClient.readContract({
        address: config.contracts.ChallengeArena,
        abi: [
          { name: "nextChallengeId", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
        ] as const,
        functionName: "nextChallengeId",
      })) as bigint;
      const hash = await wallet.writeContract({
        address: config.contracts.ChallengeArena,
        abi: arenaCreateAbi,
        functionName: "createChallenge",
        args: [kind, stake, 2n, joinDeadline, resolveDeadline, false],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(
        `autopilot: random challenge created id=${claimingId}, kind ${kind}, stake ${stakeUsdc} USDC, join ${joinSecs}s`,
      );

      // PREDICTION challenges pin an Arcana market set at create time so
      // every entrant sees the same menu. The indexer also pins on event
      // pickup; this fires first to avoid a race where an early entry
      // arrives before the indexer's pass.
      if (kind === 1) {
        try {
          await pinArcanaMarketsForContest(Number(claimingId), 5);
        } catch (err) {
          console.error(`autopilot: pin arcana failed for challenge ${claimingId}: ${err instanceof Error ? err.message : err}`);
        }
      }
    } catch (err) {
      console.error("autopilot random challenge failed:", err instanceof Error ? err.message : err);
    }
    await sleep(cycleSecs * 1000);
  }
}

export async function startAutopilot(broadcast: (message: unknown) => void): Promise<void> {
  const configured = (process.env.AUTOPILOT_TYPE ?? "rotate").toLowerCase();
  const legacyPool = process.env.AUTOPILOT_POOL_USDC;
  const poolMin = Number(process.env.AUTOPILOT_POOL_USDC_MIN ?? legacyPool ?? "1");
  const poolMax = Number(process.env.AUTOPILOT_POOL_USDC_MAX ?? legacyPool ?? "10");
  // Join window: random per cycle inside [min, max]. Legacy single-value
  // env (AUTOPILOT_DURATION_SECONDS) is honored as both bounds for
  // back-compat. Default 3-25 min so the live lobby has time to gather
  // entries without every contest looking identical.
  const legacyDuration = process.env.AUTOPILOT_DURATION_SECONDS;
  const durationMin = Number(process.env.AUTOPILOT_DURATION_SECONDS_MIN ?? legacyDuration ?? "180");
  const durationMax = Number(process.env.AUTOPILOT_DURATION_SECONDS_MAX ?? legacyDuration ?? "1500");
  const gapSeconds = Number(process.env.AUTOPILOT_GAP_SECONDS ?? "360");

  console.log(
    `autopilot on: ${configured} contests, pool ${poolMin}-${poolMax} USDC, window ${durationMin}-${durationMax}s, ${gapSeconds}s gap`,
  );

  // A Scout rotation needs the master mnemonic to fund hot wallets; warn once.
  if ((configured === "scout" || configured === "rotate") && !config.scout.masterMnemonic) {
    console.warn("autopilot: SCOUT_MASTER_MNEMONIC not set; Scout contests will run unfunded");
  }

  // Resume anything this coordinator left OPEN (e.g. after a restart) before
  // opening new contests, so a restart settles the in-flight contest instead of
  // abandoning its escrowed pool.
  try {
    const pending = await findOpenContests(coordinatorAddress());
    if (pending.length > 0) {
      console.log(`autopilot: resuming ${pending.length} open contest(s): ${pending.map((p) => p.id).join(", ")}`);
    }
    for (const info of pending) {
      console.log(`autopilot: resuming contest ${info.id}`);
      broadcast({
        type: "contest_open",
        contestId: info.id,
        contestType: TYPE_NAMES[info.contestType] ?? String(info.contestType),
        endsAt: info.endsAt,
      });
      await runOnce(info.id, broadcast);
      console.log(`autopilot: resumed contest ${info.id} complete`);
    }
  } catch (err) {
    console.error("autopilot: resume scan failed:", err instanceof Error ? err.message : err);
  }

  // Concurrently settle any contest past its window, including ones hosted by
  // other operators, so their campaigns resolve without the coordinator hosting them.
  void startDueSweeper(broadcast).catch((err) =>
    console.error("autopilot sweeper crashed:", err instanceof Error ? err.message : err),
  );

  // Concurrently lock, resolve, and refund-cancel peer challenges.
  void startChallengeSweeper(broadcast).catch((err) =>
    console.error("autopilot challenge sweeper crashed:", err instanceof Error ? err.message : err),
  );

  // Random peer challenges so the /live lobby is never empty during demos.
  void startRandomChallengeLoop(broadcast).catch((err) =>
    console.error("autopilot random challenges crashed:", err instanceof Error ? err.message : err),
  );

  // Arcana claim sweeper: fires claimWinnings on resolved positions so
  // winning agents collect their USDC from Arcana without a manual nudge.
  void startArcanaClaimerLoop().catch((err) =>
    console.error("arcana claimer crashed:", err instanceof Error ? err.message : err),
  );

  for (let cycle = 0; ; cycle++) {
    const type = nextType(configured, cycle);
    // Randomize the pool per cycle so the activity feed reads as varied campaigns
    // instead of identical pools. Two-decimal precision keeps amounts readable.
    const lo = Math.min(poolMin, poolMax);
    const hi = Math.max(poolMin, poolMax);
    const poolUsdc = Math.round((lo + Math.random() * (hi - lo)) * 100) / 100;
    // Randomize the join window per cycle too, so back-to-back contests
    // don't all close at the same offset from open. Operators see a mix
    // of quick races and longer-form windows.
    const durationSeconds = randInt(durationMin, durationMax);
    try {
      const contestId = await openContest({ type, poolUsdc, durationSeconds });
      console.log(
        `autopilot: opened ${type} contest ${contestId} with ${poolUsdc} USDC pool, ${durationSeconds}s window`,
      );

      // For analyst contests, pin a set of Arcana markets up front so every
      // entrant sees the same menu. Pinning is best-effort: if Arcana has
      // no open markets, the runner falls back to the synthetic Brier
      // branch and the contest still runs.
      let arcanaMarkets: Array<{ id: number; title: string; category: string; endTime: number }> | undefined;
      if (type === "analyst") {
        const pinned = await pinArcanaMarketsForContest(contestId, 5).catch((err) => {
          console.error(`autopilot: pin arcana failed for contest ${contestId}: ${err instanceof Error ? err.message : err}`);
          return [];
        });
        if (pinned.length > 0) {
          arcanaMarkets = pinned.map((m) => ({
            id: Number(m.marketId),
            title: m.title,
            category: m.category,
            endTime: Number(m.endTime),
          }));
          console.log(`autopilot: pinned ${pinned.length} arcana market(s) to contest ${contestId}`);
        }
      }

      broadcast({
        type: "contest_open",
        contestId,
        contestType: type,
        endsAt: Date.now() + durationSeconds * 1000,
        ...(arcanaMarkets ? { arcanaMarkets } : {}),
      });

      // Streams standings over the window, then settles (or refunds if empty).
      await runOnce(contestId, broadcast);
      console.log(`autopilot: contest ${contestId} complete`);
    } catch (err) {
      console.error("autopilot cycle failed:", err instanceof Error ? err.message : err);
    }
    await sleep(gapSeconds * 1000);
  }
}
