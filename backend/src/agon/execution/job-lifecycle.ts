export const AGON_JOB_MIN_REVIEW_HOURS = 1;
export const AGON_JOB_MAX_REVIEW_HOURS = 720;

export type AgonJobState = "created" | "accepted" | "submitted" | "complete" | "rejected" | "disputed" | "failed";
export type AgonJobSettlement = "none" | "provider_paid" | "buyer_refunded";
export type AgonJobActor = "buyer" | "provider" | "resolver" | "public";
export type AgonJobAction =
  | "accept"
  | "submit"
  | "accept_submission"
  | "auto_accept"
  | "reject"
  | "dispute"
  | "resolve_pay"
  | "resolve_refund"
  | "fail";

export type AgonJobLifecycle = {
  state: AgonJobState;
  settlement: AgonJobSettlement;
  reviewHours: number;
  acceptanceDeadline: Date;
  reviewDeadline: Date | null;
  submittedAt: Date | null;
  deliverableHash: `0x${string}` | null;
  reasonHash: `0x${string}` | null;
};

export type AgonJobLifecycleErrorCode =
  | "invalid_job"
  | "invalid_transition"
  | "acceptance_window_open"
  | "acceptance_window_closed"
  | "review_window_open"
  | "review_window_closed"
  | "invalid_evidence"
  | "wrong_actor";

export type AgonJobLifecycleError = { code: AgonJobLifecycleErrorCode; message: string };
export type AgonJobLifecycleResult =
  | { ok: true; value: AgonJobLifecycle }
  | { ok: false; error: AgonJobLifecycleError };

const HASH = /^0x[0-9a-fA-F]{64}$/;

function fail(code: AgonJobLifecycleErrorCode, message: string): AgonJobLifecycleResult {
  return { ok: false, error: { code, message } };
}

function validDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}

function clone(value: AgonJobLifecycle): AgonJobLifecycle {
  return {
    ...value,
    acceptanceDeadline: new Date(value.acceptanceDeadline),
    reviewDeadline: value.reviewDeadline ? new Date(value.reviewDeadline) : null,
    submittedAt: value.submittedAt ? new Date(value.submittedAt) : null,
  };
}

function validHash(value: string | null | undefined): value is `0x${string}` {
  return typeof value === "string" && HASH.test(value) && !/^0x0{64}$/i.test(value);
}

function actorIs(input: { actor: AgonJobActor; expected: AgonJobActor }): AgonJobLifecycleResult | null {
  return input.actor === input.expected ? null : fail("wrong_actor", `${input.expected} authority is required for this job action`);
}

export function createAgonJobLifecycle(input: {
  createdAt: Date;
  reviewHours: number;
}): AgonJobLifecycleResult {
  if (!validDate(input.createdAt) || !Number.isInteger(input.reviewHours) || input.reviewHours < AGON_JOB_MIN_REVIEW_HOURS || input.reviewHours > AGON_JOB_MAX_REVIEW_HOURS) {
    return fail("invalid_job", "job creation time and review hours are invalid");
  }
  return {
    ok: true,
    value: {
      state: "created",
      settlement: "none",
      reviewHours: input.reviewHours,
      acceptanceDeadline: new Date(input.createdAt.getTime() + input.reviewHours * 60 * 60 * 1000),
      reviewDeadline: null,
      submittedAt: null,
      deliverableHash: null,
      reasonHash: null,
    },
  };
}

