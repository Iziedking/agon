import { lookup } from "node:dns/promises";

import { canonicalManifestHash, validateManifest } from "./core/manifest.ts";

const MAX_MANIFEST_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

export type ManifestInspection = {
  uri: string;
  manifestHash: `0x${string}`;
  body: unknown;
  contentType: string | null;
  byteLength: number;
  validation: ReturnType<typeof validateManifest>;
};

export class ManifestInspectionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ManifestInspectionError";
    this.code = code;
  }
}

function publicHttpsUri(value: string): URL {
  let uri: URL;
  try {
    uri = new URL(value);
  } catch {
    throw new ManifestInspectionError("manifest_uri_invalid", "Manifest URL must be a valid HTTPS URL.");
  }
  if (uri.protocol !== "https:" || uri.username || uri.password || uri.hash) {
    throw new ManifestInspectionError("manifest_uri_invalid", "Manifest URL must use public HTTPS without credentials or fragments.");
  }
  const hostname = uri.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
    || hostname === "::1"
    || hostname === "0.0.0.0"
    || /^127\./.test(hostname)
    || /^10\./.test(hostname)
    || /^192\.168\./.test(hostname)
    || /^169\.254\./.test(hostname)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    || /^fc|^fd|^fe[89a-f]/.test(hostname)
  ) {
    throw new ManifestInspectionError("manifest_uri_blocked", "Manifest URL points to a private or reserved network.");
  }
  return uri;
}

function isPublicAddress(address: string): boolean {
  const value = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (value === "::1" || value === "0.0.0.0" || value === "localhost") return false;
  if (/^127\./.test(value) || /^10\./.test(value) || /^192\.168\./.test(value) || /^169\.254\./.test(value)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(value)) return false;
  if (/^fc|^fd|^fe[89a-f]/.test(value)) return false;
  return true;
}

async function readBounded(response: Response): Promise<{ text: string; byteLength: number }> {
  if (!response.body) return { text: "", byteLength: 0 };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (!next.value) continue;
      byteLength += next.value.byteLength;
      if (byteLength > MAX_MANIFEST_BYTES) {
        await reader.cancel("manifest size limit exceeded");
        throw new ManifestInspectionError("manifest_too_large", "The manifest is larger than 64 KiB.");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return { text: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), byteLength).toString("utf8"), byteLength };
}

export async function inspectManifest(
  value: string,
  options: { fetch?: typeof fetch; timeoutMs?: number; resolve?: (hostname: string) => Promise<string[]> } = {},
): Promise<ManifestInspection> {
  const uri = publicHttpsUri(value.trim());
  const resolve = options.resolve ?? (async (hostname) => (await lookup(hostname, { all: true })).map((entry) => entry.address));
  try {
    const addresses = await resolve(uri.hostname);
    if (addresses.length === 0 || addresses.some((address) => !isPublicAddress(address))) {
      throw new ManifestInspectionError("manifest_uri_blocked", "Manifest URL resolves to a private or reserved network.");
    }
  } catch (error) {
    if (error instanceof ManifestInspectionError) throw error;
    throw new ManifestInspectionError("manifest_dns_failed", "The manifest host could not be safely resolved.");
  }

  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(uri, {
      method: "GET",
      redirect: "error",
      headers: { accept: "application/json", "user-agent": "agon-manifest-inspector/1" },
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch {
    throw new ManifestInspectionError("manifest_unavailable", "The manifest URL did not respond.");
  }
  if (!response.ok) {
    throw new ManifestInspectionError("manifest_http_failed", `The manifest returned HTTP ${response.status}.`);
  }
  const declaredSize = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredSize) && declaredSize > MAX_MANIFEST_BYTES) {
    throw new ManifestInspectionError("manifest_too_large", "The manifest is larger than 64 KiB.");
  }
  const raw = await readBounded(response);
  let body: unknown;
  try {
    body = JSON.parse(raw.text) as unknown;
  } catch {
    throw new ManifestInspectionError("manifest_invalid_json", "The manifest did not contain valid JSON.");
  }
  return {
    uri: uri.toString(),
    manifestHash: canonicalManifestHash(body),
    body,
    contentType: response.headers.get("content-type"),
    byteLength: raw.byteLength,
    validation: validateManifest(body),
  };
}
