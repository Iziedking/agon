import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { config } from "../config/index.js";
import { openContest, type OpenOpts } from "./contestOps.js";
import { pinArcanaMarketsForContest } from "../lib/arcanaPins.js";

/// Cadence-driven contest scheduler. Runs three BullMQ repeatable jobs at
/// per-type intervals (Scout 48h, Analyst 5m, Solver 7m). Each
/// fire opens a fresh contest of that type via the same on-chain
/// listContest path the autopilot uses. Settle-sweepers in autopilot.ts
/// pick the contests up when their windows close.
///
/// Two modes coexist:
///   - SCHEDULER_MODE=cadence:   per-type concurrent cadence (this file)
///   - SCHEDULER_MODE=autopilot: single rotating contest at a time (autopilot.ts)
/// Default is autopilot (one contest in focus). Cadence mode is the
/// production model.

export const CONTEST_QUEUE = "contests";

/// Per-type cadence (ms).
const CADENCE_MS: Record<string, number> = {
  SCOUT: 48 * 60 * 60 * 1000,
  ANALYST: 5 * 60 * 1000,
  SOLVER: 7 * 60 * 1000,
};

/// Per-type sane defaults for pool size and window. Each is overridable
/// by env so an operator can tune cadence-mode pools without code edits.
function defaultsFor(type: string): OpenOpts {
  if (type === "SCOUT") {
    return {
      type: "scout",
      poolUsdc: Number(process.env.SCHEDULER_SCOUT_POOL_USDC ?? "5"),
      durationSeconds: Number(process.env.SCHEDULER_SCOUT_DURATION_SECONDS ?? String(48 * 60 * 60)),
      winnerCutBps: Number(process.env.SCHEDULER_SCOUT_WINNER_CUT_BPS ?? "6000"),
      topN: Number(process.env.SCHEDULER_SCOUT_TOP_N ?? "3"),
    };
  }
  if (type === "ANALYST") {
    return {
      type: "analyst",
      poolUsdc: Number(process.env.SCHEDULER_ANALYST_POOL_USDC ?? "1"),
      durationSeconds: Number(process.env.SCHEDULER_ANALYST_DURATION_SECONDS ?? String(5 * 60)),
      winnerCutBps: Number(process.env.SCHEDULER_ANALYST_WINNER_CUT_BPS ?? "6000"),
      topN: Number(process.env.SCHEDULER_ANALYST_TOP_N ?? "3"),
    };
  }
  return {
    type: "solver",
    poolUsdc: Number(process.env.SCHEDULER_SOLVER_POOL_USDC ?? "1"),
    durationSeconds: Number(process.env.SCHEDULER_SOLVER_DURATION_SECONDS ?? String(7 * 60)),
    winnerCutBps: Number(process.env.SCHEDULER_SOLVER_WINNER_CUT_BPS ?? "6000"),
    topN: Number(process.env.SCHEDULER_SOLVER_TOP_N ?? "3"),
  };
}

function connection() {
  // BullMQ requires maxRetriesPerRequest: null. Workers need a dedicated
  // blocking connection, so each caller gets its own.
  return new Redis(config.redisUrl, { maxRetriesPerRequest: null });
}

export type OpenHandler = (contestType: string) => Promise<void> | void;

/// Real per-type opener. Used by SCHEDULER_MODE=cadence. Each job fire
/// opens one contest of that type with the configured defaults and pins
/// Arcana markets if the type is ANALYST. Best-effort: if openContest
/// throws (insufficient USDC, RPC blip), the job retries via BullMQ's
/// default policy and the next fire still triggers on cadence.
export async function defaultOpenHandler(
  contestType: string,
  broadcast: (message: unknown) => void,
): Promise<void> {
  const opts = defaultsFor(contestType);
  try {
    const contestId = await openContest(opts);
    console.log(
      `scheduler: opened ${opts.type} contest ${contestId} (pool ${opts.poolUsdc} USDC, window ${opts.durationSeconds}s)`,
    );

    let arcanaMarkets:
      | Array<{ id: number; title: string; category: string; endTime: number }>
      | undefined;
    if (opts.type === "analyst") {
      const pinned = await pinArcanaMarketsForContest(contestId, 5).catch((err) => {
        console.error(
          `scheduler: pin arcana failed for contest ${contestId}: ${
            err instanceof Error ? err.message : err
          }`,
        );
        return [];
      });
      if (pinned.length > 0) {
        arcanaMarkets = pinned.map((m) => ({
          id: Number(m.marketId),
          title: m.title,
          category: m.category,
          endTime: Number(m.endTime),
        }));
      }
    }

    broadcast({
      type: "contest_open",
      contestId,
      contestType: opts.type,
      endsAt: Date.now() + opts.durationSeconds * 1000,
      ...(arcanaMarkets ? { arcanaMarkets } : {}),
    });
  } catch (err) {
    console.error(
      `scheduler: open ${opts.type} failed: ${err instanceof Error ? err.message : err}`,
    );
    throw err;
  }
}

/// Wire up the per-type cadence. The handler is injected so callers can
/// either pass `defaultOpenHandler` (cadence mode) or a log-only stub.
export async function startScheduler(onOpen: OpenHandler): Promise<Worker> {
  const queue = new Queue(CONTEST_QUEUE, { connection: connection() });

  for (const [type, every] of Object.entries(CADENCE_MS)) {
    await queue.add(
      "open",
      { type },
      { repeat: { every }, removeOnComplete: true, removeOnFail: 100 },
    );
  }

  // Optional immediate job so a short run can prove the worker processes jobs.
  if (process.env.COORDINATOR_DEMO === "1") {
    await queue.add("open", { type: "DEMO" }, { removeOnComplete: true });
  }

  const worker = new Worker(
    CONTEST_QUEUE,
    async (job) => {
      const type = (job.data as { type: string }).type;
      await onOpen(type);
    },
    { connection: connection() },
  );

  worker.on("failed", (job, err) =>
    console.error(`job ${job?.id} failed:`, err.message),
  );
  return worker;
}
