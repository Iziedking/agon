import assert from "node:assert/strict";
import test from "node:test";
import {
  createAgonJobLifecycle,
  transitionAgonJobLifecycle,
} from "../../src/agon/execution/job-lifecycle.ts";

const CREATED = new Date("2026-08-24T08:00:00.000Z");
const DELIVERABLE = `0x${"11".repeat(32)}`;
const REASON = `0x${"22".repeat(32)}`;

function created() {
  const result = createAgonJobLifecycle({ createdAt: CREATED, reviewHours: 35 });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function transition(job: ReturnType<typeof created>, action: Parameters<typeof transitionAgonJobLifecycle>[0]["action"], actor: Parameters<typeof transitionAgonJobLifecycle>[0]["actor"], now: string, evidenceHash?: string) {
  const result = transitionAgonJobLifecycle({ job, action, actor, now: new Date(now), evidenceHash });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

test("creates an immutable acceptance window and validates review bounds", () => {
  const job = created();
  assert.equal(job.acceptanceDeadline.toISOString(), "2026-08-25T19:00:00.000Z");
  assert.deepEqual(createAgonJobLifecycle({ createdAt: CREATED, reviewHours: 0 }), {
    ok: false,
    error: { code: "invalid_job", message: "job creation time and review hours are invalid" },
  });
});

test("mirrors provider submission, buyer review, and provider settlement", () => {
  let job = transition(created(), "accept", "provider", "2026-08-24T09:00:00.000Z");
  job = transition(job, "submit", "provider", "2026-08-24T10:00:00.000Z", DELIVERABLE);
  assert.equal(job.reviewDeadline?.toISOString(), "2026-08-25T21:00:00.000Z");
  job = transition(job, "accept_submission", "buyer", "2026-08-24T11:00:00.000Z");
  assert.equal(job.state, "complete");
  assert.equal(job.settlement, "provider_paid");
});

test("prevents late review and preserves rejected-to-disputed resolution", () => {
  let job = transition(created(), "accept", "provider", "2026-08-24T09:00:00.000Z");
  job = transition(job, "submit", "provider", "2026-08-24T10:00:00.000Z", DELIVERABLE);
  assert.deepEqual(transitionAgonJobLifecycle({
    job,
    action: "accept_submission",
    actor: "buyer",
    now: new Date("2026-08-25T21:00:01.000Z"),
  }), {
    ok: false,
    error: { code: "review_window_closed", message: "job review window has closed" },
  });
  job = transition(job, "reject", "buyer", "2026-08-24T11:00:00.000Z", REASON);
  job = transition(job, "dispute", "provider", "2026-08-24T12:00:00.000Z", REASON);
  job = transition(job, "resolve_refund", "resolver", "2026-08-24T13:00:00.000Z");
  assert.equal(job.state, "failed");
  assert.equal(job.settlement, "buyer_refunded");
});

test("auto-accept is timeout-only and failed jobs refund after the acceptance window", () => {
  let job = transition(created(), "accept", "provider", "2026-08-24T09:00:00.000Z");
  job = transition(job, "submit", "provider", "2026-08-24T10:00:00.000Z", DELIVERABLE);
  assert.deepEqual(transitionAgonJobLifecycle({
    job,
    action: "auto_accept",
    actor: "public",
    now: new Date("2026-08-25T20:59:59.000Z"),
  }), {
    ok: false,
    error: { code: "review_window_open", message: "job review window is still open" },
  });
  job = transition(job, "auto_accept", "public", "2026-08-25T21:00:01.000Z");
  assert.equal(job.settlement, "provider_paid");

  const unaccepted = created();
  assert.deepEqual(transitionAgonJobLifecycle({ job: unaccepted, action: "fail", actor: "buyer", now: new Date("2026-08-24T09:00:00.000Z") }), {
    ok: false,
    error: { code: "acceptance_window_open", message: "job acceptance window is still open" },
  });
  const failed = transitionAgonJobLifecycle({ job: unaccepted, action: "fail", actor: "buyer", now: new Date("2026-08-25T19:00:01.000Z") });
  assert.equal(failed.ok, true);
  if (failed.ok) assert.equal(failed.value.settlement, "buyer_refunded");
});
