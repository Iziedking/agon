import { config } from "../config/index.js";
import { openContest } from "./contestOps.js";
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

function nextType(configured: string, cycle: number): string {
  return configured === "rotate" ? ROTATION[cycle % ROTATION.length]! : configured;
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

  for (let cycle = 0; ; cycle++) {
    const type = nextType(configured, cycle);
    try {
      const contestId = await openContest({ type, poolUsdc, durationSeconds });
      console.log(`autopilot: opened ${type} contest ${contestId}`);
      broadcast({ type: "contest_open", contestId, contestType: type, endsAt: Date.now() + durationSeconds * 1000 });

      // Streams standings over the window, then settles (or refunds if empty).
      await runContestById(contestId, broadcast);
      console.log(`autopilot: contest ${contestId} complete`);
    } catch (err) {
      console.error("autopilot cycle failed:", err instanceof Error ? err.message : err);
    }
    await sleep(gapSeconds * 1000);
  }
}
