import assert from "node:assert/strict";
import test from "node:test";

import { canActivateFromEvidence, summarizeEvidence, type EvidenceObservation } from "./evidence.ts";

const observation = (overrides: Partial<EvidenceObservation> = {}): EvidenceObservation => ({
  observationId: "obs-1",
  subjectId: "agent-1",
  chainId: 56,
  source: { kind: "endpoint", label: "Provider endpoint", url: "https://example.invalid/health" },
  observedAt: "2026-09-03T10:00:00.000Z",
  status: "passed",
  claim: "Endpoint responded with the declared schema.",
  ...overrides,
});

test("evidence summary is qualified only when every scoped check passes", () => {
  const summary = summarizeEvidence("agent-1", 56, [observation(), observation({ observationId: "obs-2", source: { kind: "bscscan", label: "BscScan", url: "https://bscscan.com" } })]);
  assert.equal(summary.overall, "qualified");
  assert.equal(canActivateFromEvidence(summary), true);
});

test("stale, failed, and cross-network observations cannot qualify a service", () => {
  const summary = summarizeEvidence("agent-1", 56, [
    observation({ status: "stale" }),
    observation({ observationId: "obs-2", status: "failed" }),
    observation({ observationId: "obs-3", chainId: 97 }),
  ]);
  assert.equal(summary.overall, "blocked");
  assert.equal(summary.failed, 1);
  assert.equal(canActivateFromEvidence(summary), false);
});

