import { AGON_X402_TESTNET_NETWORK } from "./x402-facilitator.ts";

const CIRCLE_TESTNET_GATEWAY = "https://gateway-api-testnet.circle.com";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;

export type X402ReceiptLookupRequest = {
  network: typeof AGON_X402_TESTNET_NETWORK;
  transaction?: `0x${string}` | null;
  providerTransferId?: string | null;
  expected?: { payer?: `0x${string}` | null; recipient?: `0x${string}` | null; amountAtomicUnits?: string | null };
};

export type X402ReceiptLookupResult = {
  network: typeof AGON_X402_TESTNET_NETWORK;
  transaction?: `0x${string}` | null;
  providerTransferId?: string | null;
  status: "confirmed" | "pending" | "failed";
  payer?: `0x${string}` | null;
  recipient?: `0x${string}` | null;
  amountAtomicUnits?: string | null;
  blockNumber?: string;
  reason?: string;
};

export type X402ReceiptLookupAdapter = { readonly enabled: boolean; lookup(input: X402ReceiptLookupRequest): Promise<X402ReceiptLookupResult> };
export type CircleX402TransferStatus = "received" | "batched" | "confirmed" | "completed" | "failed";

type CircleX402Transfer = { id: string; status: CircleX402TransferStatus; token: "USDC"; sendingNetwork: string; recipientNetwork: string; fromAddress: string; toAddress: string; amount: string; createdAt: string; updatedAt: string };

function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }

export function isX402Transaction(value: string): value is `0x${string}` { return /^0x[0-9a-fA-F]{64}$/.test(value); }
export function isX402ProviderTransferId(value: string): boolean { return UUID.test(value); }

function requireReference(input: X402ReceiptLookupRequest | X402ReceiptLookupResult): void {
  if (!input.transaction && !input.providerTransferId) throw new Error("receipt lookup requires a transaction or provider transfer id");
  if (input.transaction !== undefined && input.transaction !== null && !isX402Transaction(input.transaction)) throw new Error("receipt lookup transaction must be a 32-byte hash");
  if (input.providerTransferId !== undefined && input.providerTransferId !== null && !isX402ProviderTransferId(input.providerTransferId)) throw new Error("receipt lookup provider transfer id must be a UUID");
}

export function validateX402ReceiptLookupResult(input: X402ReceiptLookupResult, request: X402ReceiptLookupRequest): X402ReceiptLookupResult {
  if (input.network !== AGON_X402_TESTNET_NETWORK || request.network !== AGON_X402_TESTNET_NETWORK) throw new Error("receipt lookup must remain on Arc Testnet");
  requireReference(request); requireReference(input);
  if (request.transaction && (!input.transaction || input.transaction.toLowerCase() !== request.transaction.toLowerCase())) throw new Error("receipt lookup returned a different transaction");
  if (request.providerTransferId && input.providerTransferId?.toLowerCase() !== request.providerTransferId.toLowerCase()) throw new Error("receipt lookup returned a different provider transfer id");
  if (input.blockNumber !== undefined && !/^0x[0-9a-fA-F]+$/.test(input.blockNumber) && !/^\d+$/.test(input.blockNumber)) throw new Error("receipt lookup block number is invalid");
  if (input.reason !== undefined && (input.reason.length === 0 || input.reason.length > 512)) throw new Error("receipt lookup reason must be 1-512 characters");
  if (input.payer !== undefined && input.payer !== null && !ADDRESS.test(input.payer)) throw new Error("receipt lookup payer is invalid");
  if (input.recipient !== undefined && input.recipient !== null && !ADDRESS.test(input.recipient)) throw new Error("receipt lookup recipient is invalid");
  if (input.amountAtomicUnits !== undefined && input.amountAtomicUnits !== null && !/^\d+$/.test(input.amountAtomicUnits)) throw new Error("receipt lookup amount is invalid");
  if (request.expected?.payer && input.payer?.toLowerCase() !== request.expected.payer.toLowerCase()) throw new Error("receipt lookup payer does not match authorization");
  if (request.expected?.recipient && input.recipient?.toLowerCase() !== request.expected.recipient.toLowerCase()) throw new Error("receipt lookup recipient does not match quote");
  if (request.expected?.amountAtomicUnits && input.amountAtomicUnits !== request.expected.amountAtomicUnits) throw new Error("receipt lookup amount does not match quote");
  return { ...input, transaction: input.transaction ? input.transaction.toLowerCase() as `0x${string}` : input.transaction, providerTransferId: input.providerTransferId?.toLowerCase() ?? input.providerTransferId, payer: input.payer?.toLowerCase() as `0x${string}` | null | undefined, recipient: input.recipient?.toLowerCase() as `0x${string}` | null | undefined };
}

