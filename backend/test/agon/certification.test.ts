import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAgonCertificationJob,
  certificationBackoffMs,
  certificationDecision,
  certificationListingReference,
} from "../../src/agon/certification.ts";

const BASE = {
  chainId: 5042002n,
  serviceRegistry: "0x2144c156b0a4581da2d046c2e41ac41c6c3938cb",
  listingId: 2n,
  agentId: 886270n,
  listingVersion: 3n,
  serviceKey: `0x${"11".repeat(32)}`,
  category: 3n,
  manifestHash: `0x${"22".repeat(32)}`,
  manifestUri: "https://nock.lat/agon/manifest.json",
  paymentRail: "X402" as const,
  providerSnapshot: "0x4d61c5b8b100603dd578a99acb5160fcf0b44f75",
  listingStatus: "Listed" as const,
  quarantineReason: null,
  now: new Date("2026-09-01T12:00:00.000Z"),
};

test("certification scope is canonical and analysis listings are scheduled", () => {
  assert.equal(
    certificationListingReference(BASE.chainId, `0x${BASE.serviceRegistry.slice(2).toUpperCase()}`, BASE.listingId),
    "5042002:0x2144c156b0a4581da2d046c2e41ac41c6c3938cb:2",
  );
  const job = buildAgonCertificationJob(BASE);
  assert.equal(job.category, "analysis");
  assert.equal(job.taskId, "evidence-under-pressure");
  assert.equal(job.state, "scheduled");
  assert.equal(job.serviceKey, BASE.serviceKey);
  assert.equal(job.listingReference, "5042002:0x2144c156b0a4581da2d046c2e41ac41c6c3938cb:2");
});

test("unsupported and unsafe listing states are blocked without a runnable task", () => {
  assert.deepEqual(
    certificationDecision({ category: 7n, listingStatus: "Listed", quarantineReason: null }),
    { category: "development", taskId: null, state: "blocked", blockedReason: "category_not_supported" },
  );
  assert.deepEqual(
    certificationDecision({ category: 3n, listingStatus: "Suspended", quarantineReason: null }),
    { category: "analysis", taskId: "evidence-under-pressure", state: "blocked", blockedReason: "listing_not_active" },
  );
  assert.deepEqual(
    certificationDecision({ category: 3n, listingStatus: "Listed", quarantineReason: "missing_validated_version" }),
    { category: "analysis", taskId: "evidence-under-pressure", state: "blocked", blockedReason: "listing_quarantined" },
  );
});

test("certification rejects malformed immutable anchors and caps retry backoff", () => {
  assert.throws(() => buildAgonCertificationJob({ ...BASE, serviceKey: "0x1234" }), /service key must be a bytes32 value/);
  assert.throws(() => buildAgonCertificationJob({ ...BASE, manifestHash: "0x1234" }), /manifest hash must be a bytes32 value/);
  assert.equal(certificationBackoffMs(1), 5_000);
  assert.equal(certificationBackoffMs(5), 80_000);
  assert.equal(certificationBackoffMs(9), 900_000);
});
