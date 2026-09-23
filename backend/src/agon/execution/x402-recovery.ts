import type { StoredX402CallReceipt } from "../store/repository.ts";
import { AGON_X402_TESTNET_NETWORK } from "./x402-facilitator.ts";
import {
  isX402ProviderTransferId,
  isX402Transaction,
  validateX402ReceiptLookupResult,
  type X402ReceiptLookupAdapter,
  type X402ReceiptLookupRequest,
} from "./x402-reconciliation.ts";

const ARC_USDC = "0x3600000000000000000000000000000000000000";
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;

export type X402RecoveryReference = {
  transaction?: string | null;
  providerTransferId?: string | null;
};

export type X402RecoveryProbeResult =
  | {
      ok: true;
      value: {
        status: "confirmed" | "pending" | "failed";
        transaction: `0x${string}` | null;
        providerTransferId: string | null;
        payer: `0x${string}`;
        recipient: `0x${string}`;
        amountAtomicUnits: string;
        correlation: "terms_only";
        mayAutoFinalize: false;
      };
    }
  | {
      ok: false;
      error: {
        code: "not_recoverable" | "invalid_reference" | "missing_authorization" | "lookup_disabled" | "lookup_unavailable" | "evidence_mismatch";
        message: string;
      };
    };

function fail(code: Extract<X402RecoveryProbeResult, { ok: false }>["error"]["code"], message: string): X402RecoveryProbeResult {
  return { ok: false, error: { code, message } };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function expectedTerms(receipt: StoredX402CallReceipt): X402ReceiptLookupRequest["expected"] | null {
  if (!HASH.test(receipt.quoteHash ?? "") || !HASH.test(receipt.authorizationPayloadHash ?? "") || !HASH.test(receipt.authorizationHash ?? "")) return null;
  const authorization = record(receipt.authorizationPayload);
  const domain = record(authorization?.domain);
  const message = record(authorization?.message);
  const quote = record(receipt.quoteSnapshot);
  if (authorization?.x402Version !== 2 || authorization.primaryType !== "TransferWithAuthorization"
    || domain?.name !== "GatewayWalletBatched" || domain.version !== "1" || domain.chainId !== 5_042_002
    || !message || !HASH.test(String(message.nonce ?? ""))) return null;
  const from = message.from;
  const to = message.to;
  const value = message.value;
  if (typeof from !== "string" || !ADDRESS.test(from) || typeof to !== "string" || !ADDRESS.test(to)
    || typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) return null;
  if (!Array.isArray(quote?.accepts)) return null;
  const matches = quote.accepts.filter((item: unknown) => {
    const option = record(item);
    return option?.network === AGON_X402_TESTNET_NETWORK && option.scheme === "exact"
      && typeof option.asset === "string" && option.asset.toLowerCase() === ARC_USDC
      && typeof option.payTo === "string" && option.payTo.toLowerCase() === to.toLowerCase()
      && typeof option.amount === "string" && option.amount === value;
  });
  if (matches.length !== 1) return null;
  return { payer: from as `0x${string}`, recipient: to as `0x${string}`, amountAtomicUnits: value };
}

/**
 * Checks a supplied reference against a read-only payment source and the saved
 * authorization terms. The current lookup adapter does not expose the signed
 * authorization nonce, so matching terms alone cannot attach this payment to
 * an intent, retry delivery, or finalize the receipt.
 */
export async function probeX402RecoveryCandidate(input: {
  receipt: StoredX402CallReceipt;
  reference: X402RecoveryReference;
  lookup: X402ReceiptLookupAdapter;
}): Promise<X402RecoveryProbeResult> {
  const { receipt, reference, lookup } = input;
  const markerPrefix = `agon-x402:${receipt.intentId}:`;
  const marker = receipt.settlementRef ?? "";
  if (!["unknown", "settlement_submitted", "service_delivered"].includes(receipt.state)
    || isX402Transaction(receipt.settlementRef ?? "")
    || isX402ProviderTransferId(receipt.providerTransferId ?? "")
    || !marker.toLowerCase().startsWith(markerPrefix.toLowerCase())
    || !HASH.test(marker.slice(markerPrefix.length))) {
    return fail("not_recoverable", "receipt is not an unresolved payment attempt without a trusted reference");
  }
  const transaction = reference.transaction ?? null;
  const providerTransferId = reference.providerTransferId ?? null;
  if ((transaction !== null) === (providerTransferId !== null)
    || (transaction !== null && !isX402Transaction(transaction))
    || (providerTransferId !== null && !isX402ProviderTransferId(providerTransferId))) {
    return fail("invalid_reference", "supply one Arc transaction hash or Circle transfer UUID");
  }
  const expected = expectedTerms(receipt);
  if (!expected) return fail("missing_authorization", "saved authorization and quote terms are incomplete or inconsistent");
  if (!lookup.enabled) return fail("lookup_disabled", "read-only Arc payment lookup is disabled");
  const request: X402ReceiptLookupRequest = {
    network: AGON_X402_TESTNET_NETWORK,
    transaction: transaction as `0x${string}` | null,
    providerTransferId,
    expected,
  };
  let response: Awaited<ReturnType<X402ReceiptLookupAdapter["lookup"]>>;
  try {
    response = await lookup.lookup(request);
  } catch {
    return fail("lookup_unavailable", "read-only payment lookup failed; receipt remains unresolved");
  }
  try {
    const evidence = validateX402ReceiptLookupResult(response, request);
    if (!evidence.payer || !evidence.recipient || !evidence.amountAtomicUnits) {
      return fail("evidence_mismatch", "payment source did not return payer, recipient, and amount");
    }
    return {
      ok: true,
      value: {
        status: evidence.status,
        transaction: evidence.transaction ?? null,
        providerTransferId: evidence.providerTransferId ?? null,
        payer: evidence.payer,
        recipient: evidence.recipient,
        amountAtomicUnits: evidence.amountAtomicUnits,
        correlation: "terms_only",
        mayAutoFinalize: false,
      },
    };
  } catch (error) {
    return fail("evidence_mismatch", error instanceof Error ? error.message : "payment evidence does not match the saved terms");
  }
}
