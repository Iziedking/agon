// Pure commerce rules. The HTTP API and the proof script consume the same
// builders so a prepared wallet request can be reproduced without a browser.
import { encodeFunctionData, erc20Abi, getAddress, isAddress, parseAbi, type Address } from "viem";
import { exactTokenAmount, sameAddress } from "./commerce-core.ts";
import { parseAgentId, type CommerceStep, type PreparedCommerceTransaction } from "../types.ts";
import { parseLpInput, type LpInput } from "../providers/lp-core.ts";

export const LP_QUOTE_TTL_SECONDS = 600;
export const LP_EXECUTION_BUFFER_SECONDS = 3600n;
export const COMMERCE_WRITE_ABI = parseAbi([
  "function createJob(address provider,address evaluator,uint256 expiredAt,string description,address hook) returns (uint256 jobId)",
  "function fund(uint256 jobId,uint256 expectedBudget,bytes optParams)",
]);
export const ROUTER_WRITE_ABI = parseAbi([
  "function registerJob(uint256 jobId,address policy)",
]);

export type LpCommerceConfig = {
  agentId: string;
  providerAddress: Address;
  priceRaw: string;
  publicUrl: string;
  dailyIntentLimit: number;
};

export type LpCommerceConfigResult =
  | { ready: true; config: LpCommerceConfig }
  | { ready: false; blockers: string[] };

function positiveBoundedInteger(value: string | undefined, fallback: number, max: number): number | null {
  const raw = value?.trim() || String(fallback);
  if (!/^[1-9][0-9]*$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed <= max ? parsed : null;
}

export function lpCommerceConfig(env: Readonly<Record<string, string | undefined>>): LpCommerceConfigResult {
  const blockers: string[] = [];
  if (env.BNB_LP_AGENT_HIRING_ENABLED !== "true") blockers.push("hiring_flag_disabled");
  let agentId: string | null = null;
  try { agentId = parseAgentId(env.BNB_LP_AGENT_ID?.trim()); }
  catch { blockers.push("agent_identity_unconfigured"); }
  const rawAddress = env.BNB_LP_AGENT_ADDRESS?.trim();
  const providerAddress = rawAddress && isAddress(rawAddress) ? getAddress(rawAddress) : null;
  if (!providerAddress) blockers.push("provider_wallet_unconfigured");
  const priceRaw = exactTokenAmount(env.BNB_LP_AGENT_PRICE_RAW?.trim());
  if (!priceRaw || BigInt(priceRaw) === 0n) blockers.push("exact_price_unconfigured");
  let publicUrl: string | null = null;
  try {
    const parsed = new URL(env.BNB_LP_AGENT_PUBLIC_URL?.trim() ?? "");
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || parsed.search || parsed.port) throw new Error("invalid");
    publicUrl = parsed.href.replace(/\/$/, "");
  } catch { blockers.push("public_provider_url_unconfigured"); }
  if (!env.ALTANA_SESSION?.trim() && !env.ALTANA_SESSION_FILE?.trim()) blockers.push("altana_session_unconfigured");
  const dailyIntentLimit = positiveBoundedInteger(env.BNB_LP_AGENT_HIRE_DAILY_LIMIT, 25, 250);
  if (dailyIntentLimit === null) blockers.push("invalid_hire_daily_limit");
  if (blockers.length || !agentId || !providerAddress || !priceRaw || !publicUrl || dailyIntentLimit === null) {
    return { ready: false, blockers };
  }
  return { ready: true, config: { agentId, providerAddress, priceRaw, publicUrl, dailyIntentLimit } };
}

export function parseCommerceIntentId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("A version-4 UUID intent ID is required for safe retries.");
  }
  return value.toLowerCase();
}

export function lpNegotiationRequest(intentId: string, rawInput: unknown, binding?: {
  serviceVersion: string; registrationHash: string;
}): { input: LpInput; request: Record<string, unknown> } {
  const id = parseCommerceIntentId(intentId);
  const input = parseLpInput(rawInput);
  const version = binding?.serviceVersion?.trim();
  const registrationHash = binding?.registrationHash?.trim();
  if (binding && (!version || version.length > 120 || !registrationHash || registrationHash.length > 160)) {
    throw new Error("A bounded service version and registration hash are required.");
  }
  return { input, request: {
    task_description: `Analyze PancakeSwap v3 position ${input.positionId} on BNB Smart Chain Testnet with ${version ?? "AGON LP Guardian"}${registrationHash ? `, registration ${registrationHash}` : ""}. Return evidence and a review-only range decision. Do not submit a liquidity transaction.`,
    terms: {
      deliverables: "A canonical JSON LP Guardian report with source block, position, pool, oracle evidence, decision and limitations.",
      quality_standards: "Read the position and pool from BNB Smart Chain Testnet at one pinned source block. Withhold a proposal when the oracle, liquidity, tick spacing or deviation checks fail.",
      success_criteria: [
        "The report identifies the source chain and block.",
        "The report hash reproduces from the exact JSON response.",
        "The executed field remains false; this service does not rebalance funds.",
      ],
      evaluation_required: true,
      evaluator_type: "optimistic",
    },
    context_urls: [],
    request_id: id,
  } };
}

