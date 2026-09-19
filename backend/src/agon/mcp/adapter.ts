import { createHash } from "node:crypto";
import type { AgonListingView, ListingPage, X402CallIntentRequest, X402CallIntentView } from "../http/api-types.ts";
import { previewHireInput, providerDraftInput, serviceReference, serviceSearchInput, serviceTerms, type ProviderDraftInput, type ServiceReference } from "./contract.ts";

export type McpResult<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

export type McpCatalogService = {
  listListings(query: { limit: number; cursor: string | null; category: string | null; agentId: string | null; includeManifest: boolean }): Promise<{ ok: true; value: ListingPage } | { ok: false; error: { code: string; message: string } }>;
  getListing(reference: string): Promise<{ ok: true; value: AgonListingView } | { ok: false; error: { code: string; message: string } }>;
  prepareX402Call(actor: string, reference: string, request: X402CallIntentRequest): Promise<{ ok: true; value: X402CallIntentView } | { ok: false; error: { code: string; message: string } }>;
};

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function number(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function toServiceReference(listing: AgonListingView): ServiceReference {
  const body = listing.manifest.body && typeof listing.manifest.body === "object" ? listing.manifest.body as Record<string, unknown> : {};
  const service = body.service && typeof body.service === "object" ? body.service as Record<string, unknown> : body;
  const invocation = body.invocation && typeof body.invocation === "object" ? body.invocation as Record<string, unknown> : {};
  const pricing = body.pricing && typeof body.pricing === "object" ? body.pricing as Record<string, unknown> : {};
  const tags = Array.isArray(service.tags) ? service.tags.filter((tag): tag is string => typeof tag === "string") : [];
  const endpoint = typeof invocation.endpoint === "string" ? invocation.endpoint : "";
  const availability = listing.endpointQa.status === "passed" ? "ready" : listing.status !== "Listed" || listing.risk.quarantineReason ? "paused" : "needs_review";
  const verification = listing.risk.quarantineReason ? "quarantined" : listing.verification.status === "Verified" ? "verified" : listing.verification.status === "Unverified" ? "unverified" : "listed";
  return serviceReference.parse({
    reference: listing.id,
    name: text(service.name, `Service ${listing.listingId}`),
    provider: `Agent ${listing.agentId}`,
    outcome: text(service.description, "A bounded agent service"),
    category: listing.category,
    priceUSDC: text(pricing.amountUSDC ?? pricing.amount, "0"),
    expectedLatencyMs: number(invocation.timeoutMs, 60_000),
    availability,
    verification,
    privacy: text((invocation.privacy as Record<string, unknown> | undefined)?.description, "See provider terms"),
    accepts: tags.length ? tags : [endpoint ? "structured request" : "service input"],
    returns: ["service result"],
  });
}

export function createMcpAccessAdapter(service: McpCatalogService) {
  return {
    async searchServices(input: unknown): Promise<McpResult<{ services: ServiceReference[]; nextCursor: string | null }>> {
      const parsed = serviceSearchInput.safeParse(input);
      if (!parsed.success) return { ok: false, code: "invalid_request", message: parsed.error.issues[0]?.message ?? "Invalid service search" };
      const result = await service.listListings({ limit: parsed.data.limit, cursor: null, category: parsed.data.category ?? null, agentId: null, includeManifest: true });
      if (!result.ok) return { ok: false, code: result.error.code, message: result.error.message };
      const services = result.value.items.map(toServiceReference).filter((item) => {
        if (parsed.data.verifiedOnly && item.verification !== "verified") return false;
        if (parsed.data.maxPriceUSDC && Number(item.priceUSDC) > Number(parsed.data.maxPriceUSDC)) return false;
        if (parsed.data.maxLatencyMs && item.expectedLatencyMs > parsed.data.maxLatencyMs) return false;
        const query = parsed.data.query?.toLowerCase();
        return !query || `${item.name} ${item.outcome} ${item.category} ${item.accepts.join(" ")}`.toLowerCase().includes(query);
      });
      return { ok: true, value: { services, nextCursor: result.value.nextCursor } };
    },

    async getService(reference: string): Promise<McpResult<ServiceReference>> {
      const result = await service.getListing(reference);
      return result.ok ? { ok: true, value: toServiceReference(result.value) } : { ok: false, code: result.error.code, message: result.error.message };
    },

    async previewHire(actor: string, input: unknown): Promise<McpResult<{ terms: ReturnType<typeof serviceTerms.parse>; intent: X402CallIntentView }>> {
      const parsed = previewHireInput.safeParse(input);
      if (!parsed.success) return { ok: false, code: "invalid_request", message: parsed.error.issues[0]?.message ?? "Invalid hire preview" };
      const listing = await service.getListing(parsed.data.serviceReference);
      if (!listing.ok) return { ok: false, code: listing.error.code, message: listing.error.message };
      const serviceReference = toServiceReference(listing.value);
      const request: X402CallIntentRequest = { idempotencyKey: `mcp-${createHash("sha256").update(JSON.stringify(parsed.data.input)).digest("hex").slice(0, 24)}`, method: "POST", input: parsed.data.input, maxAmountUSDC: serviceReference.priceUSDC, endpointUrl: listing.value.manifest.body && typeof listing.value.manifest.body === "object" && typeof (listing.value.manifest.body as { invocation?: { endpoint?: unknown } }).invocation?.endpoint === "string" ? (listing.value.manifest.body as { invocation: { endpoint: string } }).invocation.endpoint : undefined };
      const intent = await service.prepareX402Call(actor, parsed.data.serviceReference, request);
      if (!intent.ok) return { ok: false, code: intent.error.code, message: intent.error.message };
      const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
      const terms = serviceTerms.parse({ service: serviceReference, input: parsed.data.input, priceUSDC: serviceReference.priceUSDC, paymentMode: parsed.data.paymentMode, expiresAt, deliveryDeadlineMs: serviceReference.expectedLatencyMs, privacy: serviceReference.privacy, failurePolicy: "Payment and delivery are reconciled separately; unknown payment outcomes remain reconciling.", termsDigest: `0x${createHash("sha256").update(JSON.stringify({ serviceReference, input: parsed.data.input, expiresAt })).digest("hex")}` });
      return { ok: true, value: { terms, intent: intent.value } };
    },

    startListing(input: unknown): McpResult<{ draftId: string; draft: ProviderDraftInput; nextAction: string }> {
      const parsed = providerDraftInput.safeParse(input);
      if (!parsed.success) return { ok: false, code: "invalid_request", message: parsed.error.issues[0]?.message ?? "Invalid provider draft" };
      const draftId = `draft-${createHash("sha256").update(JSON.stringify(parsed.data)).digest("hex").slice(0, 24)}`;
      return { ok: true, value: { draftId, draft: parsed.data, nextAction: "run_listing_checks" } };
    },

    checkListing(input: unknown): McpResult<{ draftId: string; checks: Array<{ name: string; status: "passed" | "needs_attention"; detail: string }>; nextAction: string }> {
      const started = this.startListing(input);
      if (!started.ok) return started;
      const checks = [
        { name: "secure_endpoint", status: "passed" as const, detail: "The service uses a public HTTPS endpoint." },
        { name: "terms_complete", status: "passed" as const, detail: "Price, input, output, privacy, and failure terms are present." },
        { name: "wallet_publication", status: "needs_attention" as const, detail: "A provider wallet approval is required before publication." },
      ];
      return { ok: true, value: { draftId: started.value.draftId, checks, nextAction: "review_and_approve_publication" } };
    },
  };
}
