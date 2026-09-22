import type { AgonListing } from "./types.ts";

export const AGON_CATEGORY_REGISTRY_VERSION = "1";

export const AGON_CATEGORIES = [
  { id: "1", slug: "research", label: "Research", description: "Find and synthesize reliable sources." },
  { id: "2", slug: "market-data", label: "Market data", description: "Deliver prices, chain data, and live market feeds." },
  { id: "3", slug: "analysis", label: "Analysis", description: "Evaluate data, risk, performance, or strategy." },
  { id: "4", slug: "prediction", label: "Prediction", description: "Forecast events, markets, and measurable outcomes." },
  { id: "5", slug: "execution", label: "Execution", description: "Perform transactions and operational tasks." },
  { id: "6", slug: "content", label: "Content", description: "Draft, edit, translate, or transform content." },
  { id: "7", slug: "development", label: "Development", description: "Build, debug, test, and maintain software." },
  { id: "8", slug: "verification", label: "Verification", description: "Review claims, code, identity, or evidence." },
  { id: "9", slug: "general", label: "General", description: "Handle services that do not fit another category." },
] as const;

export type AgonCategory = (typeof AGON_CATEGORIES)[number];
export type PresentedCategory = AgonCategory | {
  id: string;
  slug: "other";
  label: "Other service";
  description: "This provider used a category outside the current marketplace registry.";
};

export type ListingPresentation = {
  name: string;
  description: string;
  logoUrl: string | null;
  category: PresentedCategory;
  tags: string[];
  endpoint: string | null;
  timeoutMs: number | null;
  amountUSDC: string | null;
  hasIndexedManifest: boolean;
};

export type ListingSearchMatch = {
  matches: boolean;
  matchedTerms: string[];
};

const INTENT_ALIASES: Record<string, readonly string[]> = {
  nft: ["nft", "nfts", "non-fungible", "nonfungible", "collectible", "collectibles", "mint", "minting"],
  nfts: ["nft", "nfts", "non-fungible", "nonfungible", "collectible", "collectibles", "mint", "minting"],
  mint: ["nft", "nfts", "non-fungible", "nonfungible", "collectible", "collectibles", "mint", "minting"],
  minting: ["nft", "nfts", "non-fungible", "nonfungible", "collectible", "collectibles", "mint", "minting"],
  contract: ["contract", "contracts", "smart-contract", "smart contract", "solidity", "evm"],
  contracts: ["contract", "contracts", "smart-contract", "smart contract", "solidity", "evm"],
  security: ["security", "audit", "audits", "review", "reviews", "vulnerability", "vulnerabilities"],
  audit: ["security", "audit", "audits", "review", "reviews", "vulnerability", "vulnerabilities"],
  research: ["research", "analysis", "analyze", "analyse", "analytics", "insight", "insights"],
  analysis: ["research", "analysis", "analyze", "analyse", "analytics", "insight", "insights"],
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function categoryById(id: string): PresentedCategory {
  return AGON_CATEGORIES.find((category) => category.id === id) ?? {
    id,
    slug: "other",
    label: "Other service",
    description: "This provider used a category outside the current marketplace registry.",
  };
}

export function categoryBySlug(slug: string): AgonCategory | null {
  return AGON_CATEGORIES.find((category) => category.slug === slug) ?? null;
}

export function presentListing(listing: AgonListing): ListingPresentation {
  const category = categoryById(listing.category);
  const body = record(listing.manifest.body);
  const service = record(body?.service) ?? body;
  const invocation = record(body?.invocation);
  const pricing = record(body?.pricing);
  const execution = record(body?.execution);
  const timeoutValue = invocation?.timeoutMs;
  const tagsValue = service?.tags;
  const tags = Array.isArray(tagsValue)
    ? [...new Set(tagsValue.filter((tag): tag is string => typeof tag === "string" && Boolean(tag.trim())).map((tag) => tag.trim()))]
    : [];

  return {
    // A category describes what a service does; it is not the service's name.
    // Keep loading and integrity-failure states identifiable without presenting
    // every provider as the same category-named service.
    name: text(service?.name) ?? `Agent #${listing.agentId} service`,
    description: text(service?.description) ?? "Service details are loading. Open the service to learn more.",
    logoUrl: text(service?.logoUrl),
    category,
    tags,
    endpoint: text(invocation?.endpoint) ?? text(body?.endpoint) ?? text(execution?.endpoint),
    timeoutMs: typeof timeoutValue === "number" && Number.isFinite(timeoutValue) && timeoutValue > 0 ? timeoutValue : null,
    amountUSDC: text(pricing?.amountUSDC) ?? text(pricing?.amount),
    hasIndexedManifest: body !== null,
  };
}

function normalizedSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function searchableTerms(listing: AgonListing): string[] {
  const service = presentListing(listing);
  return [
    service.name,
    service.description,
    service.category.label,
    service.category.slug,
    ...service.tags,
    `agent ${listing.agentId}`,
    `agent #${listing.agentId}`,
    listing.manifest.uri,
  ].map(normalizedSearchText).filter(Boolean);
}

export function listingSearchMatch(listing: AgonListing, query: string): ListingSearchMatch {
  const requestedTerms = normalizedSearchText(query).split(/\s+/).filter(Boolean);
  if (requestedTerms.length === 0) return { matches: true, matchedTerms: [] };

  const corpus = searchableTerms(listing).join(" ");
  const matchedTerms = requestedTerms.map((term) => {
    const candidates = [
      term,
      ...(INTENT_ALIASES[term] ?? []).filter((candidate) => normalizedSearchText(candidate) !== term),
    ];
    const matched = candidates.find((candidate) => corpus.includes(normalizedSearchText(candidate)));
    return matched ?? null;
  });

  return {
    matches: matchedTerms.every(Boolean),
    matchedTerms: [...new Set(matchedTerms.filter((term): term is string => term !== null))],
  };
}

export function listingMatchesQuery(listing: AgonListing, query: string): boolean {
  return listingSearchMatch(listing, query).matches;
}

