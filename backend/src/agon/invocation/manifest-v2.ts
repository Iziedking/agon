import { keccak256, stringToHex } from "viem";

export const AGON_SERVICE_PROTOCOL = "agon-service/2" as const;
export const AGON_SERVICE_CHAIN_ID = 5042002 as const;
export const AGON_SERVICE_NETWORK = "eip155:5042002" as const;
export const AGON_SERVICE_USDC = "0x3600000000000000000000000000000000000000" as const;

export type AgonJsonSchema = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
};

export type AgonServiceManifestV2 = {
  protocol: typeof AGON_SERVICE_PROTOCOL;
  identity: {
    chainId: typeof AGON_SERVICE_CHAIN_ID;
    agentId: string;
    serviceKey: `0x${string}`;
  };
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
    requestSchema: AgonJsonSchema;
    responseSchema: AgonJsonSchema;
    timeoutMs: number;
    maxResponseBytes: number;
    idempotency: "required" | "supported" | "none";
    sideEffects: "none" | "review_required";
    privacy: {
      retention: "none" | "declared";
      sendsToThirdParties: boolean;
      description: string;
    };
  };
  pricing: {
    rail: "x402" | "escrow";
    amountUSDC: string;
    network: typeof AGON_SERVICE_NETWORK;
    asset: typeof AGON_SERVICE_USDC;
  };
  certification: {
    adapter: "agon-http";
    adapterVersion: "1";
  };
};

export type ManifestV2Validation =
  | { ok: true; value: AgonServiceManifestV2 }
  | { ok: false; code: string; message: string };

