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
  amountUSDC: string | null;
  hasIndexedManifest: boolean;
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
  const pricing = record(body?.pricing);
  const execution = record(body?.execution);
  const tags = Array.isArray(body?.tags)
    ? [...new Set(body.tags.filter((tag): tag is string => typeof tag === "string" && Boolean(tag.trim())).map((tag) => tag.trim()))]
    : [];

  return {
    name: text(body?.name) ?? `${category.label} service`,
    description: text(body?.description) ?? "Service details are loading. Open the service to learn more.",
    logoUrl: text(body?.logoUrl),
    category,
    tags,
    endpoint: text(body?.endpoint) ?? text(execution?.endpoint),
    amountUSDC: text(pricing?.amountUSDC) ?? text(pricing?.amount),
    hasIndexedManifest: body !== null,
  };
}

export function listingMatchesQuery(listing: AgonListing, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const service = presentListing(listing);
  const corpus = [
    service.name,
    service.description,
    service.category.label,
    service.category.slug,
    service.tags.join(" "),
    `agent ${listing.agentId}`,
    `agent #${listing.agentId}`,
    listing.manifest.uri,
  ].join(" ").toLowerCase();
  return normalized.split(/\s+/).every((term) => corpus.includes(term));
}

