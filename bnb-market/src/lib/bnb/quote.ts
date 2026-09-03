import type { BnbChainId } from "./chains";

export interface AgentQuote {
  quoteId: string;
  serviceId: string;
  chainId: BnbChainId;
  serviceVersion: string;
  amount: string;
  currency: "USDC";
  authorityScope: string;
  issuedAt: string;
  expiresAt: string;
}

export type QuoteState = "active" | "expired" | "invalid";

export function getQuoteState(quote: AgentQuote, now = Date.now()): QuoteState {
  const issued = Date.parse(quote.issuedAt);
  const expires = Date.parse(quote.expiresAt);
  if (!quote.quoteId || !quote.serviceId || !quote.serviceVersion || !quote.amount || !quote.authorityScope) return "invalid";
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued) return "invalid";
  return now < expires ? "active" : "expired";
}

export function isQuoteUsable(quote: AgentQuote, chainId: BnbChainId, serviceVersion: string, now = Date.now()): boolean {
  return quote.chainId === chainId && quote.serviceVersion === serviceVersion && getQuoteState(quote, now) === "active";
}

