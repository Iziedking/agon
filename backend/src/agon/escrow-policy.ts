import { getAddress, keccak256, stringToHex } from "viem";
import { canonicalizeManifest } from "./core/manifest.ts";

export const AGON_ESCROW_NETWORK = "eip155:5042002" as const;
export const AGON_ESCROW_USDC = "0x3600000000000000000000000000000000000000" as const;
export const AGON_ESCROW_MAX_FEE_BPS = 1_000;
export const AGON_BPS = 10_000n;

const POSITIVE_INTEGER = /^[1-9]\d*$/;

export type AgonEscrowListing = {
  serviceRegistry: string;
  listingId: string;
  agentId: string;
  version: string;
  manifestHash: string;
  providerSnapshot: string;
  status: "Listed" | "Suspended" | "Delisted";
  verification: "Unverified" | "Pending" | "Verified" | "Expired" | "Suspended" | "Revoked";
  paymentRail: "X402" | "Escrow";
  quarantineReason?: string | null;
};

export type AgonEscrowTerms = {
  network: typeof AGON_ESCROW_NETWORK;
  asset: typeof AGON_ESCROW_USDC;
  buyer: `0x${string}`;
  beneficiary: `0x${string}`;
  listing: {
    serviceRegistry: `0x${string}`;
    listingId: string;
    agentId: string;
    version: string;
    manifestHash: `0x${string}`;
  };
  amountBaseUnits: bigint;
  feeBps: number;
  expiresAt: Date;
};

export type AgonEscrowIntentState =
  | "prepared"
  | "funding"
  | "funded"
  | "release_pending"
  | "released"
  | "refund_pending"
  | "refunded"
  | "unknown"
  | "failed";

export type AgonEscrowIntent = {
  intentId: string;
  idempotencyKey: string;
  termsHash: `0x${string}`;
  terms: AgonEscrowTerms;
  state: AgonEscrowIntentState;
  providerReference: string | null;
  transaction: `0x${string}` | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AgonEscrowErrorCode =
  | "escrow_not_eligible"
  | "invalid_escrow_terms"
  | "idempotency_conflict"
  | "escrow_intent_not_found"
  | "invalid_transition"
  | "escrow_disabled"
  | "escrow_unavailable";

export type AgonEscrowError = { code: AgonEscrowErrorCode; message: string };
export type AgonEscrowResult<T> = { ok: true; value: T } | { ok: false; error: AgonEscrowError };

function error(code: AgonEscrowErrorCode, message: string): { ok: false; error: AgonEscrowError } {
  return { ok: false, error: { code, message } };
}

function address(value: string): `0x${string}` | null {
  try {
    return getAddress(value) as `0x${string}`;
  } catch {
    return null;
  }
}

function positiveAmount(value: string | bigint): bigint | null {
  try {
    if (typeof value === "string" && !POSITIVE_INTEGER.test(value)) return null;
    const amount = typeof value === "bigint" ? value : BigInt(value);
    return amount > 0n ? amount : null;
  } catch {
    return null;
  }
}

function validDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}

function cloneTerms(terms: AgonEscrowTerms): AgonEscrowTerms {
  return { ...terms, listing: { ...terms.listing }, expiresAt: new Date(terms.expiresAt) };
}

function validTerms(terms: AgonEscrowTerms, now: Date): boolean {
  return terms.network === AGON_ESCROW_NETWORK
    && terms.asset.toLowerCase() === AGON_ESCROW_USDC.toLowerCase()
    && Boolean(address(terms.buyer))
    && Boolean(address(terms.beneficiary))
    && Boolean(address(terms.listing.serviceRegistry))
    && POSITIVE_INTEGER.test(terms.listing.listingId)
    && POSITIVE_INTEGER.test(terms.listing.agentId)
    && POSITIVE_INTEGER.test(terms.listing.version)
    && /^0x[a-fA-F0-9]{64}$/.test(terms.listing.manifestHash)
    && positiveAmount(terms.amountBaseUnits) === terms.amountBaseUnits
    && Number.isInteger(terms.feeBps)
    && terms.feeBps >= 0
    && terms.feeBps <= AGON_ESCROW_MAX_FEE_BPS
    && validDate(terms.expiresAt)
    && terms.expiresAt > now;
}

export function isAgonEscrowTransitionAllowed(from: AgonEscrowIntentState, to: AgonEscrowIntentState): boolean {
  const allowed: Record<AgonEscrowIntentState, readonly AgonEscrowIntentState[]> = {
    prepared: ["funding", "failed"],
    funding: ["funded", "unknown", "failed"],
    funded: ["release_pending", "refund_pending", "unknown"],
    release_pending: ["released", "unknown", "failed"],
    refund_pending: ["refunded", "unknown", "failed"],
    // Unknown outcomes can only be advanced by an independent reconciliation
    // result, never by replaying the provider write.
    unknown: ["funded", "release_pending", "refund_pending", "failed"],
    released: ["released"],
    refunded: ["refunded"],
    failed: ["failed"],
  };
  return allowed[from].includes(to);
}

