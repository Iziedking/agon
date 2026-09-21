export type AgonLifecycleStatus = "pending" | "healthy" | "warning" | "suspended";
export type AgonLifecycleAction = "approve" | "alert" | "suspend" | "recover";

export type AgonLifecycleTransition = {
  status: AgonLifecycleStatus;
  consecutiveFailures: number;
  actions: AgonLifecycleAction[];
};

export type AgonLifecycleCheckResult = {
  checkId: string;
  passed: boolean;
  reasons: readonly string[];
  playgroundRunId: string | null;
  score: number | null;
  evidenceRoot: `0x${string}` | null;
  responseHash: `0x${string}` | null;
  taskCommitment: `0x${string}` | null;
  validationRequestHash: `0x${string}` | null;
  evaluatorVersionHash: `0x${string}` | null;
  providerHost: string | null;
  endpointQaEvidenceHash: `0x${string}` | null;
  checkedAt: Date;
  nextCheckAt: Date;
  failureThreshold: number;
};

export function evaluateAgonLifecycle(input: {
  previousStatus: AgonLifecycleStatus;
  previousConsecutiveFailures: number;
  passed: boolean;
  failureThreshold: number;
}): AgonLifecycleTransition {
  if (!Number.isSafeInteger(input.previousConsecutiveFailures) || input.previousConsecutiveFailures < 0) {
    throw new Error("previous lifecycle failures must be a non-negative integer");
  }
  if (!Number.isSafeInteger(input.failureThreshold) || input.failureThreshold < 1 || input.failureThreshold > 10) {
    throw new Error("lifecycle failure threshold must be between 1 and 10");
  }
  if (input.passed) {
    const recovering = input.previousStatus === "warning" || input.previousStatus === "suspended";
    return {
      status: "healthy",
      consecutiveFailures: 0,
      actions: [recovering ? "recover" : "approve"],
    };
  }
  const consecutiveFailures = input.previousConsecutiveFailures + 1;
  if (consecutiveFailures >= input.failureThreshold) {
    return { status: "suspended", consecutiveFailures, actions: ["alert", "suspend"] };
  }
  return { status: "warning", consecutiveFailures, actions: ["alert"] };
}

export function nextAgonLifecycleCheck(input: {
  now: Date;
  passed: boolean;
  checkIntervalMs: number;
  warningRetryMs: number;
}): Date {
  if (!Number.isFinite(input.now.getTime())) throw new Error("lifecycle time is invalid");
  const delay = input.passed ? input.checkIntervalMs : input.warningRetryMs;
  if (!Number.isSafeInteger(delay) || delay < 60_000) throw new Error("lifecycle interval must be at least one minute");
  return new Date(input.now.getTime() + delay);
}
