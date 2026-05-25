import { config } from "../config/index.js";
import { coordinatorAddress, findDueContests, findOpenContests, openContest } from "./contestOps.js";
import { runContestById } from "./runContestById.js";

/// Self-driving contest loop. With a funded COORDINATOR_PRIVATE_KEY in place, the
/// coordinator opens a contest, streams its standings over the window, funds Scout
/// entrants when needed, settles on-chain (or refunds itself if nobody entered),
/// waits a short gap, and opens the next one. No open-contest, fund-scouts, or
/// RUN_CONTEST_ID commands, and no container restart between contests.
///
/// Env (all optional, sensible defaults):
///   AUTOPILOT=0                     turn it off even with a key set
///   AUTOPILOT_TYPE=solver           solver | analyst | scout | rotate
///   AUTOPILOT_POOL_USDC=2           prize pool per contest
///   AUTOPILOT_DURATION_SECONDS=180  how long entries stay open
///   AUTOPILOT_GAP_SECONDS=30        pause between one contest settling and the next opening

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

export async function startAutopilot(broadcast: (message: unknown) => void): Promise<void> {
  const configured = (process.env.AUTOPILOT_TYPE ?? "solver").toLowerCase();
  const poolUsdc = Number(process.env.AUTOPILOT_POOL_USDC ?? "2");
  const durationSeconds = Number(process.env.AUTOPILOT_DURATION_SECONDS ?? "180");
  const gapSeconds = Number(process.env.AUTOPILOT_GAP_SECONDS ?? "30");

  console.log(
    `autopilot on: ${configured} contests, ${poolUsdc} USDC pool, ${durationSeconds}s window, ${gapSeconds}s gap`,
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

  for (let cycle = 0; ; cycle++) {
    const type = nextType(configured, cycle);
    try {
      const contestId = await openContest({ type, poolUsdc, durationSeconds });
      console.log(`autopilot: opened ${type} contest ${contestId}`);
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
