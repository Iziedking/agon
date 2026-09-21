import { notify } from "../../notifications/index.ts";

export type AgonCertificationAlert = {
  operator: string;
  listingReference: string;
  listingVersion: string;
  status: "warning" | "suspended" | "recovered";
  reasons: readonly string[];
  consecutiveFailures: number;
};

export async function alertAgonCertificationOperator(input: AgonCertificationAlert): Promise<void> {
  const suspended = input.status === "suspended";
  const recovered = input.status === "recovered";
  await notify(input.operator, {
    kind: "agon_service_lifecycle",
    title: recovered
      ? "Agon service recovered"
      : suspended ? "Agon service suspended after repeated checks" : "Agon service check needs attention",
    body: recovered
      ? `Version ${input.listingVersion} is healthy again after an automatic recheck.`
      : `Version ${input.listingVersion} failed ${input.consecutiveFailures} consecutive check(s): ${input.reasons.join(", ") || "service promise not met"}.`,
    href: `/market/${encodeURIComponent(input.listingReference)}`,
    context: {
      listingReference: input.listingReference,
      listingVersion: input.listingVersion,
      status: input.status,
      reasons: input.reasons.slice(0, 16),
      consecutiveFailures: input.consecutiveFailures,
      source: "agon-certification-lifecycle",
    },
  });
}
