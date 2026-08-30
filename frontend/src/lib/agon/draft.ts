import { categoryById } from "./catalog.ts";
import { keccak256, stringToHex } from "viem";

export const AGON_SERVICE_PROTOCOL = "agon-service/2" as const;
export const AGON_SERVICE_CHAIN_ID = 5042002 as const;
export const AGON_SERVICE_NETWORK = "eip155:5042002" as const;
export const AGON_SERVICE_USDC = "0x3600000000000000000000000000000000000000" as const;

export type ServiceDraft = {
  agentId: string;
  version?: number;
  name: string;
  description: string;
  logoUrl?: string;
  categoryId: string;
  serviceKey: string;
  endpoint: string;
  tags: string;
  amountUSDC: string;
};

export type DraftIssue = {
  field: keyof ServiceDraft;
  message: string;
};

export type AgonServiceManifestV2 = {
  protocol: typeof AGON_SERVICE_PROTOCOL;
  identity: { chainId: typeof AGON_SERVICE_CHAIN_ID; agentId: string; serviceKey: `0x${string}` };
  service: {
    name: string;
    description: string;
    category: string;
    tags: string[];
    logoUrl?: string;
    version: string;
    capabilities: string[];
  };
  invocation: {
    endpoint: string;
    method: "POST";
    requestSchema: { type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties: boolean };
    responseSchema: { type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties: boolean };
    timeoutMs: number;
    maxResponseBytes: number;
    idempotency: "required" | "supported" | "none";
    sideEffects: "none" | "review_required";
    privacy: { retention: "none" | "declared"; sendsToThirdParties: boolean; description: string };
  };

  pricing: { rail: "x402" | "escrow"; amountUSDC: string; network: typeof AGON_SERVICE_NETWORK; asset: typeof AGON_SERVICE_USDC };
  certification: { adapter: "agon-http"; adapterVersion: "1" };
};

