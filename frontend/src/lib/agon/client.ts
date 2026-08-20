import type {
  AgonHealth,
  AgonListing,
  AgonListingPage,
  ApiErrorBody,
  BindProfileRequest,
  ListListingsQuery,
  PublishListingRequest,
  SubmittedOperation,
  X402CallIntentRequest,
  X402CallIntentView,
} from "./types";
import { AGON_PREVIEW_HEALTH, AGON_PREVIEW_LISTINGS } from "./preview";

export const AGON_PREVIEW_MODE = process.env.NEXT_PUBLIC_AGON_PREVIEW_FIXTURES === "1";

const AGON_API_URL = (
  process.env.NEXT_PUBLIC_AGON_API_URL ??
  process.env.NEXT_PUBLIC_AUTH_URL ??
  "http://localhost:8082"
).replace(/\/$/, "");

export class AgonApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "AgonApiError";
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${AGON_API_URL}/agon${path}`, {
      ...init,
      credentials: "include",
      headers: init?.body
        ? { "content-type": "application/json", ...init.headers }
        : init?.headers,
    });
  } catch {
    throw new AgonApiError("network_unavailable", "Could not reach the Agon indexer.", 0);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new AgonApiError(
      body.error?.code ?? "request_failed",
      body.error?.message ?? "Agon request failed.",
      response.status,
    );
  }
  return (await response.json()) as T;
}

export function listListings(query: ListListingsQuery = {}): Promise<AgonListingPage> {
  if (AGON_PREVIEW_MODE) {
    const items = AGON_PREVIEW_LISTINGS
      .filter((listing) => !query.category || listing.category === query.category)
      .filter((listing) => !query.agentId || listing.agentId === query.agentId)
      .slice(0, query.limit ?? AGON_PREVIEW_LISTINGS.length);
    return Promise.resolve({ items, nextCursor: null });
  }
  const params = new URLSearchParams();
  if (query.limit) params.set("limit", String(query.limit));
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.category) params.set("category", query.category);
  if (query.agentId) params.set("agentId", query.agentId);
  const suffix = params.size ? `?${params.toString()}` : "";
  return request<AgonListingPage>(`/listings${suffix}`);
}

export function getListing(reference: string): Promise<AgonListing> {
  if (AGON_PREVIEW_MODE) {
    const listing = AGON_PREVIEW_LISTINGS.find((item) => item.id === reference || item.listingId === reference);
    return listing
      ? Promise.resolve(listing)
      : Promise.reject(new AgonApiError("listing_not_found", "This preview listing does not exist.", 404));
  }
  return request<AgonListing>(`/listings/${encodeURIComponent(reference)}`);
}

export function getAgonHealth(): Promise<AgonHealth> {
  if (AGON_PREVIEW_MODE) return Promise.resolve(AGON_PREVIEW_HEALTH);
  return request<AgonHealth>("/health");
}

export function bindProfile(payload: BindProfileRequest): Promise<SubmittedOperation> {
  return request<SubmittedOperation>("/profiles/bind", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function publishListing(payload: PublishListingRequest): Promise<SubmittedOperation> {
  return request<SubmittedOperation>("/listings", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function confirmAgonOperation(
  operationId: string,
  txHash: `0x${string}`,
): Promise<SubmittedOperation> {
  return request<SubmittedOperation>(`/operations/${encodeURIComponent(operationId)}/confirm`, {
    method: "POST",
    body: JSON.stringify({ txHash }),
  });
}

export function prepareX402CallIntent(
  reference: string,
  payload: X402CallIntentRequest,
): Promise<X402CallIntentView> {
  return request<X402CallIntentView>(`/listings/${encodeURIComponent(reference)}/call-intents`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
