import { createHash } from "node:crypto";
import {
  canonicalManifestHash,
  normalizeManifestV2,
  type AgonServiceManifestV2,
} from "../core/manifest.ts";
import { manifestV2ServiceKey } from "../invocation/manifest-v2.ts";
import type { ProviderDraftInput } from "./contract.ts";

export type ProviderManifestIdentity = {
  agentId: string;
  serviceKey?: `0x${string}`;
};

export type CompiledProviderManifest = {
  body: AgonServiceManifestV2;
  manifestHash: `0x${string}`;
  serviceKey: `0x${string}`;
  draftDigest: `0x${string}`;
};

function slug(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "service";
}

export function compileProviderManifest(draft: ProviderDraftInput, identity: ProviderManifestIdentity): CompiledProviderManifest {
  const serviceKey = identity.serviceKey ?? manifestV2ServiceKey(`${draft.category}:${draft.name}`);
  const body = {
    protocol: "agon-service/2",
    identity: { chainId: 5042002, agentId: identity.agentId, serviceKey },
    service: {
      name: draft.name,
      description: draft.outcome,
      category: slug(draft.category),
      tags: [slug(draft.category)],
      logoUrl: draft.logoUrl,
      version: "1",
      capabilities: [slug(draft.category)],
    },
    invocation: {
      endpoint: draft.endpoint,
      method: "POST",
      requestSchema: { type: "object", required: draft.inputs.map(slug) },
      responseSchema: { type: "object", required: draft.outputs.map(slug) },
      timeoutMs: Math.max(100, Math.min(120_000, draft.expectedLatencyMs)),
      maxResponseBytes: 1_048_576,
      idempotency: "required",
      sideEffects: "review_required",
      privacy: { retention: "declared", sendsToThirdParties: true, description: draft.privacy },
    },
    pricing: { rail: "x402", amountUSDC: draft.priceUSDC, network: "eip155:5042002", asset: "0x3600000000000000000000000000000000000000" },
    certification: { adapter: "agon-http", adapterVersion: "1", endpoint: draft.endpoint },
  } as const;
  const normalized = normalizeManifestV2(body);
  if (!normalized.ok) throw new Error(normalized.message);
  const manifestHash = canonicalManifestHash(normalized.value);
  const draftDigest = `0x${createHash("sha256").update(JSON.stringify(draft)).digest("hex")}` as `0x${string}`;
  return { body: normalized.value, manifestHash, serviceKey, draftDigest };
}
