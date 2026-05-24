import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { config } from "../config/index.js";

/// Contest scheduler built on BullMQ. Registers one repeatable job per contest
/// family at the cadence from the plan, plus weekly war. The handler is injected
/// so the coordinator decides what "open a contest" does (in v0 it logs and
/// fans out; wiring the real on-chain listContest comes with the funding flow).

export const CONTEST_QUEUE = "contests";

/// Cadence in milliseconds. Plan section 5.2.
const CADENCE_MS: Record<string, number> = {
  SCOUT: 48 * 60 * 60 * 1000,
  ANALYST: 5 * 60 * 1000,
  SOLVER: 7 * 60 * 1000,
};

function connection() {
  // BullMQ requires maxRetriesPerRequest: null. Workers need a dedicated
  // blocking connection, so each caller gets its own.
  return new Redis(config.redisUrl, { maxRetriesPerRequest: null });
}

export type OpenHandler = (contestType: string) => Promise<void> | void;

export async function startScheduler(onOpen: OpenHandler): Promise<Worker> {
  const queue = new Queue(CONTEST_QUEUE, { connection: connection() });

  for (const [type, every] of Object.entries(CADENCE_MS)) {
    await queue.add("open", { type }, { repeat: { every }, removeOnComplete: true, removeOnFail: 100 });
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

  worker.on("failed", (job, err) => console.error(`job ${job?.id} failed:`, err.message));
  return worker;
}
