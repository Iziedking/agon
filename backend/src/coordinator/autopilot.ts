import { createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { arcTestnet, publicClient } from "../chain/arc.js";
import { config } from "../config/index.js";
import { coordinatorAddress, findDueContests, findOpenContests, openContest } from "./contestOps.js";
import { runContestById } from "./runContestById.js";
import { findActiveChallenges, resolveChallengeById } from "./runChallengeById.js";

/// Self-driving contest loop. With a funded COORDINATOR_PRIVATE_KEY in place, the
/// coordinator opens a contest, streams its standings over the window, funds Scout
/// entrants when needed, settles on-chain (or refunds itself if nobody entered),
/// waits a gap, and opens the next one. The coordinator wallet funds each pool
/// (and recovers it on cancel), so it needs USDC.
///
/// Env (all optional, sensible defaults):
///   AUTOPILOT=0                       turn it off even with a key set
///   AUTOPILOT_TYPE=rotate             solver | analyst | scout | rotate (default rotates across all three)
///   AUTOPILOT_POOL_USDC_MIN=1         lower bound of the randomized pool, USDC
///   AUTOPILOT_POOL_USDC_MAX=10        upper bound of the randomized pool, USDC
///   AUTOPILOT_POOL_USDC=...           legacy single value; if set, used as both min and max
///   AUTOPILOT_DURATION_SECONDS=240    how long entries stay open (4 min default, tuned for demo)
///   AUTOPILOT_GAP_SECONDS=360         pause between one contest settling and the next opening (6 min default)
///                                     combined 4 + 6 ≈ 10 min cycle so a new contest opens every ~10 min

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  const joinSecs = Number(process.env.AUTOPILOT_CHALLENGE_JOIN_SECONDS ?? "120");
  const resolveSecs = Number(process.env.AUTOPILOT_CHALLENGE_RESOLVE_SECONDS ?? "1800");
  const cycleSecs = Number(process.env.AUTOPILOT_CHALLENGE_CYCLE_SECONDS ?? "600");
  const kinds = (process.env.AUTOPILOT_CHALLENGE_KINDS ?? "0,1,2,3")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 3);

  console.log(
    `autopilot: random challenges every ${cycleSecs}s, stake ${stakeMin}-${stakeMax} USDC, kinds ${kinds.join(",")}`,
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
      const now = Math.floor(Date.now() / 1000);
      const joinDeadline = BigInt(now + joinSecs);
      const resolveDeadline = BigInt(now + joinSecs + resolveSecs);
      const hash = await wallet.writeContract({
        address: config.contracts.ChallengeArena,
        abi: arenaCreateAbi,
        functionName: "createChallenge",
        args: [kind, stake, 2n, joinDeadline, resolveDeadline, false],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`autopilot: random challenge created, kind ${kind}, stake ${stakeUsdc} USDC`);
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
  const durationSeconds = Number(process.env.AUTOPILOT_DURATION_SECONDS ?? "240");
  const gapSeconds = Number(process.env.AUTOPILOT_GAP_SECONDS ?? "360");

  console.log(
    `autopilot on: ${configured} contests, pool ${poolMin}-${poolMax} USDC, ${durationSeconds}s window, ${gapSeconds}s gap`,
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

  for (let cycle = 0; ; cycle++) {
    const type = nextType(configured, cycle);
    // Randomize the pool per cycle so the activity feed reads as varied campaigns
    // instead of identical pools. Two-decimal precision keeps amounts readable.
    const lo = Math.min(poolMin, poolMax);
    const hi = Math.max(poolMin, poolMax);
    const poolUsdc = Math.round((lo + Math.random() * (hi - lo)) * 100) / 100;
    try {
      const contestId = await openContest({ type, poolUsdc, durationSeconds });
      console.log(`autopilot: opened ${type} contest ${contestId} with ${poolUsdc} USDC pool`);
      broadcast({ type: "contest_open", contestId, contestType: type, endsAt: Date.now() + durationSeconds * 1000 });

      // Streams standings over the window, then settles (or refunds if empty).
      await runOnce(contestId, broadcast);
      console.log(`autopilot: contest ${contestId} complete`);
    } catch (err) {
      console.error("autopilot cycle failed:", err instanceof Error ? err.message : err);
    }
    await sleep(gapSeconds * 1000);
  }
}