export function evaluateAgonEscrowTerms(input: {
  listing: AgonEscrowListing;
  buyer: string;
  amountBaseUnits: string | bigint;
  feeBps: number;
  now?: Date;
  expiresAt: Date;
}): AgonEscrowResult<AgonEscrowTerms> {
  const serviceRegistry = address(input.listing.serviceRegistry);
  const providerSnapshot = address(input.listing.providerSnapshot);
  const buyer = address(input.buyer);
  if (!serviceRegistry || !providerSnapshot || !buyer) return error("invalid_escrow_terms", "escrow addresses are invalid");
  if (!POSITIVE_INTEGER.test(input.listing.listingId) || !POSITIVE_INTEGER.test(input.listing.agentId) || !POSITIVE_INTEGER.test(input.listing.version)) {
    return error("invalid_escrow_terms", "listing, agent, and version identifiers must be positive integers");
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(input.listing.manifestHash)) return error("invalid_escrow_terms", "manifest hash must be a bytes32 value");
  if (input.listing.status !== "Listed" || input.listing.verification !== "Verified" || input.listing.paymentRail !== "Escrow" || input.listing.quarantineReason) {
    return error("escrow_not_eligible", "escrow requires a listed, verified listing whose payment rail is Escrow");
  }
  const amount = positiveAmount(input.amountBaseUnits);
  if (amount === null) return error("invalid_escrow_terms", "escrow amount must be a positive integer base-unit value");
  if (!Number.isInteger(input.feeBps) || input.feeBps < 0 || input.feeBps > AGON_ESCROW_MAX_FEE_BPS) {
    return error("invalid_escrow_terms", `escrow fee must be between 0 and ${AGON_ESCROW_MAX_FEE_BPS} basis points`);
  }
  const now = input.now ?? new Date();
  if (!validDate(now) || !validDate(input.expiresAt) || input.expiresAt <= now) return error("invalid_escrow_terms", "escrow expiry must be in the future");
  return {
    ok: true,
    value: {
      network: AGON_ESCROW_NETWORK,
      asset: AGON_ESCROW_USDC,
      buyer,
      beneficiary: providerSnapshot,
      listing: {
        serviceRegistry,
        listingId: input.listing.listingId,
        agentId: input.listing.agentId,
        version: input.listing.version,
        manifestHash: input.listing.manifestHash.toLowerCase() as `0x${string}`,
      },
      amountBaseUnits: amount,
      feeBps: input.feeBps,
      expiresAt: new Date(input.expiresAt),
    },
  };
}

export function hashAgonEscrowTerms(terms: AgonEscrowTerms): `0x${string}` {
  return keccak256(stringToHex(canonicalizeManifest({
    ...terms,
    amountBaseUnits: terms.amountBaseUnits.toString(),
    expiresAt: terms.expiresAt.toISOString(),
  })));
}

export class AgonEscrowIntentLedger {
  private readonly intents = new Map<string, AgonEscrowIntent>();

  prepare(input: {
    intentId: string;
    idempotencyKey: string;
    terms: AgonEscrowTerms;
    now?: Date;
  }): AgonEscrowResult<{ decision: "prepared" | "idempotent_replay"; intent: AgonEscrowIntent }> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(input.intentId) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(input.idempotencyKey)) {
      return error("invalid_escrow_terms", "intent and idempotency keys must be 8-128 safe characters");
    }
    const now = input.now ?? new Date();
    if (!validDate(now) || !validTerms(input.terms, now)) return error("invalid_escrow_terms", "escrow terms are not pinned to the approved network, asset, identities, or economics");
    const termsHash = hashAgonEscrowTerms(input.terms);
    const existing = this.intents.get(input.idempotencyKey);
    if (existing) {
      if (existing.intentId !== input.intentId || existing.termsHash.toLowerCase() !== termsHash.toLowerCase()) return error("idempotency_conflict", "escrow idempotency key is bound to different terms");
      return { ok: true, value: { decision: "idempotent_replay", intent: existing } };
    }
    const intent: AgonEscrowIntent = {
      intentId: input.intentId,
      idempotencyKey: input.idempotencyKey,
      termsHash,
      terms: cloneTerms(input.terms),
      state: "prepared",
      providerReference: null,
      transaction: null,
      createdAt: now,
      updatedAt: now,
    };
    this.intents.set(input.idempotencyKey, intent);
    return { ok: true, value: { decision: "prepared", intent } };
  }

  get(idempotencyKey: string): AgonEscrowIntent | null {
    return this.intents.get(idempotencyKey) ?? null;
  }

  transition(input: {
    idempotencyKey: string;
    state: Exclude<AgonEscrowIntentState, "prepared">;
    now?: Date;
    providerReference?: string | null;
    transaction?: `0x${string}` | null;
  }): AgonEscrowResult<AgonEscrowIntent> {
    const intent = this.intents.get(input.idempotencyKey);
    if (!intent) return error("escrow_intent_not_found", "escrow intent does not exist");
    if (!isAgonEscrowTransitionAllowed(intent.state, input.state)) return error("invalid_transition", `cannot transition escrow intent from ${intent.state} to ${input.state}`);
    const now = input.now ?? new Date();
    if (!validDate(now)) return error("invalid_escrow_terms", "escrow transition timestamp is invalid");
    intent.state = input.state;
    intent.updatedAt = now;
    if (input.providerReference !== undefined) intent.providerReference = input.providerReference;
    if (input.transaction !== undefined) intent.transaction = input.transaction;
    return { ok: true, value: intent };
  }
}

