import assert from "node:assert/strict";
import test from "node:test";

import { evaluateAgonLifecycle, nextAgonLifecycleCheck } from "../../src/agon/certification-lifecycle.ts";

test("a clean initial lifecycle check approves the exact service version", () => {
  assert.deepEqual(evaluateAgonLifecycle({
    previousStatus: "pending",
    previousConsecutiveFailures: 0,
    passed: true,
    failureThreshold: 3,
  }), { status: "healthy", consecutiveFailures: 0, actions: ["approve"] });
});

test("transient failures warn before repeated defaults suspend", () => {
  const warning = evaluateAgonLifecycle({
    previousStatus: "healthy",
    previousConsecutiveFailures: 0,
    passed: false,
    failureThreshold: 3,
  });
  assert.deepEqual(warning, { status: "warning", consecutiveFailures: 1, actions: ["alert"] });
  const suspended = evaluateAgonLifecycle({
    previousStatus: "warning",
    previousConsecutiveFailures: 2,
    passed: false,
    failureThreshold: 3,
  });
  assert.deepEqual(suspended, { status: "suspended", consecutiveFailures: 3, actions: ["alert", "suspend"] });
});

test("a suspended service recovers only after another complete check", () => {
  assert.deepEqual(evaluateAgonLifecycle({
    previousStatus: "suspended",
    previousConsecutiveFailures: 4,
    passed: true,
    failureThreshold: 3,
  }), { status: "healthy", consecutiveFailures: 0, actions: ["recover"] });
});

test("healthy and warning checks use separate bounded schedules", () => {
  const now = new Date("2026-09-21T12:00:00.000Z");
  assert.equal(nextAgonLifecycleCheck({ now, passed: true, checkIntervalMs: 21_600_000, warningRetryMs: 900_000 }).toISOString(), "2026-09-21T18:00:00.000Z");
  assert.equal(nextAgonLifecycleCheck({ now, passed: false, checkIntervalMs: 21_600_000, warningRetryMs: 900_000 }).toISOString(), "2026-09-21T12:15:00.000Z");
});
