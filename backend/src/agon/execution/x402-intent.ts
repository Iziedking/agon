import { keccak256, stringToHex } from "viem";
import type { AgonListingView, X402CallIntentRequest, X402CallIntentView } from "../http/api-types.ts";
import type { Result } from "../core/result.ts";

const AMOUNT_PATTERN = /^(0|[1-9]\d*)(\.\d{1,6})?$/;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const MAX_INPUT_BYTES = 64 * 1024;

export type X402IntentErrorCode = "invalid_request" | "not_eligible";

export type X402IntentError = {
  code: X402IntentErrorCode;
  message: string;
};

export type PreparedX402Call = {
  actor: string;
  idempotencyKey: string;
  listing: AgonListingView;
  method: X402CallIntentRequest["method"];
  input: unknown;
  inputHash: `0x${string}`;
  maxAmountUSDC: string;
};

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
      .join(",")}}`;
  }
  throw new Error("input must be JSON-compatible");
}

function inputHash(input: unknown): `0x${string}` {
  const canonical = canonicalize(input);
  if (Buffer.byteLength(canonical, "utf8") > MAX_INPUT_BYTES) {
    throw new Error("input exceeds the 64 KiB limit");
  }
  return keccak256(stringToHex(canonical));
}

function amountIsPositive(value: string): boolean {
  if (!AMOUNT_PATTERN.test(value)) return false;
  return BigInt(value.replace(".", "").padEnd(value.includes(".") ? value.length + (6 - value.split(".")[1]!.length) : value.length, "0")) > 0n;
}

function eligibilityError(listing: AgonListingView): X402IntentError | null {
  if (listing.status !== "Listed" || listing.risk.quarantineReason) {
    return { code: "not_eligible", message: "listing is not active and cannot receive a call" };
  }
  if (listing.payment.rail !== "X402" || !listing.payment.directX402) {
    return { code: "not_eligible", message: "listing does not declare direct x402 access" };
  }
  if (listing.verification.status !== "Verified") {
    return { code: "not_eligible", message: "only Agon-verified listings can receive calls" };
  }
  if (listing.endpointQa.status !== "passed") {
    return { code: "not_eligible", message: "endpoint verification must pass before a call can be prepared" };
  }
  return null;
}

export function prepareX402Call(
  actor: string,
  listing: AgonListingView,
  request: X402CallIntentRequest,
): Result<PreparedX402Call, X402IntentError> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(actor)) {
    return { ok: false, error: { code: "invalid_request", message: "authenticated actor is not a valid EVM address" } };
  }
  const blocked = eligibilityError(listing);
  if (blocked) return { ok: false, error: blocked };
  if (!IDEMPOTENCY_PATTERN.test(request.idempotencyKey)) {
    return { ok: false, error: { code: "invalid_request", message: "idempotencyKey must be 8-128 safe characters" } };
  }
  if (!AMOUNT_PATTERN.test(request.maxAmountUSDC) || !amountIsPositive(request.maxAmountUSDC)) {
    return { ok: false, error: { code: "invalid_request", message: "maxAmountUSDC must be a positive USDC amount with up to 6 decimals" } };
  }
  try {
    return {
      ok: true,
      value: {
        actor: actor.toLowerCase(),
        idempotencyKey: request.idempotencyKey,
        listing,
        method: request.method,
        input: request.input,
        inputHash: inputHash(request.input),
        maxAmountUSDC: request.maxAmountUSDC,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: { code: "invalid_request", message: error instanceof Error ? error.message : "input is not valid JSON" },
    };
  }
}

export function callIntentView(input: {
  intentId: string;
  actor: string;
  idempotencyKey: string;
  listingReference: string;
  listingVersion: string;
  inputHash: string;
  maxAmountUSDC: string;
  state: "prepared";
  createdAt: Date;
}): X402CallIntentView {
  return {
    intentId: input.intentId,
    actor: input.actor,
    idempotencyKey: input.idempotencyKey,
    listingReference: input.listingReference,
    listingVersion: input.listingVersion,
    inputHash: input.inputHash,
    maxAmountUSDC: input.maxAmountUSDC,
    state: input.state,
    executionEnabled: false,
    nextAction: "execution_adapter_not_enabled",
    createdAt: input.createdAt.toISOString(),
  };
}