export function transitionAgonJobLifecycle(input: {
  job: AgonJobLifecycle;
  action: AgonJobAction;
  actor: AgonJobActor;
  now: Date;
  evidenceHash?: string;
}): AgonJobLifecycleResult {
  const job = clone(input.job);
  if (!validDate(input.now) || !validDate(job.acceptanceDeadline) || (job.reviewDeadline !== null && !validDate(job.reviewDeadline))) {
    return fail("invalid_job", "job lifecycle timestamps are invalid");
  }
  const now = input.now.getTime();
  const acceptanceDeadline = job.acceptanceDeadline.getTime();
  const evidenceHash = input.evidenceHash;

  if (input.action === "accept") {
    const actorError = actorIs({ actor: input.actor, expected: "provider" });
    if (actorError) return actorError;
    if (job.state !== "created") return fail("invalid_transition", `cannot accept a ${job.state} job`);
    if (now > acceptanceDeadline) return fail("acceptance_window_closed", "job acceptance window has closed");
    job.state = "accepted";
    return { ok: true, value: job };
  }

  if (input.action === "submit") {
    const actorError = actorIs({ actor: input.actor, expected: "provider" });
    if (actorError) return actorError;
    if (job.state !== "accepted") return fail("invalid_transition", `cannot submit a ${job.state} job`);
    if (now > acceptanceDeadline) return fail("acceptance_window_closed", "job submission window has closed");
    if (!validHash(evidenceHash)) return fail("invalid_evidence", "a non-zero deliverable hash is required");
    job.state = "submitted";
    job.deliverableHash = evidenceHash;
    job.submittedAt = new Date(input.now);
    job.reviewDeadline = new Date(now + job.reviewHours * 60 * 60 * 1000);
    return { ok: true, value: job };
  }

  if (input.action === "accept_submission" || input.action === "reject") {
    const actorError = actorIs({ actor: input.actor, expected: "buyer" });
    if (actorError) return actorError;
    if (job.state !== "submitted" || !job.reviewDeadline) return fail("invalid_transition", `cannot review a ${job.state} job`);
    if (now > job.reviewDeadline.getTime()) return fail("review_window_closed", "job review window has closed");
    if (input.action === "reject") {
      if (!validHash(evidenceHash)) return fail("invalid_evidence", "a non-zero rejection reason hash is required");
      job.state = "rejected";
      job.reasonHash = evidenceHash;
    } else {
      job.state = "complete";
      job.settlement = "provider_paid";
    }
    return { ok: true, value: job };
  }

  if (input.action === "auto_accept") {
    if (input.actor !== "public") return fail("wrong_actor", "auto-accept is a permissionless timeout action");
    if (job.state !== "submitted" || !job.reviewDeadline) return fail("invalid_transition", `cannot auto-accept a ${job.state} job`);
    if (now <= job.reviewDeadline.getTime()) return fail("review_window_open", "job review window is still open");
    job.state = "complete";
    job.settlement = "provider_paid";
    return { ok: true, value: job };
  }

  if (input.action === "dispute") {
    if (input.actor !== "buyer" && input.actor !== "provider") return fail("wrong_actor", "only the buyer or provider can open a dispute");
    if (job.state !== "rejected") return fail("invalid_transition", `cannot dispute a ${job.state} job`);
    if (!validHash(evidenceHash)) return fail("invalid_evidence", "a non-zero dispute reason hash is required");
    job.state = "disputed";
    job.reasonHash = evidenceHash;
    return { ok: true, value: job };
  }

  if (input.action === "resolve_pay" || input.action === "resolve_refund") {
    const actorError = actorIs({ actor: input.actor, expected: "resolver" });
    if (actorError) return actorError;
    if (job.state !== "disputed") return fail("invalid_transition", `cannot resolve a ${job.state} job`);
    job.state = input.action === "resolve_pay" ? "complete" : "failed";
    job.settlement = input.action === "resolve_pay" ? "provider_paid" : "buyer_refunded";
    return { ok: true, value: job };
  }

  const actorError = actorIs({ actor: input.actor, expected: "buyer" });
  if (actorError) return actorError;
  if (input.action !== "fail" || (job.state !== "created" && job.state !== "accepted")) {
    return fail("invalid_transition", `cannot fail a ${job.state} job`);
  }
  if (now <= acceptanceDeadline) return fail("acceptance_window_open", "job acceptance window is still open");
  job.state = "failed";
  job.settlement = "buyer_refunded";
  return { ok: true, value: job };
}
