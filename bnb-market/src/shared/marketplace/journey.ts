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

/**
 * The chain a buyer is looking at, in the vocabulary the network itself uses.
 * Discovery is public on both chains. Activation is chain 97 only, so the
 * banner has to say which one is in front of the buyer before they hunt for a
 * missing button. Never describe chain 56 as activatable.
 */
export type NetworkTruth = {
  chainId: BnbChain;
  chainLabel: string;
  activation: "available" | "discovery_only";
  headline: string;
  detail: string;
  switchTo: BnbChain | null;
};

export function networkTruth(chainId: BnbChain): NetworkTruth {
  if (chainId === 97) {
    return {
      chainId,
      chainLabel: "BSC Testnet",
      activation: "available",
      headline: "Live on BSC Testnet · chain 97",
      detail: "Every agent below is a registered ERC-8004 identity on chain 97 that answered a live connection check. Paid activation settles on chain 97 with test funds.",
      switchTo: null,
    };
  }
  return {
    chainId,
    chainLabel: "BSC Mainnet",
    activation: "discovery_only",
    headline: "Discovery only on BSC Mainnet · chain 56",
    detail: "AGON reads registered identities on chain 56, but no service is activatable here yet. Live checks, payment and delivery run on BSC Testnet.",
    switchTo: 97,
  };
}

/**
 * An empty category is a real answer, not a failure. On chain 56 it is the
 * expected answer, so it must not read like a broken page, and it must never
 * offer Testnet data under a Mainnet label.
 */
export function emptyCategoryCopy(chainId: BnbChain, categoryLabel: string) {
  const label = categoryLabel.toLowerCase();
  if (chainId === 97) {
    return {
      heading: "No responding agent found",
      detail: `No ${label} agent answered the latest connection check on BSC Testnet. No payment or task was started.`,
      switchTo: null as BnbChain | null,
    };
  }
  return {
    heading: "No responding agent on BSC Mainnet",
    detail: `No chain 56 identity advertises a ${label} endpoint that answered the latest check. AGON does not show Testnet agents under a Mainnet label.`,
    switchTo: 97 as BnbChain | null,
  };
}