export function parseTags(value: string): string[] {
  return [...new Set(value.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
}

function isPublicHttps(value: string): boolean {
  try {
    const endpoint = new URL(value);
    if (endpoint.protocol !== "https:") return false;
    const hostname = endpoint.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (hostname === "localhost" || hostname.endsWith(".local") || hostname === "::1") return false;
    if (/^(fc|fd|fe8|fe9|fea|feb)/.test(hostname)) return false;
    const octets = hostname.split(".").map(Number);
    if (octets.length === 4 && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)) {
      const [first = 0, second = 0] = octets;
      if (first === 0 || first === 10 || first === 127 || first >= 224) return false;
      if (first === 169 && second === 254) return false;
      if (first === 172 && second >= 16 && second <= 31) return false;
      if (first === 192 && second === 168) return false;
      if (first === 100 && second >= 64 && second <= 127) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function validateServiceDraft(draft: ServiceDraft): DraftIssue[] {
  const issues: DraftIssue[] = [];
  if (!/^[1-9]\d*$/.test(draft.agentId.trim())) {
    issues.push({ field: "agentId", message: "Enter the ERC-8004 agent you own." });
  }
  if (!draft.name.trim()) issues.push({ field: "name", message: "Give the service a clear name." });
  if (!draft.description.trim()) issues.push({ field: "description", message: "Explain the result a buyer receives." });
  if (draft.logoUrl?.trim() && !isPublicHttps(draft.logoUrl.trim())) {
    issues.push({ field: "logoUrl", message: "Logo URL must be a public HTTPS image URL." });
  }
  if (categoryById(draft.categoryId).slug === "other") {
    issues.push({ field: "categoryId", message: "Choose one of the marketplace categories." });
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.serviceKey.trim())) {
    issues.push({ field: "serviceKey", message: "Use lowercase words separated by hyphens." });
  }
  if (!isPublicHttps(draft.endpoint.trim())) {
    issues.push({ field: "endpoint", message: "Service endpoint must be a public HTTPS URL." });
  }
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(draft.amountUSDC.trim())) {
    issues.push({ field: "amountUSDC", message: "Enter a USDC amount with up to 6 decimal places." });
  }
  if (parseTags(draft.tags).length > 8) {
    issues.push({ field: "tags", message: "Use no more than 8 search tags." });
  }
  return issues;
}

export function buildServiceManifest(draft: ServiceDraft) {
  const category = categoryById(draft.categoryId);
  if (category.slug === "other") throw new Error("category is outside the marketplace registry");
  return {
    protocol: AGON_SERVICE_PROTOCOL,
    identity: {
      chainId: AGON_SERVICE_CHAIN_ID,
      agentId: draft.agentId.trim(),
      serviceKey: keccak256(stringToHex(draft.serviceKey.trim())),
    },
    service: {
      name: draft.name.trim(),
      version: String(draft.version ?? 1),
      description: draft.description.trim(),
      ...(draft.logoUrl?.trim() ? { logoUrl: draft.logoUrl.trim() } : {}),
      category: category.slug,
      tags: parseTags(draft.tags),
      capabilities: [category.slug, ...parseTags(draft.tags)].filter((tag, index, values) => values.indexOf(tag) === index),
    },
    invocation: {
      endpoint: draft.endpoint.trim(),
      method: "POST" as const,
      requestSchema: { type: "object" as const, properties: {}, required: [], additionalProperties: true },
      responseSchema: { type: "object" as const, properties: {}, required: [], additionalProperties: true },
      timeoutMs: 15_000,
      maxResponseBytes: 65_536,
      idempotency: "supported" as const,
      sideEffects: "none" as const,
      privacy: {
        retention: "none" as const,
        sendsToThirdParties: false,
        description: "The provider does not retain request or response data beyond delivery.",
      },
    },
    pricing: { rail: "x402" as const, amountUSDC: draft.amountUSDC.trim(), network: AGON_SERVICE_NETWORK, asset: AGON_SERVICE_USDC },
    certification: { adapter: "agon-http" as const, adapterVersion: "1" as const },
  };
}

export function validateServiceManifestV2(input: unknown): DraftIssue[] {
  const manifest = input as Partial<AgonServiceManifestV2> | null;
  const issues: DraftIssue[] = [];
  if (!manifest || manifest.protocol !== AGON_SERVICE_PROTOCOL) issues.push({ field: "name", message: "Manifest protocol must be agon-service/2." });
  if (!manifest?.identity || manifest.identity.chainId !== AGON_SERVICE_CHAIN_ID || !/^[1-9]\d*$/.test(manifest.identity.agentId ?? "") || !/^0x[0-9a-fA-F]{64}$/.test(manifest.identity.serviceKey ?? "")) {
    issues.push({ field: "agentId", message: "Manifest identity must pin the Arc Testnet agent and service key." });
  }
  const service = manifest?.service;
  const invocation = manifest?.invocation;
  if (!service || !service.name?.trim() || service.name.trim().length > 80) issues.push({ field: "name", message: "Manifest service name must be 1-80 characters." });
  if (!service || !service.description?.trim() || service.description.trim().length > 500) issues.push({ field: "description", message: "Manifest service description must be 1-500 characters." });
  if (!service || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(service.category ?? "")) issues.push({ field: "categoryId", message: "Manifest service category must be a lowercase slug." });
  if (!Array.isArray(service?.tags) || service.tags.length > 16 || service.tags.some((tag) => typeof tag !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag)) || new Set(service.tags).size !== service.tags.length) issues.push({ field: "tags", message: "Manifest service tags must be unique lowercase slugs." });
  if (!service || !Array.isArray(service.capabilities) || service.capabilities.some((capability) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(capability))) issues.push({ field: "tags", message: "Manifest capabilities must be lowercase slugs." });
  if (service?.logoUrl && !isPublicHttps(service.logoUrl)) issues.push({ field: "logoUrl", message: "Manifest logo URL must be a public HTTPS image URL." });
  if (!service?.version?.trim()) issues.push({ field: "name", message: "Manifest service version is required." });
  if (!invocation?.endpoint || !isPublicHttps(invocation.endpoint)) issues.push({ field: "endpoint", message: "Manifest endpoint must be a public HTTPS URL." });
  const schemas = [invocation?.requestSchema, invocation?.responseSchema];
  if (schemas.some((schema) => !schema || schema.type !== "object")) issues.push({ field: "description", message: "Manifest request and response schemas must be object schemas." });
  if (schemas.some((schema) => /(?:\"\$(?:ref|dynamicRef)\"|\"patternProperties\"|\"remote\"\s*:)/i.test(JSON.stringify(schema)))) issues.push({ field: "description", message: "Manifest schemas cannot reference remote or executable definitions." });
  if (invocation?.method !== "POST") issues.push({ field: "endpoint", message: "Manifest invocation method must be POST." });
  if (!Number.isSafeInteger(invocation?.timeoutMs) || (invocation?.timeoutMs ?? 0) < 100 || (invocation?.timeoutMs ?? 120001) > 120000) issues.push({ field: "endpoint", message: "Manifest timeout must be between 100 and 120000 milliseconds." });
  if (!Number.isSafeInteger(invocation?.maxResponseBytes) || (invocation?.maxResponseBytes ?? 0) < 1024 || (invocation?.maxResponseBytes ?? 1_048_577) > 1_048_576) issues.push({ field: "endpoint", message: "Manifest response limit is invalid." });
  if (!["required", "supported", "none"].includes(invocation?.idempotency ?? "")) issues.push({ field: "endpoint", message: "Manifest idempotency policy is required." });
  if (!["none", "review_required"].includes(invocation?.sideEffects ?? "")) issues.push({ field: "endpoint", message: "Manifest side effects must be explicitly declared." });
  if (!invocation?.privacy || !["none", "declared"].includes(invocation.privacy.retention) || typeof invocation.privacy.sendsToThirdParties !== "boolean" || !invocation.privacy.description?.trim()) issues.push({ field: "description", message: "Manifest privacy handling must be explicitly declared." });
  const pricing = manifest?.pricing;
  if (!pricing || (pricing.rail !== "x402" && pricing.rail !== "escrow") || pricing.network !== AGON_SERVICE_NETWORK || pricing.asset !== AGON_SERVICE_USDC) issues.push({ field: "amountUSDC", message: "Manifest pricing must pin Arc Testnet USDC." });
  if (!manifest?.certification || manifest.certification.adapter !== "agon-http" || manifest.certification.adapterVersion !== "1") issues.push({ field: "description", message: "Manifest certification adapter is unsupported." });
  return issues;
}
