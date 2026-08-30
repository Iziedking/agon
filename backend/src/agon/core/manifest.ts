import { keccak256, stringToHex } from "viem";
import {
  AGON_SERVICE_CHAIN_ID,
  AGON_SERVICE_NETWORK,
  AGON_SERVICE_PROTOCOL,
  AGON_SERVICE_USDC,
  AGON_SERVICE_MANIFEST_V2_JSON_SCHEMA,
  normalizeManifestV2,
  type AgonJsonSchema,
  type AgonServiceManifestV2,
} from "../invocation/manifest-v2.ts";

export { AGON_SERVICE_CHAIN_ID, AGON_SERVICE_NETWORK, AGON_SERVICE_PROTOCOL, AGON_SERVICE_USDC, AGON_SERVICE_MANIFEST_V2_JSON_SCHEMA, normalizeManifestV2 } from "../invocation/manifest-v2.ts";
export type { AgonJsonSchema, AgonServiceManifestV2 } from "../invocation/manifest-v2.ts";

export function canonicalManifestHash(value: unknown): `0x${string}` {
  return keccak256(stringToHex(canonicalizeManifest(value)));
}

export function canonicalizeManifest(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalizeManifest).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalizeManifest(object[key])}`).join(",")}}`;
  }
  throw new Error("unsupported manifest value");
}

export type ManifestValidation = { ok: true } | { ok: false; code: string; message: string };

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
      && !/^fc|^fd|^fe[89a-f]/.test(host);
  } catch {
    return false;
  }
}

export function validateManifestV2(input: unknown): ManifestValidation {
  const result = normalizeManifestV2(input);
  return result.ok ? { ok: true } : result;
}

export function isManifestCertificationEligible(input: unknown): boolean {
  return validateManifestV2(input).ok;
}

export function validateManifest(input: unknown): ManifestValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, code: "invalid_shape", message: "manifest must be an object" };
  const manifest = input as Record<string, unknown>;
  if (manifest.protocol === AGON_SERVICE_PROTOCOL) return validateManifestV2(manifest);
  if (typeof manifest.endpoint !== "string" || !safePublicHttps(manifest.endpoint)) return { ok: false, code: "invalid_endpoint", message: "endpoint must use public HTTPS" };
  if (manifest.logoUrl !== undefined && (typeof manifest.logoUrl !== "string" || !safePublicHttps(manifest.logoUrl))) return { ok: false, code: "invalid_logo", message: "logoUrl must use public HTTPS" };
  const tags = manifest.tags;
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string") || new Set(tags).size !== tags.length) return { ok: false, code: "invalid_tags", message: "tags must be unique strings" };
  const pricing = manifest.pricing as Record<string, unknown> | undefined;
  if (!pricing || pricing.rail !== "x402" || typeof pricing.amountUSDC !== "string" || !/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(pricing.amountUSDC)) return { ok: false, code: "invalid_pricing", message: "x402 pricing metadata is required" };
  const schema = manifest.inputSchema;
  if (schema && typeof schema === "object" && JSON.stringify(schema).match(/\$ref|remote|patternProperties|additionalProperties/)) return { ok: false, code: "unsafe_schema", message: "schema contains forbidden remote or executable keywords" };
  return { ok: true };
}
