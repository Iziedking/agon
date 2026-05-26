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
///   AUTOPILOT_DURATION_SECONDS=1500   how long entries stay open (25 min default)
///   AUTOPILOT_GAP_SECONDS=7200        pause between one contest settling and the next opening (2 hr default)

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

export async function startAutopilot(broadcast: (message: unknown) => void): Promise<void> {
  const configured = (process.env.AUTOPILOT_TYPE ?? "rotate").toLowerCase();
  const legacyPool = process.env.AUTOPILOT_POOL_USDC;
  const poolMin = Number(process.env.AUTOPILOT_POOL_USDC_MIN ?? legacyPool ?? "1");
  const poolMax = Number(process.env.AUTOPILOT_POOL_USDC_MAX ?? legacyPool ?? "10");
  const durationSeconds = Number(process.env.AUTOPILOT_DURATION_SECONDS ?? "1500");
  const gapSeconds = Number(process.env.AUTOPILOT_GAP_SECONDS ?? "7200");

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
