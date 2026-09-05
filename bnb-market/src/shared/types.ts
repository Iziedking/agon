/** Shared by both AGON and its standalone BNB application. No chain SDK in UI. */
export type BnbChain = 56 | 97;
export const CATEGORIES = [
  { id: "rebalancing", label: "LP rebalancing" },
  { id: "grid-trading", label: "Grid trading" },
  { id: "yield-optimisation", label: "Yield optimisation" },
  { id: "health-factor", label: "Health monitoring" },
] as const;
export type Category = typeof CATEGORIES[number]["id"];
export function isCategory(value: unknown): value is Category {
  return CATEGORIES.some((category) => category.id === value);
}
export function parseChain(value: unknown): BnbChain {
  if (value === 56 || value === "56") return 56;
  if (value === 97 || value === "97") return 97;
  throw new Error("Select BNB Mainnet or BNB Testnet.");
}
export function parseAgentId(value: unknown): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(value) || BigInt(value) >= 2n ** 256n) {
    throw new Error("Enter a valid agent ID.");
  }
  return value;
}
export type BnbSession = { address: string; chainId: BnbChain; expiresAt: string };
export type AgentSummary = {
  id: string;
  chainId: BnbChain;
  name: string;
  description: string;
  owner: string;
  registry: string;
  category: Category | null;
  categorySource: "provider" | "unclassified";
  indexedAt: string | null;
  source: "8004scan" | "agon";
};
export type AgentDetail = AgentSummary & {
  wallet: string;
  blockNumber: string;
  checkedAt: string;
  ownerMatchesIndex: boolean;
  uri: string;
  versionHash: string | null;
  metadataStatus: "available" | "unavailable";
  active: boolean | null;
  services: { name: string; endpoint: string; version: string | null }[];
  registrationMatches: boolean | null;
};
export type CatalogPage = { items: AgentSummary[]; total: number; nextOffset: number | null; checkedAt: string; source: "8004scan"; warnings: string[] };
export type EndpointProof = { chainId: BnbChain; agentId: string; versionHash: string; checkedAt: string; status: "reachable" | "unavailable"; protocol: string; endpoint: string; message: string };
export type CommerceReadiness = {
  chainId: BnbChain; agentId: string; versionHash: string | null; checkedAt: string; blockNumber: string;
  status: "blocked"; paymentsEnabled: false; blockers: string[];
  contracts: { commerce: string; router: string; policy: string };
  providerPolicy: string | null; providerPolicyWhitelisted: boolean | null;
  token: { address: string; decimals: number; symbol: string };
  disputeWindowSeconds: string; advertisedPriceRaw: string | null; advertisedPriceDisplay: string | null;
};

export type CommerceIntentState =
  | "quoting"
  | "quote_verified"
  | "create_prepared"
  | "create_confirming"
  | "open"
  | "register_prepared"
  | "register_confirming"
  | "registered"
  | "approve_prepared"
  | "approve_confirming"
  | "approved"
  | "fund_prepared"
  | "fund_confirming"
  | "funded"
  | "expired"
  | "reverted"
  | "needs_attention";

export type CommerceStep = "create" | "register" | "approve" | "fund";

export type PreparedCommerceTransaction = {
  step: CommerceStep;
  chainId: 97;
  to: `0x${string}`;
  data: `0x${string}`;
  value: "0";
  title: string;
  warning: string;
};

export type CommerceIntent = {
  id: string;
  chainId: 97;
  buyerAddress: `0x${string}`;
  agentId: string;
  providerAddress: `0x${string}`;
  serviceVersion: string;
  registrationHash: string;
  state: CommerceIntentState;
  amountRaw: string;
  amountDisplay: string;
  token: { address: `0x${string}`; decimals: number; symbol: string };
  quoteHash: `0x${string}`;
  quoteExpiresAt: string;
  jobExpiresAt: string;
  jobId: string | null;
  transaction: PreparedCommerceTransaction | null;
  transactionHash: `0x${string}` | null;
  confirmations: number;
  message: string;
  updatedAt: string;
};

export type LpHiringReadiness = {
  chainId: number;
  status: "available" | "configuration_required" | "blocked";
  enabled: boolean;
  blockers: string[];
  agentId: string | null;
  providerAddress: `0x${string}` | null;
  token: { address: `0x${string}`; decimals: number; symbol: string } | null;
  priceRaw: string | null;
  priceDisplay: string | null;
  checkedAt: string;
};
