import { getAddress, keccak256, stringToHex } from "viem";
import { canonicalizeManifest } from "./core/manifest.ts";

/** ERC-8004 validation is pinned to the deployed Arc Testnet registries. */
export const AGON_VALIDATION_NETWORK = "eip155:5042002" as const;

const BYTES32 = /^0x[a-fA-F0-9]{64}$/;
const POSITIVE_INTEGER = /^[1-9]\d*$/;
const SAFE_TAG = /^[A-Za-z0-9._:-]{1,128}$/;

export type AgonArenaListing = {
  serviceRegistry: string;
  listingId: string;
  agentId: string;
  version: string;
  manifestHash: string;
};

export type AgonValidationRequestPayload = {
  network: typeof AGON_VALIDATION_NETWORK;
  serviceRegistry: `0x${string}`;
  listingId: string;
  agentId: string;
  version: string;
  manifestHash: `0x${string}`;
  checks: readonly string[];
};

export type AgonValidationRequest = {
  requestHash: `0x${string}`;
  validatorAddress: `0x${string}`;
  requesterAddress: `0x${string}`;
  requestURI: string;
  listing: {
    network: typeof AGON_VALIDATION_NETWORK;
    serviceRegistry: `0x${string}`;
    listingId: string;
    agentId: string;
    version: string;
    manifestHash: `0x${string}`;
  };
  requestedAt: Date;
  expiresAt: Date | null;
};

export type AgonValidationResponse = {
  validatorAddress: `0x${string}`;
  response: number;
  responseURI: string | null;
  responseHash: `0x${string}` | null;
  tag: string | null;
  transaction: `0x${string}` | null;
  observedAt: Date;
};

export type AgonVerificationCredentialState = "pending" | "verified" | "rejected" | "expired" | "revoked";

export type AgonVerificationCredential = {
  request: AgonValidationRequest;
  response: AgonValidationResponse | null;
  state: AgonVerificationCredentialState;
};

export type AgonValidationErrorCode =
  | "invalid_request"
  | "request_conflict"
  | "request_not_found"
  | "validator_mismatch"
  | "stale_response"
  | "credential_terminal"
  | "validation_disabled"
  | "validation_unavailable";

export type AgonValidationError = { code: AgonValidationErrorCode; message: string };

export type AgonValidationResult<T> = { ok: true; value: T } | { ok: false; error: AgonValidationError };

function error(code: AgonValidationErrorCode, message: string): { ok: false; error: AgonValidationError } {
  return { ok: false, error: { code, message } };
}

function address(value: string): `0x${string}` | null {
  try {
    return getAddress(value) as `0x${string}`;
  } catch {
    return null;
  }
}

function validURI(value: string): boolean {
  return value.startsWith("https://") || value.startsWith("ipfs://");
}

function validDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}

function validateListing(input: AgonArenaListing): AgonValidationResult<AgonValidationRequest["listing"]> {
  const serviceRegistry = address(input.serviceRegistry);
  if (!serviceRegistry) return error("invalid_request", "service registry address is invalid");
  if (!POSITIVE_INTEGER.test(input.listingId)) return error("invalid_request", "listing id must be a positive integer");
  if (!POSITIVE_INTEGER.test(input.agentId)) return error("invalid_request", "agent id must be a positive integer");
  if (!POSITIVE_INTEGER.test(input.version)) return error("invalid_request", "listing version must be a positive integer");
  if (!BYTES32.test(input.manifestHash)) return error("invalid_request", "manifest hash must be a bytes32 value");
  return {
    ok: true,
    value: {
      network: AGON_VALIDATION_NETWORK,
      serviceRegistry,
      listingId: input.listingId,
      agentId: input.agentId,
      version: input.version,
      manifestHash: input.manifestHash as `0x${string}`,
    },
  };
}

function stateForResponse(response: number): AgonVerificationCredentialState {
  if (response === 100) return "verified";
  if (response === 0) return "rejected";
  return "pending";
}

/** Build the exact committed payload that a validator receives off-chain. */
export function buildValidationRequestPayload(input: AgonArenaListing & { checks: readonly string[] }): AgonValidationRequestPayload {
  const listing = validateListing(input);
  if (!listing.ok) throw new Error(listing.error.message);
  const checks = [...input.checks];
  if (checks.length === 0 || checks.some((check) => !SAFE_TAG.test(check)) || new Set(checks).size !== checks.length) {
    throw new Error("validation checks must be unique safe tags");
  }
  return { ...listing.value, checks };
}

export function hashValidationRequest(payload: AgonValidationRequestPayload): `0x${string}` {
  return keccak256(stringToHex(canonicalizeManifest(payload)));
}

/**
 * Local deterministic credential store. Production persistence must preserve
 * the same immutable-request and monotonic-response semantics before enabling
 * the external registry adapter.
 */
export class AgonVerificationCredentialLedger {
  private readonly credentials = new Map<string, AgonVerificationCredential>();

