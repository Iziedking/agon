import { serviceSearchInput, serviceReference, type ServiceReference } from "./contract.ts";

export type MarketSource = {
  id: string;
  name: string;
  search(input: { query?: string; category?: string; limit: number }): Promise<unknown[]>;
};

export type AggregatedService = ServiceReference & {
  source: { id: string; name: string };
  sourceReference: string;
};

function score(service: ServiceReference, query?: string): number {
  if (!query) return service.verification === "verified" ? 3 : service.availability === "ready" ? 2 : 1;
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const corpus = `${service.name} ${service.outcome} ${service.category} ${service.accepts.join(" ")}`.toLowerCase();
  return terms.reduce((total, term) => total + (corpus.includes(term) ? 2 : 0), 0) + (service.verification === "verified" ? 1 : 0);
}

export function createMarketAggregator(sources: MarketSource[]) {
  return {
    async search(input: unknown): Promise<{ services: AggregatedService[]; sources: Array<{ id: string; name: string; status: "ok" | "unavailable"; message?: string }> }> {
      const parsed = serviceSearchInput.safeParse(input);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid marketplace search");
      const results = await Promise.all(sources.map(async (source) => {
        try {
          const values = await source.search({ query: parsed.data.query, category: parsed.data.category, limit: parsed.data.limit });
          const services: AggregatedService[] = [];
          for (const value of values) {
            const parsedService = serviceReference.safeParse(value);
            if (!parsedService.success) continue;
            if (parsed.data.verifiedOnly && parsedService.data.verification !== "verified") continue;
            if (parsed.data.maxPriceUSDC && Number(parsedService.data.priceUSDC) > Number(parsed.data.maxPriceUSDC)) continue;
            if (parsed.data.maxLatencyMs && parsedService.data.expectedLatencyMs > parsed.data.maxLatencyMs) continue;
            services.push({ ...parsedService.data, source: { id: source.id, name: source.name }, sourceReference: parsedService.data.reference });
          }
          return { source: { id: source.id, name: source.name, status: "ok" as const }, services };
        } catch (error) {
          return { source: { id: source.id, name: source.name, status: "unavailable" as const, message: error instanceof Error ? error.message : "source unavailable" }, services: [] };
        }
      }));
      const deduped = new Map<string, AggregatedService>();
      for (const result of results) for (const service of result.services) {
        const key = `${service.name.toLowerCase()}|${service.category}|${service.source.id}`;
        const previous = deduped.get(key);
        if (!previous || score(service, parsed.data.query) > score(previous, parsed.data.query)) deduped.set(key, service);
      }
      const services = [...deduped.values()].sort((a, b) => score(b, parsed.data.query) - score(a, parsed.data.query)).slice(0, parsed.data.limit);
      return { services, sources: results.map((result) => result.source) };
    },
  };
}
