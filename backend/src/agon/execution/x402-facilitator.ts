import { getAddress } from "viem";
import type { X402AuthorizationPayload } from "./x402-authorization.ts";
import type { X402QuoteSnapshot } from "./x402-quote.ts";

export const AGON_X402_TESTNET_NETWORK = "eip155:5042002" as const;
export const AGON_X402_TESTNET_FACILITATOR = "https://gateway-api-testnet.circle.com" as const;

export type X402ExecutionPlanError = {
  code: "execution_not_ready";
  message: string;
};

export type X402ExecutionPlan = {
  testnetOnly: true;
  facilitatorUrl: typeof AGON_X402_TESTNET_FACILITATOR;
  settlementEndpoint: `${typeof AGON_X402_TESTNET_FACILITATOR}/v1/x402/settle`;
  requirements: {
    scheme: "exact";
    network: typeof AGON_X402_TESTNET_NETWORK;
    asset: `0x${string}`;
    amount: string;
    payTo: `0x${string}`;
    maxTimeoutSeconds: number;
    extra: { name: "GatewayWalletBatched"; version: "1"; verifyingContract: `0x${string}` };
  };
  authorization: X402AuthorizationPayload["message"];
  authorizationHash: `0x${string}`;
  paymentPayloadPreview: {
    x402Version: 2;
    payload: {
      authorization: X402AuthorizationPayload["message"];
      signatureHash: `0x${string}`;
      signature: null;
    };
  };
  executionEnabled: false;
  nextAction: "explicit_execution_approval";
};

function microUsdc(value: string): bigint {
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value)) throw new Error("approved spend limit is invalid");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

function fail(message: string): { ok: false; error: X402ExecutionPlanError } {
  return { ok: false, error: { code: "execution_not_ready", message } };
}

/**
 * Build a review-only Circle Gateway settlement plan. The raw signature is
 * intentionally unavailable here: this function cannot call Circle, settle,
 * or create a PAYMENT-SIGNATURE header.
 */
export function buildX402ExecutionPlan(input: {
  snapshot: X402QuoteSnapshot;
  authorization: X402AuthorizationPayload;
  authorizationPayloadHash: string;
  authorizationHash: string;
  approvedAmountUSDC: string;
  nowSeconds?: number;
}): { ok: true; value: X402ExecutionPlan } | { ok: false; error: X402ExecutionPlanError } {
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.authorizationPayloadHash) || !/^0x[0-9a-fA-F]{64}$/.test(input.authorizationHash)) {
    return fail("authorization evidence hashes must be bytes32 values");
  }
  const option = input.snapshot.accepts.find((candidate) => candidate.network === AGON_X402_TESTNET_NETWORK && candidate.extra.name === "GatewayWalletBatched");
  if (!option || option.extra.version !== "1" || !option.extra.verifyingContract) return fail("the quote has no Arc Testnet Gateway option");
  if (input.authorization.domain.name !== "GatewayWalletBatched" || input.authorization.domain.version !== "1" || input.authorization.domain.chainId !== 5042002) {
    return fail("authorization domain is not scoped to Arc Testnet Gateway");
  }
  try {
    if (getAddress(input.authorization.domain.verifyingContract) !== getAddress(option.extra.verifyingContract)) return fail("authorization Gateway contract does not match the quote");
    if (getAddress(input.authorization.message.to) !== getAddress(option.payTo)) return fail("authorization recipient does not match the quote");
    if (BigInt(input.authorization.message.value) !== BigInt(option.amount)) return fail("authorization amount does not match the quote");
    if (BigInt(option.amount) > microUsdc(input.approvedAmountUSDC)) return fail("quote amount exceeds the approved spend limit");
    const now = BigInt(input.nowSeconds ?? Math.floor(Date.now() / 1000));
    if (now < BigInt(input.authorization.message.validAfter) || now > BigInt(input.authorization.message.validBefore)) return fail("authorization is outside its validity window");
    const requirements = {
      scheme: "exact" as const,
      network: AGON_X402_TESTNET_NETWORK,
      asset: option.asset,
      amount: option.amount,
      payTo: option.payTo,
      maxTimeoutSeconds: option.maxTimeoutSeconds,
      extra: {
        name: "GatewayWalletBatched" as const,
        version: "1" as const,
        verifyingContract: option.extra.verifyingContract,
      },
    };
    return {
      ok: true,
      value: {
        testnetOnly: true,
        facilitatorUrl: AGON_X402_TESTNET_FACILITATOR,
        settlementEndpoint: `${AGON_X402_TESTNET_FACILITATOR}/v1/x402/settle`,
        requirements,
        authorization: input.authorization.message,
        authorizationHash: input.authorizationHash.toLowerCase() as `0x${string}`,
        paymentPayloadPreview: {
          x402Version: 2,
          payload: { authorization: input.authorization.message, signatureHash: input.authorizationHash.toLowerCase() as `0x${string}`, signature: null },
        },
        executionEnabled: false,
        nextAction: "explicit_execution_approval",
      },
    };
  } catch {
    return fail("authorization contains invalid numeric or address fields");
  }
}