export type SignedQuoteFields = {
  negotiationHash: `0x${string}`;
  providerSignature: `0x${string}`;
  quoteExpiresAt: number;
  priceRaw: string;
  currency: Address;
  chainId: 97;
  verifyingContract: Address;
};

export function signedQuoteFields(envelope: Record<string, unknown>, expected: {
  priceRaw: string; token: Address; commerce: Address;
}): SignedQuoteFields {
  const response = envelope.response;
  if (!response || typeof response !== "object" || Array.isArray(response)) throw new Error("The provider did not return an accepted quote.");
  const quote = response as Record<string, unknown>;
  const terms = quote.terms;
  if (quote.accepted !== true || !terms || typeof terms !== "object" || Array.isArray(terms)) throw new Error("The provider did not accept these terms.");
  const priced = terms as Record<string, unknown>;
  const negotiationHash = envelope.negotiation_hash;
  const providerSignature = envelope.provider_sig;
  const quoteExpiresAt = quote.quote_expires_at;
  const chainId = envelope.chain_id;
  const verifyingContract = envelope.verifying_contract;
  if (typeof negotiationHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(negotiationHash)) throw new Error("The provider quote has no valid negotiation hash.");
  if (typeof providerSignature !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(providerSignature)) throw new Error("The provider quote is unsigned.");
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(quoteExpiresAt) || Number(quoteExpiresAt) <= now) throw new Error("The provider quote has expired.");
  if (Number(quoteExpiresAt) > now + LP_QUOTE_TTL_SECONDS + 30) throw new Error("The provider quote exceeds the supported lifetime.");
  if (chainId !== 97) throw new Error("The provider quote is not bound to BNB Testnet.");
  if (typeof verifyingContract !== "string" || !sameAddress(verifyingContract, expected.commerce)) throw new Error("The provider quote is bound to a different commerce contract.");
  if (priced.price !== expected.priceRaw) throw new Error("The provider quote price differs from the configured service price.");
  if (typeof priced.currency !== "string" || !sameAddress(priced.currency, expected.token)) throw new Error("The provider quote uses a different payment token.");
  return { negotiationHash: negotiationHash as `0x${string}`, providerSignature: providerSignature as `0x${string}`,
    quoteExpiresAt: Number(quoteExpiresAt), priceRaw: expected.priceRaw, currency: expected.token,
    chainId: 97, verifyingContract: expected.commerce };
}

export function jobExpiry(now: bigint, disputeWindow: string): bigint {
  const window = exactTokenAmount(disputeWindow);
  if (!window || BigInt(window) === 0n) throw new Error("The settlement dispute window is unavailable.");
  return now + BigInt(window) + LP_EXECUTION_BUFFER_SECONDS;
}

export function preparedTransaction(step: CommerceStep, values: {
  commerce: Address; router: Address; policy: Address; token: Address; provider: Address;
  amount: bigint; description: string; expiredAt: bigint; jobId?: bigint;
}): PreparedCommerceTransaction {
  if (values.amount <= 0n) throw new Error("The exact payment amount must be positive.");
  const jobId = values.jobId;
  if (step !== "create" && jobId === undefined) throw new Error("A confirmed job ID is required for this action.");
  if (step === "create") return { step, chainId: 97, to: values.commerce,
    data: encodeFunctionData({ abi: COMMERCE_WRITE_ABI, functionName: "createJob",
      args: [values.provider, values.router, values.expiredAt, values.description, values.router] }), value: "0",
    title: "Create the protected job", warning: "This creates an open job. It does not approve or move payment tokens." };
  if (step === "register") return { step, chainId: 97, to: values.router,
    data: encodeFunctionData({ abi: ROUTER_WRITE_ABI, functionName: "registerJob", args: [jobId!, values.policy] }), value: "0",
    title: "Bind the settlement policy", warning: "This records the approved policy for this open job. It does not move funds." };
  if (step === "approve") return { step, chainId: 97, to: values.token,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [values.commerce, values.amount] }), value: "0",
    title: "Approve the exact job amount", warning: "This grants the commerce contract an allowance equal to this quote only." };
  return { step, chainId: 97, to: values.commerce,
    data: encodeFunctionData({ abi: COMMERCE_WRITE_ABI, functionName: "fund", args: [jobId!, values.amount, "0x"] }), value: "0",
    title: "Fund the protected job", warning: "This moves the quoted token amount into the ERC-8183 commerce contract." };
}
