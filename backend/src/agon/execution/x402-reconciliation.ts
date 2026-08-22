import { AGON_X402_TESTNET_NETWORK } from "./x402-facilitator.ts";

/**
 * The provider receipt lookup seam is intentionally read-only. Circle's
 * installed x402 client exposes verify, settle, and supported-kind calls, but
 * no receipt lookup method. Keeping this contract separate prevents a future
 * adapter from treating a settlement response as finality evidence.
 */
export type X402ReceiptLookupRequest = {
  network: typeof AGON_X402_TESTNET_NETWORK;
  transaction: `0x${string}`;
};

export type X402ReceiptLookupResult = {
  network: typeof AGON_X402_TESTNET_NETWORK;
  transaction: `0x${string}`;
  status: "confirmed" | "pending" | "failed";
  blockNumber?: string;
  reason?: string;
};

export type X402ReceiptLookupAdapter = {
  readonly enabled: boolean;
  lookup(input: X402ReceiptLookupRequest): Promise<X402ReceiptLookupResult>;
};

export function isX402Transaction(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function validateX402ReceiptLookupResult(
  input: X402ReceiptLookupResult,
  request: X402ReceiptLookupRequest,
): X402ReceiptLookupResult {
  if (input.network !== AGON_X402_TESTNET_NETWORK || request.network !== AGON_X402_TESTNET_NETWORK) {
    throw new Error("receipt lookup must remain on Arc Testnet");
  }
  if (!isX402Transaction(request.transaction) || !isX402Transaction(input.transaction)) {
    throw new Error("receipt lookup transaction must be a 32-byte hash");
  }
  if (input.transaction.toLowerCase() !== request.transaction.toLowerCase()) {
    throw new Error("receipt lookup returned a different transaction");
  }
  if (input.blockNumber !== undefined && !/^0x[0-9a-fA-F]+$/.test(input.blockNumber) && !/^\d+$/.test(input.blockNumber)) {
    throw new Error("receipt lookup block number is invalid");
  }
  if (input.reason !== undefined && (input.reason.length === 0 || input.reason.length > 512)) {
    throw new Error("receipt lookup reason must be 1-512 characters");
  }
  return { ...input, transaction: input.transaction.toLowerCase() as `0x${string}` };
}

/** No provider or RPC call is made by this default adapter. */
export function createDisabledX402ReceiptLookupAdapter(): X402ReceiptLookupAdapter {
  return {
    enabled: false,
    async lookup(): Promise<X402ReceiptLookupResult> {
      throw new Error("Arc Testnet receipt lookup is disabled by policy");
    },
  };
}