function mapCircleStatus(status: CircleX402TransferStatus): X402ReceiptLookupResult["status"] {
  if (status === "failed") return "failed";
  if (status === "confirmed" || status === "completed") return "confirmed";
  return "pending";
}

function parseCircleTransfer(value: unknown): CircleX402Transfer {
  if (!isRecord(value) || typeof value.id !== "string" || !isX402ProviderTransferId(value.id) || !["received", "batched", "confirmed", "completed", "failed"].includes(value.status as string) || value.token !== "USDC" || typeof value.sendingNetwork !== "string" || typeof value.recipientNetwork !== "string" || typeof value.fromAddress !== "string" || typeof value.toAddress !== "string" || typeof value.amount !== "string" || !/^\d+$/.test(value.amount) || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") throw new Error("Circle returned an invalid x402 transfer");
  return value as CircleX402Transfer;
}

/** No provider or RPC call is made by this default adapter. */
export function createDisabledX402ReceiptLookupAdapter(): X402ReceiptLookupAdapter { return { enabled: false, async lookup(): Promise<X402ReceiptLookupResult> { throw new Error("Arc Testnet receipt lookup is disabled by policy"); } }; }

/** Read-only Circle Gateway transfer lookup. It is not wired by default. */
export function createCircleTestnetX402ReceiptLookupAdapter(options: { enabled: boolean; fetchImpl?: typeof fetch; baseUrl?: string; timeoutMs?: number; failureThreshold?: number; cooldownMs?: number }): X402ReceiptLookupAdapter {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? CIRCLE_TESTNET_GATEWAY).replace(/\/$/, "");
  const timeoutMs = Math.max(250, Math.min(options.timeoutMs ?? 5000, 15000));
  const failureThreshold = Math.max(1, Math.min(options.failureThreshold ?? 3, 10));
  const cooldownMs = Math.max(1000, Math.min(options.cooldownMs ?? 30000, 300000));
  let failures = 0; let openedUntil = 0;
  return { enabled: options.enabled === true, async lookup(input): Promise<X402ReceiptLookupResult> {
    if (options.enabled !== true) throw new Error("Arc Testnet receipt lookup is disabled by policy");
    if (input.network !== AGON_X402_TESTNET_NETWORK) throw new Error("Circle receipt lookup is Arc Testnet-only");
    if (!input.providerTransferId || !isX402ProviderTransferId(input.providerTransferId)) throw new Error("Circle receipt lookup requires a provider transfer UUID");
    if (Date.now() < openedUntil) throw new Error("Circle receipt lookup circuit is open");
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}/v1/x402/transfers/${encodeURIComponent(input.providerTransferId)}`, { method: "GET", headers: { accept: "application/json" }, signal: controller.signal });
      const text = await response.text();
      if (!response.ok) throw new Error(`Circle receipt lookup returned HTTP ${response.status}`);
      if (Buffer.byteLength(text, "utf8") > 64 * 1024) throw new Error("Circle receipt lookup response exceeds 64 KiB");
      const transfer = parseCircleTransfer(JSON.parse(text));
      const network = transfer.sendingNetwork === AGON_X402_TESTNET_NETWORK && transfer.recipientNetwork === AGON_X402_TESTNET_NETWORK ? AGON_X402_TESTNET_NETWORK : transfer.sendingNetwork as typeof AGON_X402_TESTNET_NETWORK;
      const result = validateX402ReceiptLookupResult({ network, providerTransferId: transfer.id, transaction: null, status: mapCircleStatus(transfer.status), payer: transfer.fromAddress as `0x${string}`, recipient: transfer.toAddress as `0x${string}`, amountAtomicUnits: transfer.amount, reason: `Circle transfer status: ${transfer.status}` }, input);
      failures = 0; openedUntil = 0; return result;
    } catch (error) {
      failures += 1; if (failures >= failureThreshold) openedUntil = Date.now() + cooldownMs;
      throw new Error(error instanceof Error ? error.message : "Circle receipt lookup failed");
    } finally { clearTimeout(timer); }
  } };
}
