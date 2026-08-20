import { randomBytes } from "node:crypto";
import { GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS } from "@circle-fin/x402-batching";
import { getAddress, keccak256, recoverTypedDataAddress, stringToHex } from "viem";
import type { X402QuoteSnapshot } from "./x402-quote.ts";

const AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export type X402AuthorizationPayload = {
  x402Version: 2;
  domain: { name: "GatewayWalletBatched"; version: "1"; chainId: number; verifyingContract: `0x${string}` };
  types: typeof AUTHORIZATION_TYPES;
  primaryType: "TransferWithAuthorization";
  message: {
    from: `0x${string}`;
    to: `0x${string}`;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: `0x${string}`;
  };
};

export type X402AuthorizationError = { code: "invalid_authorization"; message: string };

export type X402AuthorizationSignatureCheck = {
  signatureHash: `0x${string}`;
  recoveredAddress: `0x${string}`;
};

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("authorization contains an unsafe number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  throw new Error("authorization is not JSON-compatible");
}

export function buildX402Authorization(
  actor: string,
  chainId: string,
  snapshot: X402QuoteSnapshot,
  nowSeconds = Math.floor(Date.now() / 1000),
): { ok: true; value: { payload: X402AuthorizationPayload; payloadHash: `0x${string}` } } | { ok: false; error: X402AuthorizationError } {
  if (!/^0x[0-9a-fA-F]{40}$/.test(actor)) return { ok: false, error: { code: "invalid_authorization", message: "buyer actor is not an EVM address" } };
  if (!/^\d+$/.test(chainId) || Number(chainId) > Number.MAX_SAFE_INTEGER) return { ok: false, error: { code: "invalid_authorization", message: "authorization chain id is invalid" } };
  const option = snapshot.accepts[0];
  if (!option || option.extra.name !== "GatewayWalletBatched" || option.extra.version !== "1" || typeof option.extra.verifyingContract !== "string") {
    return { ok: false, error: { code: "invalid_authorization", message: "quote has no Circle Gateway authorization option" } };
  }
  try {
    const chain = Number(chainId);
    const from = getAddress(actor) as `0x${string}`;
    const to = getAddress(option.payTo) as `0x${string}`;
    const verifyingContract = getAddress(option.extra.verifyingContract) as `0x${string}`;
    const validityWindow = Math.max(option.maxTimeoutSeconds, GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS);
    const payload: X402AuthorizationPayload = {
      x402Version: 2,
      domain: { name: "GatewayWalletBatched", version: "1", chainId: chain, verifyingContract },
      types: AUTHORIZATION_TYPES,
      primaryType: "TransferWithAuthorization",
      message: {
        from,
        to,
        value: option.amount,
        validAfter: String(nowSeconds - 600),
        validBefore: String(nowSeconds + validityWindow),
        nonce: `0x${randomBytes(32).toString("hex")}`,
      },
    };
    return { ok: true, value: { payload, payloadHash: keccak256(stringToHex(canonicalize(payload))) } };
  } catch (error) {
    return { ok: false, error: { code: "invalid_authorization", message: error instanceof Error ? error.message : "authorization payload is invalid" } };
  }
}

/**
 * Validate a signature at the trust boundary, before any facilitator or
 * provider call is even considered. The raw signature is deliberately not
 * persisted by this slice; only its hash is attached to the receipt.
 */
export async function validateX402AuthorizationSignature(
  payload: X402AuthorizationPayload,
  signature: string,
  expectedActor: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<{ ok: true; value: X402AuthorizationSignatureCheck } | { ok: false; error: X402AuthorizationError }> {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    return { ok: false, error: { code: "invalid_authorization", message: "signature must be a 65-byte ECDSA signature" } };
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(expectedActor)) {
    return { ok: false, error: { code: "invalid_authorization", message: "buyer actor is not an EVM address" } };
  }
  try {
    const validAfter = BigInt(payload.message.validAfter);
    const validBefore = BigInt(payload.message.validBefore);
    if (validAfter > validBefore || BigInt(nowSeconds) < validAfter || BigInt(nowSeconds) > validBefore) {
      return { ok: false, error: { code: "invalid_authorization", message: "authorization is outside its validity window" } };
    }
    const recoveredAddress = await recoverTypedDataAddress({
      domain: payload.domain,
      types: payload.types,
      primaryType: payload.primaryType,
      message: {
        from: payload.message.from,
        to: payload.message.to,
        value: BigInt(payload.message.value),
        validAfter: BigInt(payload.message.validAfter),
        validBefore: BigInt(payload.message.validBefore),
        nonce: payload.message.nonce,
      },
      signature: signature as `0x${string}`,
    });
    const expected = getAddress(expectedActor);
    const declared = getAddress(payload.message.from);
    if (recoveredAddress !== expected || declared !== expected) {
      return { ok: false, error: { code: "invalid_authorization", message: "signature does not authorize the intent owner" } };
    }
    return {
      ok: true,
      value: { signatureHash: keccak256(signature as `0x${string}`), recoveredAddress },
    };
  } catch {
    return { ok: false, error: { code: "invalid_authorization", message: "signature could not be recovered for this authorization" } };
  }
}