  createRequest(input: {
    listing: AgonArenaListing;
    validatorAddress: string;
    requesterAddress: string;
    requestURI: string;
    requestHash: string;
    requestedAt?: Date;
    expiresAt?: Date | null;
  }): AgonValidationResult<{ decision: "created" | "idempotent_replay"; credential: AgonVerificationCredential }> {
    const listing = validateListing(input.listing);
    if (!listing.ok) return listing;
    const validator = address(input.validatorAddress);
    const requester = address(input.requesterAddress);
    if (!validator || !requester || validator.toLowerCase() === requester.toLowerCase()) {
      return error("invalid_request", "validator must be valid and distinct from the requester");
    }
    if (!BYTES32.test(input.requestHash)) return error("invalid_request", "request hash must be a bytes32 value");
    if (!validURI(input.requestURI)) return error("invalid_request", "request URI must use HTTPS or IPFS");
    const requestedAt = input.requestedAt ?? new Date();
    const expiresAt = input.expiresAt ?? null;
    if (!validDate(requestedAt) || (expiresAt && !validDate(expiresAt)) || (expiresAt && expiresAt <= requestedAt)) {
      return error("invalid_request", "validation request timestamps are invalid");
    }
    const request: AgonValidationRequest = {
      requestHash: input.requestHash as `0x${string}`,
      validatorAddress: validator,
      requesterAddress: requester,
      requestURI: input.requestURI,
      listing: listing.value,
      requestedAt,
      expiresAt,
    };
    const key = input.requestHash.toLowerCase();
    const existing = this.credentials.get(key);
    if (existing) {
      if (JSON.stringify(existing.request) !== JSON.stringify(request)) return error("request_conflict", "request hash is already bound to different validation economics");
      return { ok: true, value: { decision: "idempotent_replay", credential: existing } };
    }
    const credential: AgonVerificationCredential = { request, response: null, state: "pending" };
    this.credentials.set(key, credential);
    return { ok: true, value: { decision: "created", credential } };
  }

  get(requestHash: string, now = new Date()): AgonVerificationCredential | null {
    const credential = this.credentials.get(requestHash.toLowerCase());
    if (!credential) return null;
    if (credential.state === "pending" && credential.request.expiresAt && now >= credential.request.expiresAt) {
      credential.state = "expired";
    }
    return credential;
  }

  respond(input: {
    requestHash: string;
    validatorAddress: string;
    response: number;
    responseURI?: string | null;
    responseHash?: string | null;
    tag?: string | null;
    transaction?: string | null;
    observedAt?: Date;
  }): AgonValidationResult<AgonVerificationCredential> {
    const credential = this.credentials.get(input.requestHash.toLowerCase());
    if (!credential) return error("request_not_found", "validation request does not exist");
    if (credential.state === "expired" || credential.state === "revoked") return error("credential_terminal", "validation credential is terminal");
    const validator = address(input.validatorAddress);
    if (!validator || validator.toLowerCase() !== credential.request.validatorAddress.toLowerCase()) return error("validator_mismatch", "response validator does not match the request");
    if (!Number.isInteger(input.response) || input.response < 0 || input.response > 100) return error("invalid_request", "validation response must be an integer from 0 to 100");
    const observedAt = input.observedAt ?? new Date();
    if (!validDate(observedAt)) return error("invalid_request", "validation response timestamp is invalid");
    if (credential.response && observedAt < credential.response.observedAt) return error("stale_response", "validation response is older than the recorded response");
    const responseURI = input.responseURI ?? null;
    const responseHash = input.responseHash ?? null;
    const transaction = input.transaction ?? null;
    if (responseURI && !validURI(responseURI)) return error("invalid_request", "response URI must use HTTPS or IPFS");
    if (responseHash !== null && !BYTES32.test(responseHash)) return error("invalid_request", "response hash must be a bytes32 value");
    if (transaction !== null && !BYTES32.test(transaction)) return error("invalid_request", "validation transaction must be a bytes32 value");
    if (input.tag !== undefined && input.tag !== null && !SAFE_TAG.test(input.tag)) return error("invalid_request", "validation tag is invalid");
    credential.response = {
      validatorAddress: validator,
      response: input.response,
      responseURI,
      responseHash: responseHash as `0x${string}` | null,
      tag: input.tag ?? null,
      transaction: transaction as `0x${string}` | null,
      observedAt,
    };
    credential.state = stateForResponse(input.response);
    return { ok: true, value: credential };
  }

  revoke(requestHash: string): AgonValidationResult<AgonVerificationCredential> {
    const credential = this.credentials.get(requestHash.toLowerCase());
    if (!credential) return error("request_not_found", "validation request does not exist");
    if (credential.state === "expired" || credential.state === "revoked") return error("credential_terminal", "validation credential is terminal");
    credential.state = "revoked";
    return { ok: true, value: credential };
  }
}

export type AgonValidationRegistryAdapter = {
  enabled: boolean;
  request(input: { validatorAddress: `0x${string}`; agentId: bigint; requestURI: string; requestHash: `0x${string}` }): Promise<AgonValidationResult<{ transaction: `0x${string}` | null }>>;
  respond(input: { requestHash: `0x${string}`; response: number; responseURI?: string | null; responseHash?: `0x${string}` | null; tag?: string | null }): Promise<AgonValidationResult<{ transaction: `0x${string}` | null }>>;
};

/** No validator wallet, contract client, RPC call, or transaction is created. */
export function createDisabledAgonValidationRegistryAdapter(): AgonValidationRegistryAdapter {
  return {
    enabled: false,
    async request() {
      return error("validation_disabled", "ERC-8004 validation writes are disabled by policy");
    },
    async respond() {
      return error("validation_disabled", "ERC-8004 validation writes are disabled by policy");
    },
  };
}
