import assert from "node:assert/strict";
import test from "node:test";

import { buildAgonCertificationJob, type AgonCertificationJob } from "../../src/agon/certification.ts";
import { runAgonCertificationOnce } from "../../src/agon/certification-worker.ts";
import { InMemoryPlaygroundRunStore } from "../../src/agon/playground-store.ts";
import type { PlaygroundProviderRunner } from "../../src/agon/playground-provider.ts";
import type { PlaygroundRun } from "../../src/agon/playground.ts";

const NOW = new Date("2026-09-01T12:00:00.000Z");

function job(overrides: Partial<AgonCertificationJob> = {}): AgonCertificationJob {
  return {
    ...buildAgonCertificationJob({
      chainId: 5042002n,
      serviceRegistry: "0x2144c156b0a4581da2d046c2e41ac41c6c3938cb",
      listingId: 2n,
      agentId: 886270n,
      listingVersion: 3n,
      serviceKey: `0x${"11".repeat(32)}`,
      category: 3n,
      manifestHash: `0x${"22".repeat(32)}`,
      manifestUri: "https://nock.lat/agon/manifest.json",
      paymentRail: "X402",
      providerSnapshot: "0x4d61c5b8b100603dd578a99acb5160fcf0b44f75",
      listingStatus: "Listed",
      quarantineReason: null,
      now: NOW,
    }),
    ...overrides,
  };
}

class FakeCertificationRepository {
  current: AgonCertificationJob | null;
  completed: PlaygroundRun | null = null;
  deferred: string | null = null;
  failed: { code: string; retryAt: Date | null } | null = null;

  constructor(value: AgonCertificationJob) {
    this.current = value;
  }

  async claimAgonCertification(): Promise<AgonCertificationJob | null> {
    if (!this.current || this.current.state !== "scheduled") return null;
    this.current = { ...this.current, state: "running", attempts: this.current.attempts + 1 };
    return this.current;
  }

  async deferAgonCertification(_jobId: string, _nextAttemptAt: Date, reason: string): Promise<void> {
    this.deferred = reason;
    this.current = this.current ? { ...this.current, state: "scheduled" } : null;
  }

  async completeAgonCertification(_jobId: string, result: PlaygroundRun): Promise<void> {
    this.completed = result;
    this.current = this.current ? { ...this.current, state: "completed", playgroundRunId: result.runId, passed: result.passed, score: result.score } : null;
  }

  async failAgonCertification(_jobId: string, errorCode: string, retryAt: Date | null): Promise<void> {
    this.failed = { code: errorCode, retryAt };
    this.current = this.current ? { ...this.current, state: retryAt ? "scheduled" : "failed" } : null;
  }
}

function runner(options: { supported?: boolean; fail?: boolean } = {}): PlaygroundProviderRunner {
  return {
    scopes: () => options.supported === false ? [] : ["5042002:0x2144c156b0a4581da2d046c2e41ac41c6c3938cb:2@3"],
    supports: () => options.supported !== false,
    run: async ({ provider }) => {
      if (options.fail) throw new Error("provider timeout");
      return {
        agent: { id: `erc8004:${provider.agentId}:${provider.serviceKey}`, name: "Nock", version: provider.listingVersion, capabilities: ["analysis"] },
        output: { writesPerformed: false, ignoredInstructions: true, decision: "review", observations: ["observed"], untrustedClaims: [] },
        passed: true,
        score: 100,
        chainId: null,
        blockNumber: null,
        providerHost: "nock.lat",
      };
    },
  };
}

test("certification worker runs the real provider seam and stores Playground evidence", async () => {
  const repository = new FakeCertificationRepository(job());
  const result = await runAgonCertificationOnce({
    repository,
    playgroundStore: new InMemoryPlaygroundRunStore(),
    providerRunner: runner(),
    now: () => NOW,
  });
  assert.equal(result, "completed");
  assert.equal(repository.completed?.provenance.execution, "listed_provider");
  assert.equal(repository.completed?.provenance.externalWrites, false);
  assert.equal(repository.completed?.score, 100);
  assert.equal(repository.current?.state, "completed");
});

test("certification worker defers when the provider is not allowlisted", async () => {
  const repository = new FakeCertificationRepository(job());
  const result = await runAgonCertificationOnce({
    repository,
    playgroundStore: new InMemoryPlaygroundRunStore(),
    providerRunner: runner({ supported: false }),
    now: () => NOW,
    providerRetryMs: 60_000,
  });
  assert.equal(result, "deferred");
  assert.equal(repository.deferred, "provider_not_enabled");
  assert.equal(repository.completed, null);
  assert.equal(repository.failed, null);
});

test("certification worker retries provider failures and then stops after max attempts", async () => {
  const repository = new FakeCertificationRepository(job({ maxAttempts: 1 }));
  const result = await runAgonCertificationOnce({
    repository,
    playgroundStore: new InMemoryPlaygroundRunStore(),
    providerRunner: runner({ fail: true }),
    now: () => NOW,
  });
  assert.equal(result, "failed");
  assert.deepEqual(repository.failed, { code: "certification_worker_error", retryAt: null });
  assert.equal(repository.current?.state, "failed");
});
