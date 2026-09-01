import { randomUUID } from "node:crypto";

import {
  defaultPlaygroundInput,
  runPlaygroundTask,
  type PlaygroundCategory,
  type PlaygroundRun,
} from "./playground.ts";
import type { PlaygroundRunStore } from "./playground-store.ts";
import {
  PlaygroundProviderError,
  type PlaygroundProviderRunner,
} from "./playground-provider.ts";
import { certificationBackoffMs, type AgonCertificationJob } from "./certification.ts";

export type CertificationWorkerRepository = {
  claimAgonCertification(now?: Date): Promise<AgonCertificationJob | null>;
  deferAgonCertification(jobId: string, nextAttemptAt: Date, reason: string): Promise<void>;
  completeAgonCertification(jobId: string, result: PlaygroundRun): Promise<void>;
  failAgonCertification(jobId: string, errorCode: string, nextAttemptAt: Date | null): Promise<void>;
};

export type CertificationWorkerOptions = {
  repository: CertificationWorkerRepository;
  playgroundStore: PlaygroundRunStore;
  providerRunner: PlaygroundProviderRunner;
  now?: () => Date;
  providerRetryMs?: number;
};

export type CertificationWorkerResult = "idle" | "completed" | "deferred" | "failed";

function nextRetryAt(job: AgonCertificationJob, now: Date): Date | null {
  return job.attempts < job.maxAttempts
    ? new Date(now.getTime() + certificationBackoffMs(job.attempts))
    : null;
}

function assertCertificationJob(job: AgonCertificationJob): asserts job is AgonCertificationJob & {
  category: "analysis";
  taskId: "evidence-under-pressure";
} {
  if (job.category !== "analysis" || job.taskId !== "evidence-under-pressure") {
    throw new PlaygroundProviderError("provider_task_unsupported", "This certification task is not available.");
  }
}

export async function runAgonCertificationOnce(options: CertificationWorkerOptions): Promise<CertificationWorkerResult> {
  const now = options.now?.() ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("certification worker time is invalid");
  const job = await options.repository.claimAgonCertification(now);
  if (!job) return "idle";

  try {
    assertCertificationJob(job);
    const provider = {
      agentId: job.agentId,
      serviceKey: job.serviceKey,
      listingReference: job.listingReference,
      listingVersion: job.listingVersion,
    };
    if (!options.providerRunner.supports(provider)) {
      const wait = options.providerRetryMs ?? 5 * 60_000;
      await options.repository.deferAgonCertification(job.jobId, new Date(now.getTime() + wait), "provider_not_enabled");
      return "deferred";
    }

    const result = await runPlaygroundTask(
      {
        category: job.category as PlaygroundCategory,
        taskId: job.taskId,
        input: defaultPlaygroundInput(job.taskId),
      },
      {
        actorAddress: job.providerSnapshot,
        requestId: randomUUID(),
        idempotencyKey: `certification-${job.jobId}`,
        scope: { listingReference: job.listingReference, listingVersion: job.listingVersion },
        store: options.playgroundStore,
        execute: (task, input) => options.providerRunner.run({ provider, task, taskInput: input }),
      },
    );
    await options.repository.completeAgonCertification(job.jobId, result);
    return "completed";
  } catch (error) {
    const errorCode = error instanceof PlaygroundProviderError ? error.code : "certification_worker_error";
    await options.repository.failAgonCertification(job.jobId, errorCode, nextRetryAt(job, now));
    return "failed";
  }
}

export async function agonCertificationWorkerLoop(
  options: CertificationWorkerOptions,
  config: { pollMs?: number; once?: boolean } = {},
): Promise<void> {
  const pollMs = config.pollMs ?? 5_000;
  if (!Number.isInteger(pollMs) || pollMs < 100) throw new Error("certification worker poll must be at least 100ms");
  let consecutiveFailures = 0;
  for (;;) {
    let result: CertificationWorkerResult;
    try {
      result = await runAgonCertificationOnce(options);
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures += 1;
      console.error("agon certification worker error", error);
      if (config.once) throw error;
      const backoff = Math.min(60_000, pollMs * 2 ** Math.min(consecutiveFailures - 1, 6));
      await new Promise((resolve) => setTimeout(resolve, backoff));
      continue;
    }
    if (config.once) return;
    if (result === "idle") await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