/** Exported for scaffolders and tooling that need the same wire contract without executing the parser. */
export const AGON_SERVICE_MANIFEST_V2_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "AGON service manifest v2",
  type: "object",
  additionalProperties: false,
  required: ["protocol", "identity", "service", "invocation", "pricing", "certification"],
  properties: {
    protocol: { const: AGON_SERVICE_PROTOCOL },
    identity: {
      type: "object",
      additionalProperties: false,
      required: ["chainId", "agentId", "serviceKey"],
      properties: {
        chainId: { const: AGON_SERVICE_CHAIN_ID },
        agentId: { type: "string", pattern: "^[0-9]+$" },
        serviceKey: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" },
      },
    },
    service: {
      type: "object",
      additionalProperties: false,
      required: ["name", "description", "category", "tags", "version", "capabilities"],
      properties: {
        name: { type: "string", minLength: 1, maxLength: 80 },
        description: { type: "string", minLength: 1, maxLength: 500 },
        category: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
        tags: { type: "array", maxItems: 16, uniqueItems: true, items: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" } },
        logoUrl: { type: "string", format: "uri" },
        version: { type: "string", minLength: 1, maxLength: 32 },
        capabilities: { type: "array", maxItems: 32, items: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" } },
      },
    },
    invocation: {
      type: "object",
      additionalProperties: false,
      required: ["endpoint", "method", "requestSchema", "responseSchema", "timeoutMs", "maxResponseBytes", "idempotency", "sideEffects", "privacy"],
      properties: {
        endpoint: { type: "string", format: "uri", pattern: "^https://" },
        method: { const: "POST" },
        requestSchema: { $ref: "#/$defs/objectSchema" },
        responseSchema: { $ref: "#/$defs/objectSchema" },
        timeoutMs: { type: "integer", minimum: 100, maximum: 120000 },
        maxResponseBytes: { type: "integer", minimum: 1024, maximum: 1048576 },
        idempotency: { enum: ["required", "supported", "none"] },
        sideEffects: { enum: ["none", "review_required"] },
        privacy: {
          type: "object",
          additionalProperties: false,
          required: ["retention", "sendsToThirdParties", "description"],
          properties: { retention: { enum: ["none", "declared"] }, sendsToThirdParties: { type: "boolean" }, description: { type: "string", minLength: 1 } },
        },
      },
    },
    pricing: {
      type: "object",
      additionalProperties: false,
      required: ["rail", "amountUSDC", "network", "asset"],
      properties: { rail: { enum: ["x402", "escrow"] }, amountUSDC: { type: "string", pattern: "^(0|[1-9]\\d*)(\\.\\d{1,6})?$" }, network: { const: AGON_SERVICE_NETWORK }, asset: { const: AGON_SERVICE_USDC } },
    },
    certification: {
      type: "object",
      additionalProperties: false,
      required: ["adapter", "adapterVersion"],
      properties: { adapter: { const: "agon-http" }, adapterVersion: { const: "1" } },
    },
  },
  $defs: {
    objectSchema: { type: "object", required: ["type"], properties: { type: { const: "object" } } },
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBytes32(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value) && !/^0x0{64}$/i.test(value);
}

function isSlug(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function safePublicHttps(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return host !== "localhost"
      && !host.endsWith(".localhost")
      && !host.endsWith(".local")
      && !host.endsWith(".internal")
      && host !== "::1"
      && host !== "0.0.0.0"
      && !/^127\./.test(host)
      && !/^10\./.test(host)
      && !/^192\.168\./.test(host)
      && !/^169\.254\./.test(host)
      && !/^172\.(1[6-9]|2\d|3[01])\./.test(host)
      && !/^(fc|fd|fe[89a-f])/.test(host);
  } catch {
    return false;
  }
}

function safeSchema(value: unknown): value is AgonJsonSchema {
  if (!isRecord(value) || value.type !== "object") return false;
  const encoded = JSON.stringify(value);
  return !/(?:"\$(?:ref|dynamicRef)"|"patternProperties"|"remote"\s*:|"(?:eval|script)"\s*:)/i.test(encoded);
}

function boundedPositiveInteger(value: unknown, minimum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum;
}

function normalize(input: Record<string, unknown>): AgonServiceManifestV2 {
  const identity = input.identity as Record<string, unknown>;
  const service = input.service as Record<string, unknown>;
  const invocation = input.invocation as Record<string, unknown>;
  const privacy = invocation.privacy as Record<string, unknown>;
  const pricing = input.pricing as Record<string, unknown>;
  const certification = input.certification as Record<string, unknown>;
  return {
    protocol: AGON_SERVICE_PROTOCOL,
    identity: {
      chainId: AGON_SERVICE_CHAIN_ID,
      agentId: String(identity.agentId).trim(),
      serviceKey: String(identity.serviceKey).toLowerCase() as `0x${string}`,
    },
    service: {
      name: String(service.name).trim(),
      description: String(service.description).trim(),
      category: String(service.category).trim().toLowerCase(),
      tags: (service.tags as unknown[]).map((tag) => String(tag).trim().toLowerCase()),
      ...(service.logoUrl === undefined ? {} : { logoUrl: String(service.logoUrl).trim() }),
      version: String(service.version).trim(),
      capabilities: (service.capabilities as unknown[]).map((capability) => String(capability).trim().toLowerCase()),
    },
    invocation: {
      endpoint: String(invocation.endpoint).trim(),
      method: "POST",
      requestSchema: invocation.requestSchema as AgonJsonSchema,
      responseSchema: invocation.responseSchema as AgonJsonSchema,
      timeoutMs: Number(invocation.timeoutMs),
      maxResponseBytes: Number(invocation.maxResponseBytes),
      idempotency: invocation.idempotency as AgonServiceManifestV2["invocation"]["idempotency"],
      sideEffects: invocation.sideEffects as AgonServiceManifestV2["invocation"]["sideEffects"],
      privacy: {
        retention: privacy.retention as AgonServiceManifestV2["invocation"]["privacy"]["retention"],
        sendsToThirdParties: Boolean(privacy.sendsToThirdParties),
        description: String(privacy.description).trim(),
      },
    },
    pricing: {
      rail: pricing.rail as AgonServiceManifestV2["pricing"]["rail"],
      amountUSDC: String(pricing.amountUSDC).trim(),
      network: AGON_SERVICE_NETWORK,
      asset: AGON_SERVICE_USDC,
    },
    certification: {
      adapter: "agon-http",
      adapterVersion: "1",
    },
  };
}

export function normalizeManifestV2(input: unknown): ManifestV2Validation {
  if (!isRecord(input)) return { ok: false, code: "invalid_shape", message: "manifest must be an object" };
  const identity = input.identity;
  const service = input.service;
  const invocation = input.invocation;
  const pricing = input.pricing;
  const certification = input.certification;
  if (input.protocol !== AGON_SERVICE_PROTOCOL) return { ok: false, code: "unsupported_protocol", message: "manifest protocol must be agon-service/2" };
  if (!isRecord(identity) || identity.chainId !== AGON_SERVICE_CHAIN_ID || !/^\d+$/.test(String(identity.agentId ?? "")) || !isBytes32(identity.serviceKey)) {
    return { ok: false, code: "invalid_identity", message: "identity must pin Arc Testnet, an agent ID, and a service key" };
  }
  if (!isRecord(service) || typeof service.name !== "string" || service.name.trim().length < 1 || service.name.trim().length > 80 || typeof service.description !== "string" || service.description.trim().length < 1 || service.description.trim().length > 500 || !isSlug(service.category) || !Array.isArray(service.tags) || service.tags.length > 16 || service.tags.some((tag) => !isSlug(tag)) || new Set(service.tags).size !== service.tags.length || typeof service.version !== "string" || !service.version.trim() || service.version.trim().length > 32 || !Array.isArray(service.capabilities) || service.capabilities.length > 32 || service.capabilities.some((capability) => !isSlug(capability))) {
    return { ok: false, code: "invalid_service", message: "service metadata must include a name, version, category, tags, and capabilities" };
  }
  if (service.logoUrl !== undefined && (typeof service.logoUrl !== "string" || !safePublicHttps(service.logoUrl))) return { ok: false, code: "invalid_logo", message: "service.logoUrl must use public HTTPS" };
  const privacy = isRecord(invocation) && invocation.privacy;
  if (!isRecord(invocation) || invocation.endpoint === undefined || typeof invocation.endpoint !== "string" || !safePublicHttps(invocation.endpoint) || invocation.method !== "POST" || !safeSchema(invocation.requestSchema) || !safeSchema(invocation.responseSchema) || !boundedPositiveInteger(invocation.timeoutMs, 100) || Number(invocation.timeoutMs) > 120_000 || !boundedPositiveInteger(invocation.maxResponseBytes, 1024) || Number(invocation.maxResponseBytes) > 1_048_576 || !["required", "supported", "none"].includes(String(invocation.idempotency)) || !["none", "review_required"].includes(String(invocation.sideEffects)) || !isRecord(privacy) || !["none", "declared"].includes(String(privacy.retention)) || typeof privacy.sendsToThirdParties !== "boolean" || typeof privacy.description !== "string" || !privacy.description.trim()) {
    return { ok: false, code: "invalid_invocation", message: "invocation must declare a bounded public HTTPS POST contract and privacy policy" };
  }
  if (!isRecord(pricing) || !["x402", "escrow"].includes(String(pricing.rail)) || typeof pricing.amountUSDC !== "string" || !/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(pricing.amountUSDC) || pricing.network !== AGON_SERVICE_NETWORK || pricing.asset !== AGON_SERVICE_USDC) {
    return { ok: false, code: "invalid_pricing", message: "pricing must pin Arc Testnet USDC with up to 6 decimals" };
  }
  if (!isRecord(certification) || certification.adapter !== "agon-http" || certification.adapterVersion !== "1") return { ok: false, code: "invalid_certification", message: "manifest certification adapter is unsupported" };
  return { ok: true, value: normalize(input) };
}

export function manifestV2ServiceKey(serviceKey: string): `0x${string}` {
  return keccak256(stringToHex(serviceKey.trim().toLowerCase()));
}
