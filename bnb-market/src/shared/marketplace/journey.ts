import type { AgentDetail, AgentSummary, BnbChain, CommerceIntent, LpHiringReadiness } from "../types.ts";

/** Keep network query parameters outside fragments, including resume links. */
export function bnbHref(chain: BnbChain, path: string) {
  const url = new URL(path, "https://agon.invalid");
  url.searchParams.set("network", chain === 97 ? "bnb-testnet" : "bnb-mainnet");
  return `${url.pathname}${url.search}${url.hash}`;
}

export function isFinancialAgent(agent: AgentSummary) {
  return Boolean(agent.category || agent.outcomeMatches.length);
}

export function isReportService(agent: AgentDetail, readiness: LpHiringReadiness | null) {
  return agent.chainId === 97 && readiness?.chainId === 97 && agent.id === readiness.agentId
    && agent.registrationMatches !== false && agent.metadataStatus === "available"
    && agent.services.some(service => service.name.toLowerCase().replace(/[-_]/g, "") === "erc8183");
}

export function requestStatus(intent: CommerceIntent) {
  if (intent.delivery?.status === "failed" || intent.delivery?.status === "needs_attention") return "Delivery needs attention";
  if (intent.state === "funded" && intent.delivery?.status === "submitted") return "Report submitted";
  if (intent.state === "funded") return "Paid · preparing report";
  if (intent.state === "expired") return "Request expired";
  if (intent.state === "reverted") return "Transaction reverted";
  if (intent.state === "needs_attention") return "Request needs attention";
  if (intent.state.endsWith("_confirming")) return "Waiting for confirmation";
  return "Awaiting your confirmation";
}

export function recoveryCopy(intent: CommerceIntent) {
  return intent.state === "expired"
    ? "This request has expired. Review its transaction record before starting another request. Expiry does not revoke token approvals or prove a refund."
    : "Review the latest transaction and delivery record before retrying. A failed step does not undo earlier confirmed transactions.";
}

export function canSignRequest(intent: CommerceIntent, chainId: BnbChain, now = Date.now()) {
  const expiry = Date.parse(intent.jobId ? intent.jobExpiresAt : intent.quoteExpiresAt);
  return chainId === 97 && intent.chainId === chainId && intent.transaction?.chainId === chainId
    && !["expired", "reverted", "needs_attention", "funded"].includes(intent.state)
    && !intent.state.endsWith("_confirming") && Number.isFinite(expiry) && expiry > now;
}

export function validateReportInput(positionId: string, width: string, deviation: string) {
  if (!/^[0-9]+$/.test(positionId) || BigInt(positionId) <= 0n) return "Enter the position ID shown in PancakeSwap.";
  if (!Number.isInteger(Number(width)) || Number(width) < 1 || Number(width) > 1000) return "Range size must be a whole number from 1 to 1,000.";
  if (!deviation.trim() || !Number.isInteger(Number(deviation)) || Number(deviation) < 0 || Number(deviation) > 10000) return "Price deviation must be a whole number from 0 to 10,000.";
  return null;
}
