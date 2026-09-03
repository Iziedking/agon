import assert from "node:assert/strict";
import test from "node:test";

import { getQuoteState, isQuoteUsable, type AgentQuote } from "./quote.ts";
import { applyJobEvent, type AgentJob, type AgentJobEvent } from "./job.ts";

const quote: AgentQuote = {
  quoteId: "quote-1",
  serviceId: "agent-1",
  chainId: 56,
  serviceVersion: "v1",
  amount: "0.0014",
  currency: "USDC",
  authorityScope: "revokeAfterMinutes",
  issuedAt: "2026-09-03T10:00:00.000Z",
  expiresAt: "2026-09-03T10:05:00.000Z",
};

const job: AgentJob = {
  jobId: "job-1",
  serviceId: "agent-1",
  serviceVersion: "v1",
  chainId: 56,
  status: "draft",
  lastSequence: 0,
  lastEventId: null,
  deliveryReference: null,
  settlementReference: null,
};

function event(sequence: number, type: AgentJobEvent["type"], extra: Partial<AgentJobEvent> = {}): AgentJobEvent {
  return { eventId: `event-${sequence}`, jobId: "job-1", chainId: 56, sequence, type, occurredAt: "2026-09-03T10:00:00.000Z", ...extra };
}

test("quotes expire and cannot cross chain or service version", () => {
  assert.equal(getQuoteState(quote, Date.parse("2026-09-03T10:04:59.000Z")), "active");
  assert.equal(getQuoteState(quote, Date.parse("2026-09-03T10:05:00.000Z")), "expired");
  assert.equal(isQuoteUsable(quote, 97, "v1", Date.parse("2026-09-03T10:04:00.000Z")), false);
  assert.equal(isQuoteUsable(quote, 56, "v2", Date.parse("2026-09-03T10:04:00.000Z")), false);
});

test("job events are ordered, idempotent, and require delivery proof", () => {
  const quoted = applyJobEvent(job, event(1, "quote_created"));
  assert.equal(quoted.status, "quoted");
  assert.equal(applyJobEvent(quoted, event(1, "quote_created")), quoted);
  assert.throws(() => applyJobEvent(quoted, event(3, "approval_requested")), /sequence/);

  const approved = applyJobEvent(quoted, event(2, "approval_requested"));
  const submitted = applyJobEvent(approved, event(3, "transaction_submitted"));
  const confirming = applyJobEvent(submitted, event(4, "confirmation_started"));
  const active = applyJobEvent(confirming, event(5, "job_started"));
  assert.throws(() => applyJobEvent(active, event(6, "delivery_recorded")), /delivery_reference/);
  const delivered = applyJobEvent(active, event(6, "delivery_recorded", { deliveryReference: "delivery-1" }));
  assert.equal(delivered.status, "delivered");
});
