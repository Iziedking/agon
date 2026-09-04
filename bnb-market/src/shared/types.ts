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
