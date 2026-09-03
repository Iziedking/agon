import type { BnbChainId } from "./chains";

export type EvidenceSourceKind = "bscscan" | "8004scan" | "endpoint" | "pancakeswap" | "provider";
export type EvidenceStatus = "passed" | "stale" | "missing" | "failed" | "unavailable";

export interface EvidenceObservation {
  observationId: string;
  subjectId: string;
  chainId: BnbChainId;
  source: {
    kind: EvidenceSourceKind;
    label: string;
    url: string;
  };
  observedAt: string;
  status: EvidenceStatus;
  claim: string;
  reference?: string;
  measurementWindow?: string;
}

export interface EvidenceSummary {
  subjectId: string;
  chainId: BnbChainId;
  overall: "qualified" | "partial" | "blocked";
  latestObservedAt: string | null;
  passed: number;
  stale: number;
  missing: number;
  failed: number;
  sources: EvidenceSourceKind[];
  reason: string;
}

/**
 * Summarise only observations for one subject and one selected network.
 * Discovery sources enrich the record; they do not override a failed proof.
 */
export function summarizeEvidence(
  subjectId: string,
  chainId: BnbChainId,
  observations: readonly EvidenceObservation[],
): EvidenceSummary {
  const scoped = observations.filter((item) => item.subjectId === subjectId && item.chainId === chainId);
  const passed = scoped.filter((item) => item.status === "passed").length;
  const stale = scoped.filter((item) => item.status === "stale").length;
  const missing = scoped.filter((item) => item.status === "missing").length;
  const failed = scoped.filter((item) => item.status === "failed" || item.status === "unavailable").length;
  const latestObservedAt = scoped
    .map((item) => item.observedAt)
    .sort((a, b) => b.localeCompare(a))[0] ?? null;
  const sources = [...new Set(scoped.map((item) => item.source.kind))];

  let overall: EvidenceSummary["overall"] = "blocked";
  let reason = "No evidence observations are available for this network.";
  if (failed > 0) {
    reason = "At least one evidence check failed or is unavailable.";
  } else if (passed > 0 && stale === 0 && missing === 0) {
    overall = "qualified";
    reason = "All recorded checks passed for the selected network.";
  } else if (passed > 0 || stale > 0) {
    overall = "partial";
    reason = "Some checks are present, but the proof stack is incomplete or stale.";
  }

  return {
    subjectId,
    chainId,
    overall,
    latestObservedAt,
    passed,
    stale,
    missing,
    failed,
    sources,
    reason,
  };
}

export function canActivateFromEvidence(summary: EvidenceSummary): boolean {
  return summary.overall === "qualified" && summary.failed === 0 && summary.missing === 0 && summary.stale === 0;
}

