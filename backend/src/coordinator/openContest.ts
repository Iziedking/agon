import "dotenv/config";

import { openContest } from "./contestOps.js";

/// Opens one platform-funded contest and leaves it OPEN for real operators to
/// enter from the UI. Unlike runContest (which opens and settles in one shot),
/// this just lists and funds the contest, then exits. Settle it later.
///
/// You usually do not need this: the coordinator's autopilot opens contests on a
/// loop. Use this only to open a one-off contest by hand.
///
/// Run: npm run open-contest
/// Env: CONTEST_TYPE=scout|analyst|solver  CONTEST_POOL_USDC=2
///      CONTEST_DURATION_SECONDS=600  CONTEST_WINNER_CUT_BPS=6000  CONTEST_TOP_N=3

async function main() {
  const type = (process.env.CONTEST_TYPE ?? "solver").toLowerCase();
  const poolUsdc = Number(process.env.CONTEST_POOL_USDC ?? "2");
  const durationSeconds = Number(process.env.CONTEST_DURATION_SECONDS ?? "600");
  const winnerCutBps = Number(process.env.CONTEST_WINNER_CUT_BPS ?? "6000");
  const topN = Number(process.env.CONTEST_TOP_N ?? "3");

  console.log(`opening ${type} contest, pool ${poolUsdc} USDC, open for ${durationSeconds}s...`);
  const contestId = await openContest({ type, poolUsdc, durationSeconds, winnerCutBps, topN });
  const endsAt = new Date(Date.now() + durationSeconds * 1000);
  console.log(`contest #${contestId} is OPEN. entries close around ${endsAt.toISOString()}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
