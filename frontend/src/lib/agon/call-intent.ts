import type { AgonListing, X402CallIntentRequest } from "./types";

export type X402Readiness = {
  eligible: boolean;
  label: "READY" | "BLOCKED";
  reason: string;
};

/**
 * Mirrors the backend's fail-closed eligibility boundary for the UI. This is
 * intentionally a display aid, never an authorization decision.
 */
export function assessX402Readiness(listing: AgonListing): X402Readiness {
  if (listing.status !== "Listed") {
    return { eligible: false, label: "BLOCKED", reason: `Listing is ${listing.status.toLowerCase()}.` };
  }
  if (listing.risk.quarantineReason) {
    return { eligible: false, label: "BLOCKED", reason: "Agon quarantined this listing." };
  }
  if (listing.payment.rail !== "X402" || !listing.payment.directX402) {
    return { eligible: false, label: "BLOCKED", reason: "This listing does not declare direct x402 delivery." };
  }
  if (listing.verification.status !== "Verified") {
    return { eligible: false, label: "BLOCKED", reason: "Only Agon-verified listings can receive a call intent." };
  }
  if (listing.endpointQa.status !== "passed") {
    return { eligible: false, label: "BLOCKED", reason: "Endpoint QA has not passed for this exact version." };
  }
  return { eligible: true, label: "READY", reason: "Verified listing and endpoint QA passed." };
}

export function parseCallInput(raw: string): { input: unknown } | { error: string } {
  try {
    const input = JSON.parse(raw);
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      return { error: "Input must be a JSON object." };
    }
    return { input };
  } catch {
    return { error: "Enter valid JSON before preparing the call." };
  }
}

export function buildCallIntentRequest(
  idempotencyKey: string,
  method: X402CallIntentRequest["method"],
  rawInput: string,
  maxAmountUSDC: string,
): X402CallIntentRequest | { error: string } {
  const parsed = parseCallInput(rawInput);
  if ("error" in parsed) return parsed;
  if (!/^\d+(?:\.\d{1,6})?$/.test(maxAmountUSDC) || Number(maxAmountUSDC) <= 0) {
    return { error: "Spend cap must be a positive USDC amount with up to 6 decimals." };
  }
  return { idempotencyKey, method, input: parsed.input, maxAmountUSDC };
}

export function newCallIntentKey(): string {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `agon-call-${suffix}`;
}
