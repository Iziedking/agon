import { BNB_CHAINS, BNB_MAINNET_ID, BNB_TESTNET_ID, type BnbChainId } from "@/lib/bnb/chains";
import {
  BNB_CATEGORIES,
  BnbCategory,
  BnbService,
  findServiceById,
  listCategoryServices,
  listServices,
} from "@/lib/bnb/catalog";

const categoryLookup = new Set(BNB_CATEGORIES.map((item) => item.id));

type RawSearchParams =
  | { get?: (name: string) => string | null }
  | Record<string, string | string[] | undefined>
  | null;

const DEFAULT_QUERY = "";
const DEFAULT_CHAIN = BNB_MAINNET_ID;
const DEFAULT_CATEGORY = "all";

export type MarketCategoryFilter = BnbCategory | "all";

export interface MarketQueryState {
  chainId: BnbChainId;
  category: MarketCategoryFilter;
  query: string;
  activatableOnly: boolean;
}

function toString(value: string | string[] | null | undefined): string | null {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return toString(value[0] ?? null);
  }
  return value ?? null;
}

function getParam(params: RawSearchParams, key: string): string | null {
  if (params && "get" in params && typeof params.get === "function") {
    return params.get(key);
  }
  if (!params) return null;
  return toString((params as Record<string, string | string[] | undefined>)[key]);
}

export function resolveChain(rawChain: string | null): BnbChainId {
  const candidate = Number(rawChain || DEFAULT_CHAIN);
  if (candidate === BNB_MAINNET_ID || candidate === BNB_TESTNET_ID) {
    return candidate;
  }
  return DEFAULT_CHAIN;
}

export function resolveCategory(rawCategory: string | null): MarketCategoryFilter {
  if (!rawCategory) return DEFAULT_CATEGORY;
  const normalized = rawCategory.toLowerCase().trim();
  return categoryLookup.has(normalized as BnbCategory)
    ? (normalized as MarketCategoryFilter)
    : DEFAULT_CATEGORY;
}

export function normalizeSearchQuery(raw: string | null): string {
  const trimmed = (raw || "").trim();
  return trimmed.slice(0, 120);
}

export function readMarketQuery(params: RawSearchParams): MarketQueryState {
  const chainId = resolveChain(getParam(params, "chain"));
  const category = resolveCategory(getParam(params, "category"));
  const query = normalizeSearchQuery(getParam(params, "q"));
  const rawActivatable = getParam(params, "activatableOnly");
  const activatableOnly = rawActivatable === "1" || rawActivatable === "true";
  return {
    chainId,
    category,
    query,
    activatableOnly,
  };
}

export function buildMarketSearch({
  chainId,
  category,
  query,
  activatableOnly,
}: MarketQueryState): URLSearchParams {
  const queryParams = new URLSearchParams();
  queryParams.set("chain", String(chainId));
  if (category !== "all") {
    queryParams.set("category", category);
  }
  if (query) {
    queryParams.set("q", query);
  }
  if (activatableOnly) {
    queryParams.set("activatableOnly", "1");
  }
  return queryParams;
}

export function getActiveServicesFromCatalog(chainId: BnbChainId): BnbService[] {
  return listServices(chainId).filter((service) => service.active);
}

export function listCategoriesForChain(chainId: BnbChainId) {
  const services = listServices(chainId);
  return BNB_CATEGORIES.map((category) => ({
    ...category,
    count: services.filter((service) => service.category === category.id && service.active).length,
    total: services.filter((service) => service.category === category.id).length,
  }));
}

export function listServicesForQuery(state: MarketQueryState): BnbService[] {
  const base = state.category === "all"
    ? listServices(state.chainId)
    : listCategoryServices(state.chainId, state.category);
  const lowerQuery = state.query.toLowerCase();
  const sourceFilter = (service: BnbService) => {
    if (!state.activatableOnly) return true;
    return service.active;
  };
  return base
    .filter(sourceFilter)
    .filter((service) => {
      if (!lowerQuery) return true;
      return (
        service.name.toLowerCase().includes(lowerQuery) ||
        service.provider.toLowerCase().includes(lowerQuery) ||
        service.shortGoal.toLowerCase().includes(lowerQuery) ||
        service.tags.some((tag) => tag.toLowerCase().includes(lowerQuery))
      );
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
}

export function serviceById(serviceId: string, chainId: BnbChainId): BnbService | null {
  return findServiceById(serviceId, chainId) || null;
}

export function networkLabel(chainId: BnbChainId): string {
  const chain = BNB_CHAINS.find((item) => item.id === chainId);
  return chain?.label ?? "BNB";
}
