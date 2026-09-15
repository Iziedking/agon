import { keccak256, stringToHex } from "viem";

import type { ListedPlaygroundProvider } from "./playground-provider.ts";

const MAX_RESPONSE_BYTES = 32 * 1024;
const DEFAULT_TIMEOUT_MS = 12_000;

export type AgonEndpointQaEvidence = {
  endpointUrl: string;
  endpointStatus: number | null;
  checkedAt: string;
  checks: {
    x402_payment: {
      passed: boolean;
      detail: string;
      header: "PAYMENT-REQUIRED" | null;
    };
  };
  error?: string;
};

export type AgonEndpointQaResult = {
  passed: boolean;
  evidenceHash: `0x${string}`;
  evidence: AgonEndpointQaEvidence;
};

export interface AgonEndpointQaRunner {
  scopes(): readonly string[];
  supports(provider: ListedPlaygroundProvider): boolean;
  run(input: { provider: ListedPlaygroundProvider }): Promise<AgonEndpointQaResult>;
}

export class AgonEndpointQaError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "AgonEndpointQaError";
  }
}

function endpoint(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Agon endpoint QA URLs must be valid URLs.");
  }
  const host = url.hostname.toLowerCase();
  const blockedHost = host === "localhost"
    || host.endsWith(".localhost")
    || host.endsWith(".local")
    || host.endsWith(".internal")
    || /^127\./.test(host)
    || /^10\./.test(host)
    || /^192\.168\./.test(host)
    || /^169\.254\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    || host === "::1"
    || host === "0.0.0.0";
  if (url.protocol !== "https:" || url.username || url.password || url.hash || blockedHost) {
    throw new Error("Agon endpoint QA URLs must use public HTTPS URLs without credentials or fragments.");
  }
  return url;
}

function scope(provider: ListedPlaygroundProvider): string {
  return `${provider.listingReference}@${provider.listingVersion}`.toLowerCase();
}

function evidenceHash(evidence: AgonEndpointQaEvidence): `0x${string}` {
  return keccak256(stringToHex(JSON.stringify(evidence))) as `0x${string}`;
}

function failureResult(target: URL, code: string, detail: string): AgonEndpointQaResult {
  const evidence: AgonEndpointQaEvidence = {
    endpointUrl: target.toString(),
    endpointStatus: null,
    checkedAt: new Date().toISOString(),
    checks: { x402_payment: { passed: false, detail, header: null } },
    error: code,
  };
  return { passed: false, evidenceHash: evidenceHash(evidence), evidence };
}

function validPaymentChallenge(value: string | null): boolean {
  if (!value || value.length > 16 * 1024) return false;
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as { accepts?: unknown };
    return Array.isArray(parsed.accepts) && parsed.accepts.length > 0;
  } catch {
    return false;
  }
}

async function readBoundedBody(response: Response): Promise<void> {
  if (!response.body) return;
  const reader = response.body.getReader();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel("AGON endpoint QA response limit exceeded");
        throw new AgonEndpointQaError("response_too_large", "The endpoint QA response exceeded 32 KiB.");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function createHttpAgonEndpointQaRunner(
  configuredEndpoints: Readonly<Record<string, string>>,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): AgonEndpointQaRunner {
  const targets = new Map<string, URL>();
  for (const [key, value] of Object.entries(configuredEndpoints)) {
    if (!/^[1-9]\d*:0x[0-9a-fA-F]{40}:[1-9]\d*@[1-9]\d*$/.test(key)) {
      throw new Error(`Invalid endpoint QA listing scope: ${key}`);
    }
    targets.set(key.toLowerCase(), endpoint(value));
  }
  const runFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
    throw new Error("Agon endpoint QA timeout must be between 100ms and 60s.");
  }

  return {
    scopes() {
      return [...targets.keys()].sort();
    },
    supports(provider) {
      return targets.has(scope(provider));
    },
    async run({ provider }) {
      const target = targets.get(scope(provider));
      if (!target) throw new AgonEndpointQaError("endpoint_not_enabled", "This provider endpoint is not enabled for QA.");
      const checkedAt = new Date().toISOString();
      let response: Response;
      try {
        response = await runFetch(target, {
          method: "POST",
          redirect: "error",
          headers: { "content-type": "application/json", "user-agent": "agon-endpoint-qa/1" },
          body: JSON.stringify({
            protocol: "agon-x402-preflight/1",
            category: "analysis",
            input: { probe: "payment-challenge", writes: false },
            scope: { listingReference: provider.listingReference, listingVersion: provider.listingVersion },
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        return failureResult(target, "endpoint_unavailable", "The endpoint did not answer within the QA time limit.");
      }

      const declaredSize = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(declaredSize) && declaredSize > MAX_RESPONSE_BYTES) {
        return failureResult(target, "response_too_large", "The endpoint returned more than 32 KiB.");
      }
      try {
        await readBoundedBody(response);
      } catch (error) {
        return failureResult(
          target,
          error instanceof AgonEndpointQaError ? error.code : "response_read_failed",
          error instanceof Error ? error.message : "The endpoint response could not be read.",
        );
      }
      const rawPaymentHeader = response.headers.get("PAYMENT-REQUIRED") ?? response.headers.get("payment-required");
      const header = rawPaymentHeader !== null
        ? "PAYMENT-REQUIRED" as const
        : null;
      const passed = response.status === 402 && header !== null && validPaymentChallenge(rawPaymentHeader);
      const evidence: AgonEndpointQaEvidence = {
        endpointUrl: target.toString(),
        endpointStatus: response.status,
        checkedAt,
        checks: {
          x402_payment: {
            passed,
            detail: passed
              ? "The provider returned HTTP 402 with a payment challenge and no payment was submitted."
              : response.status === 402 && header !== null
                ? "The provider returned HTTP 402 with an invalid PAYMENT-REQUIRED challenge."
                : response.status === 402
                  ? "The provider returned HTTP 402 without a PAYMENT-REQUIRED header."
                : `The provider returned HTTP ${response.status}; expected HTTP 402 before payment.`,
            header,
          },
        },
      };
      return { passed, evidenceHash: evidenceHash(evidence), evidence };
    },
  };
}