export type AgonPrizeWinner = { beneficiary: string; rank: number; weightBps: number };
export type AgonPrizeShare = { beneficiary: `0x${string}`; rank: number; amountBaseUnits: bigint };

export function allocateAgonPrizePool(input: {
  poolBaseUnits: string | bigint;
  platformFeeBps: number;
  winners: readonly AgonPrizeWinner[];
}): AgonEscrowResult<{ poolBaseUnits: bigint; platformFeeBaseUnits: bigint; shares: AgonPrizeShare[] }> {
  const pool = positiveAmount(input.poolBaseUnits);
  if (pool === null) return error("invalid_escrow_terms", "prize pool must be a positive integer base-unit value");
  if (!Number.isInteger(input.platformFeeBps) || input.platformFeeBps < 0 || input.platformFeeBps > AGON_ESCROW_MAX_FEE_BPS) return error("invalid_escrow_terms", "prize platform fee is outside the allowed cap");
  if (input.winners.length === 0) return error("invalid_escrow_terms", "prize distribution requires at least one winner");
  const seen = new Set<string>();
  let weight = 0;
  let topRank = Number.MAX_SAFE_INTEGER;
  let topIndex = -1;
  const winners: { beneficiary: `0x${string}`; rank: number; weightBps: number }[] = [];
  for (const winner of input.winners) {
    const beneficiary = address(winner.beneficiary);
    if (!beneficiary || !Number.isInteger(winner.rank) || winner.rank <= 0 || !Number.isInteger(winner.weightBps) || winner.weightBps <= 0 || seen.has(beneficiary.toLowerCase())) return error("invalid_escrow_terms", "prize winners must have unique addresses, positive ranks, and positive weights");
    seen.add(beneficiary.toLowerCase());
    weight += winner.weightBps;
    winners.push({ beneficiary, rank: winner.rank, weightBps: winner.weightBps });
    if (winner.rank < topRank) {
      topRank = winner.rank;
      topIndex = winners.length - 1;
    }
  }
  if (weight !== Number(AGON_BPS)) return error("invalid_escrow_terms", "prize winner weights must total 10000 basis points");
  const platformFeeBaseUnits = (pool * BigInt(input.platformFeeBps)) / AGON_BPS;
  const distributable = pool - platformFeeBaseUnits;
  const shares = winners.map((winner) => ({ beneficiary: winner.beneficiary, rank: winner.rank, amountBaseUnits: (distributable * BigInt(winner.weightBps)) / AGON_BPS }));
  const assigned = shares.reduce((sum, share) => sum + share.amountBaseUnits, 0n);
  shares[topIndex]!.amountBaseUnits += distributable - assigned;
  return { ok: true, value: { poolBaseUnits: pool, platformFeeBaseUnits, shares } };
}

export type AgonEscrowAdapter = {
  enabled: boolean;
  fund(input: { intentId: string; terms: AgonEscrowTerms }): Promise<AgonEscrowResult<{ providerReference: string | null; transaction: `0x${string}` | null }>>;
  release(input: { intentId: string; beneficiary: `0x${string}`; amountBaseUnits: bigint }): Promise<AgonEscrowResult<{ providerReference: string | null; transaction: `0x${string}` | null }>>;
  refund(input: { intentId: string; buyer: `0x${string}`; amountBaseUnits: bigint }): Promise<AgonEscrowResult<{ providerReference: string | null; transaction: `0x${string}` | null }>>;
};

/** No PrizeEscrow, Circle, RPC, or USDC call can escape this disabled seam. */
export function createDisabledAgonEscrowAdapter(): AgonEscrowAdapter {
  const disabled = async (): Promise<AgonEscrowResult<{ providerReference: string | null; transaction: `0x${string}` | null }>> => error("escrow_disabled", "Agon escrow execution is disabled by policy");
  return { enabled: false, fund: disabled, release: disabled, refund: disabled };
}
