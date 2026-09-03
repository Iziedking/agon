import type { BnbChainId } from "./chains";

export type AgentJobStatus =
  | "draft"
  | "quoted"
  | "awaiting_approval"
  | "submitted"
  | "confirming"
  | "active"
  | "delivered"
  | "settled"
  | "failed"
  | "expired";

export type AgentJobEventType =
  | "quote_created"
  | "approval_requested"
  | "transaction_submitted"
  | "confirmation_started"
  | "job_started"
  | "delivery_recorded"
  | "settlement_recorded"
  | "job_failed"
  | "quote_expired";

export interface AgentJob {
  jobId: string;
  serviceId: string;
  serviceVersion: string;
  chainId: BnbChainId;
  status: AgentJobStatus;
  lastSequence: number;
  lastEventId: string | null;
  deliveryReference: string | null;
  settlementReference: string | null;
}

export interface AgentJobEvent {
  eventId: string;
  jobId: string;
  chainId: BnbChainId;
  sequence: number;
  type: AgentJobEventType;
  occurredAt: string;
  deliveryReference?: string;
  settlementReference?: string;
}

const transitions: Record<AgentJobStatus, readonly AgentJobStatus[]> = {
  draft: ["quoted", "failed"],
  quoted: ["awaiting_approval", "expired", "failed"],
  awaiting_approval: ["submitted", "expired", "failed"],
  submitted: ["confirming", "failed"],
  confirming: ["active", "failed"],
  active: ["delivered", "failed"],
  delivered: ["settled", "failed"],
  settled: [],
  failed: [],
  expired: [],
};

const eventStatus: Record<AgentJobEventType, AgentJobStatus> = {
  quote_created: "quoted",
  approval_requested: "awaiting_approval",
  transaction_submitted: "submitted",
  confirmation_started: "confirming",
  job_started: "active",
  delivery_recorded: "delivered",
  settlement_recorded: "settled",
  job_failed: "failed",
  quote_expired: "expired",
};

export function canTransitionJob(from: AgentJobStatus, to: AgentJobStatus): boolean {
  return transitions[from].includes(to);
}

/** Apply one ordered event. Duplicate event ids are idempotent; gaps and cross-chain events fail closed. */
export function applyJobEvent(job: AgentJob, event: AgentJobEvent): AgentJob {
  if (event.jobId !== job.jobId || event.chainId !== job.chainId) throw new Error("job_event_scope_mismatch");
  if (event.eventId === job.lastEventId) return job;
  if (event.sequence !== job.lastSequence + 1) throw new Error("job_event_sequence_mismatch");

  const nextStatus = eventStatus[event.type];
  if (!canTransitionJob(job.status, nextStatus)) throw new Error("job_transition_not_allowed");
  if (nextStatus === "delivered" && !event.deliveryReference) throw new Error("delivery_reference_required");
  if (nextStatus === "settled" && !event.settlementReference) throw new Error("settlement_reference_required");

  return {
    ...job,
    status: nextStatus,
    lastSequence: event.sequence,
    lastEventId: event.eventId,
    deliveryReference: event.deliveryReference ?? job.deliveryReference,
    settlementReference: event.settlementReference ?? job.settlementReference,
  };
}

