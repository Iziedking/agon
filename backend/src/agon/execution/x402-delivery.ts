import { getAddress, keccak256, stringToHex } from "viem";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const USDC = /^(0|[1-9]\d*)(\.\d{1,6})?$/;

export type X402DeliveryEvidenceInput = {
  deliveryId?: string;
  intentId: string;
  receiptId: string;
  provider: string;
  listingReference: string;
  serviceStatus: number;
  latencyMs: number;
  responseHash: string;
  resultAttestationHash?: string | null;
  chargedAmountUSDC?: string | null;
  deliveredAt: Date;
};

export type X402DeliveryEvidence = Omit<X402DeliveryEvidenceInput, "provider" | "responseHash" | "resultAttestationHash"> & {
  deliveryId: string;
  provider: `0x${string}`;
  responseHash: `0x${string}`;
  resultAttestationHash: `0x${string}` | null;
  chargedAmountUSDC: string | null;
  evidenceHash: `0x${string}`;
  createdAt: Date;
};

export class X402DeliveryInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "X402DeliveryInvariantError";
  }
}

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
  throw new X402DeliveryInvariantError("delivery evidence contains an unsupported value");
}

function requireHash(value: string, label: string): `0x${string}` {
  if (!HASH.test(value)) throw new X402DeliveryInvariantError(`${label} must be a bytes32 hash`);
  return value.toLowerCase() as `0x${string}`;
}

function requireAddress(value: string, label: string): `0x${string}` {
  if (!ADDRESS.test(value)) throw new X402DeliveryInvariantError(`${label} must be an EVM address`);
  try {
    return getAddress(value) as `0x${string}`;
  } catch {
    throw new X402DeliveryInvariantError(`${label} must be an EVM address`);
  }
}

function requireAmount(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (!USDC.test(value)) throw new X402DeliveryInvariantError("charged amount must be a USDC amount with up to 6 decimals");
  const [whole = "0", fraction = ""] = value.split(".");
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction ? `${whole}.${normalizedFraction}` : whole;
}

export function hashX402DeliveryEvidence(input: Omit<X402DeliveryEvidence, "evidenceHash" | "createdAt">): `0x${string}` {
  return keccak256(stringToHex(canonicalize({
    deliveryId: input.deliveryId,
    intentId: input.intentId,
    receiptId: input.receiptId,
    provider: input.provider.toLowerCase(),
    listingReference: input.listingReference,
    serviceStatus: input.serviceStatus,
    latencyMs: input.latencyMs,
    responseHash: input.responseHash.toLowerCase(),
    resultAttestationHash: input.resultAttestationHash?.toLowerCase() ?? null,
    chargedAmountUSDC: input.chargedAmountUSDC,
    deliveredAt: input.deliveredAt.toISOString(),
  })));
}

export function validateX402DeliveryEvidence(input: X402DeliveryEvidenceInput, now = new Date()): X402DeliveryEvidence {
  if (!UUID.test(input.deliveryId ?? "")) throw new X402DeliveryInvariantError("delivery id must be a UUID");
  if (!UUID.test(input.intentId) || !UUID.test(input.receiptId)) throw new X402DeliveryInvariantError("intent and receipt ids must be UUIDs");
  const provider = requireAddress(input.provider, "provider");
  if (!input.listingReference || input.listingReference.length > 512) throw new X402DeliveryInvariantError("listing reference must be 1-512 characters");
  if (!Number.isInteger(input.serviceStatus) || input.serviceStatus < 200 || input.serviceStatus > 299) {
    throw new X402DeliveryInvariantError("service status must be a successful HTTP status");
  }
  if (!Number.isInteger(input.latencyMs) || input.latencyMs < 0 || input.latencyMs > 900_000) {
    throw new X402DeliveryInvariantError("latency must be an integer between 0 and 900000 milliseconds");
  }
  if (!(input.deliveredAt instanceof Date) || !Number.isFinite(input.deliveredAt.getTime())) {
    throw new X402DeliveryInvariantError("delivery timestamp is invalid");
  }
  if (input.deliveredAt.getTime() > now.getTime() + 60_000) throw new X402DeliveryInvariantError("delivery timestamp is too far in the future");
  const responseHash = requireHash(input.responseHash, "response hash");
  const resultAttestationHash = input.resultAttestationHash === undefined || input.resultAttestationHash === null
    ? null
    : requireHash(input.resultAttestationHash, "result attestation hash");
  const chargedAmountUSDC = requireAmount(input.chargedAmountUSDC);
  const deliveryId = input.deliveryId!;
  const base = {
    deliveryId,
    intentId: input.intentId,
    receiptId: input.receiptId,
    provider,
    listingReference: input.listingReference,
    serviceStatus: input.serviceStatus,
    latencyMs: input.latencyMs,
    responseHash,
    resultAttestationHash,
    chargedAmountUSDC,
    deliveredAt: input.deliveredAt,
  };
  return { ...base, evidenceHash: hashX402DeliveryEvidence(base), createdAt: now };
}
