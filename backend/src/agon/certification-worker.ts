import { randomUUID } from "node:crypto";
import { keccak256, stringToHex } from "viem";

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
import {
  AgonEndpointQaError,
  type AgonEndpointQaRunner,
} from "./endpoint-qa.ts";
import { certificationBackoffMs, type AgonCertificationJob } from "./certification.ts";

export type CertificationWorkerRepository = {
  backfillAgonCertifications?: (limit?: number, now?: Date) => Promise<number>;
  claimAgonCertification(now?: Date): Promise<AgonCertificationJob | null>;
  deferAgonCertification(jobId: string, nextAttemptAt: Date, reason: string): Promise<void>;
  completeAgonCertification(jobId: string, result: PlaygroundRun): Promise<void>;
  recordAgonEndpointQa?: (input: {
    listingId: bigint;
    agentId: bigint;
    passed: boolean;
    evidenceHash: `0x${string}`;
    evidence: unknown;
  }) => Promise<void>;
  failAgonCertification(jobId: string, errorCode: string, nextAttemptAt: Date | null): Promise<void>;
};

export type CertificationWorkerOptions = {
  repository: CertificationWorkerRepository;
  playgroundStore: PlaygroundRunStore;
  providerRunner: PlaygroundProviderRunner;
  endpointQaRunner?: AgonEndpointQaRunner;
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

const CERTIFICATION_BACKFILL_BATCH_SIZE = 100;

async function backfillCertificationQueue(repository: CertificationWorkerRepository, now: Date): Promise<number> {
  if (!repository.backfillAgonCertifications) return 0;
  let processed = 0;
  for (;;) {
    const batch = await repository.backfillAgonCertifications(CERTIFICATION_BACKFILL_BATCH_SIZE, now);
    if (!Number.isSafeInteger(batch) || batch < 0 || batch > CERTIFICATION_BACKFILL_BATCH_SIZE) {
      throw new Error("certification backfill returned an invalid batch size");
    }
    processed += batch;
    if (batch < CERTIFICATION_BACKFILL_BATCH_SIZE) return processed;
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
    if (options.endpointQaRunner?.supports(provider) && options.repository.recordAgonEndpointQa) {
      let qa;
      try {
        qa = await options.endpointQaRunner.run({ provider });
      } catch (error) {
        const code = error instanceof AgonEndpointQaError ? error.code : "endpoint_qa_error";
        const evidence = {
          endpointUrl: null,
          endpointStatus: null,
          checkedAt: now.toISOString(),
          checks: { x402_payment: { passed: false, detail: error instanceof Error ? error.message : "endpoint QA failed", header: null } },
          error: code,
        };
        qa = {
          passed: false,
          evidenceHash: keccak256(stringToHex(JSON.stringify(evidence))) as `0x${string}`,
          evidence,
        };
      }
      await options.repository.recordAgonEndpointQa({
        listingId: BigInt(job.listingId),
        agentId: BigInt(job.agentId),
        passed: qa.passed,
        evidenceHash: qa.evidenceHash,
        evidence: qa.evidence,
      });
    }
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
  let backfillCompleted = false;
  for (;;) {
    let result: CertificationWorkerResult;
    try {
      if (!backfillCompleted) {
        const processed = await backfillCertificationQueue(options.repository, options.now?.() ?? new Date());
        backfillCompleted = true;
        if (processed > 0) console.log(`agon certification backfill processed ${processed} listing version(s)`);
      }
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
