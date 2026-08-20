import { keccak256, stringToHex } from "viem";

const MAX_HEADER_BYTES = 64 * 1024;
const MAX_ACCEPTS = 16;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const AMOUNT = /^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/;

export type X402QuoteRequirement = {
  scheme: "exact";
  network: string;
  asset: `0x${string}`;
  amount: string;
  maxTimeoutSeconds: number;
  payTo: `0x${string}`;
  extra: { name: "GatewayWalletBatched"; version?: string; verifyingContract?: `0x${string}`; [key: string]: unknown };
};

export type X402QuoteSnapshot = {
  x402Version: 2;
  resource: { url: string; description?: string; mimeType?: string };
  accepts: X402QuoteRequirement[];
};

export type ParsedX402Quote = {
  snapshot: X402QuoteSnapshot;
  quoteHash: `0x${string}`;
};

export type X402QuoteParseError = { code: "invalid_quote"; message: string };

function fail(message: string): { ok: false; error: X402QuoteParseError } {
  return { ok: false, error: { code: "invalid_quote", message } };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function decodeHeader(header: string): unknown {
  const decoded = Buffer.from(header, "base64").toString("utf8");
  try {
    return JSON.parse(decoded);
  } catch {
    return JSON.parse(header);
  }
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("quote contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const object = record(value);
  if (!object) throw new Error("quote contains a non-JSON value");
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(",")}}`;
}

function microUsdc(value: string): bigint {
  if (!AMOUNT.test(value)) throw new Error("invalid USDC amount");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

export function parsePaymentRequiredHeader(
  header: string | null,
  targetUrl: string,
  chainId: string,
  approvedAmountUSDC: string,
): { ok: true; value: ParsedX402Quote } | { ok: false; error: X402QuoteParseError } {
  if (!header) return fail("provider did not return a PAYMENT-REQUIRED header");
  if (Buffer.byteLength(header, "utf8") > MAX_HEADER_BYTES) return fail("PAYMENT-REQUIRED exceeds the 64 KiB limit");
  let raw: unknown;
  try {
    raw = decodeHeader(header);
  } catch {
    return fail("PAYMENT-REQUIRED is not valid base64 JSON");
  }
  const root = record(raw);
  const resource = record(root?.resource);
  const accepts = root?.accepts;
  if (root?.x402Version !== 2 || !resource || !Array.isArray(accepts) || accepts.length === 0 || accepts.length > MAX_ACCEPTS) {
    return fail("PAYMENT-REQUIRED must be an x402 v2 quote with 1-16 options");
  }
  if (typeof resource.url !== "string" || !resource.url || resource.url !== targetUrl) return fail("quote resource does not match the prepared endpoint");
  const description = resource.description === undefined ? undefined : resource.description;
  const mimeType = resource.mimeType === undefined ? undefined : resource.mimeType;
  if (description !== undefined && typeof description !== "string") return fail("quote resource description must be text");
  if (mimeType !== undefined && typeof mimeType !== "string") return fail("quote resource mimeType must be text");
  let approved: bigint;
  try { approved = microUsdc(approvedAmountUSDC); } catch { return fail("approved spend limit is invalid"); }
  const normalized: X402QuoteRequirement[] = [];
  for (const option of accepts) {
    const value = record(option);
    const extra = record(value?.extra);
    if (!value || value.scheme !== "exact" || typeof value.network !== "string" || value.network !== `eip155:${chainId}`) return fail("quote must use the prepared EVM network and exact scheme");
    if (typeof value.asset !== "string" || !ADDRESS.test(value.asset) || typeof value.payTo !== "string" || !ADDRESS.test(value.payTo)) return fail("quote asset and payTo must be EVM addresses");
    if (typeof value.amount !== "string" || !AMOUNT.test(value.amount)) return fail("quote amount must be a canonical USDC amount");
    let amount: bigint;
    try { amount = microUsdc(value.amount); } catch { return fail("quote amount is invalid"); }
    if (amount <= 0n || amount > approved) return fail("quote amount exceeds the approved spend limit");
    const maxTimeoutSeconds = value.maxTimeoutSeconds;
    if (typeof maxTimeoutSeconds !== "number" || !Number.isSafeInteger(maxTimeoutSeconds) || maxTimeoutSeconds <= 0 || maxTimeoutSeconds > 31_536_000) return fail("quote timeout is outside the supported range");
    if (!extra || extra.name !== "GatewayWalletBatched") return fail("quote is missing Circle Gateway batching metadata");
    const extraCopy: Record<string, unknown> & { name: "GatewayWalletBatched" } = { ...extra, name: "GatewayWalletBatched" };
    const verifyingContract = extraCopy["verifyingContract"];
    if (verifyingContract !== undefined && (typeof verifyingContract !== "string" || !ADDRESS.test(verifyingContract))) return fail("Gateway verifyingContract must be an EVM address");
    normalized.push({
      scheme: "exact",
      network: value.network,
      asset: value.asset.toLowerCase() as `0x${string}`,
      amount: value.amount,
      maxTimeoutSeconds,
      payTo: value.payTo.toLowerCase() as `0x${string}`,
      extra: extraCopy as X402QuoteRequirement["extra"],
    });
  }
  const snapshot: X402QuoteSnapshot = {
    x402Version: 2,
    resource: {
      url: resource.url,
      ...(description === undefined ? {} : { description }),
      ...(mimeType === undefined ? {} : { mimeType }),
    },
    accepts: normalized,
  };
  try {
    const canonical = canonicalize(snapshot);
    if (Buffer.byteLength(canonical, "utf8") > MAX_HEADER_BYTES) return fail("normalized quote exceeds the 64 KiB limit");
    return { ok: true, value: { snapshot, quoteHash: keccak256(stringToHex(canonical)) } };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "quote is not canonical JSON");
  }
}
