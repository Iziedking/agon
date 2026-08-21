import { getAddress } from "viem";
import { z } from "zod";
import type { X402ExecutionPlan } from "./x402-facilitator.ts";

/** Circle x402 is deliberately pinned to the Arc Testnet during rollout. */
export const AGON_X402_POLICY_NETWORK = "eip155:5042002" as const;

const amountSchema = z.union([
  z.bigint().nonnegative(),
  z.string().regex(/^(0|[1-9]\d*)$/, "must be an integer USDC base-unit amount").transform((value) => BigInt(value)),
]);

export type X402ExecutionPolicy = {
  enabled: boolean;
  network: typeof AGON_X402_POLICY_NETWORK;
  maxAmountBaseUnits: bigint;
  allowedRecipients?: readonly `0x${string}`[];
};

export type X402PolicyDecision =
  | { ok: true }
  | { ok: false; code: "execution_disabled" | "execution_not_ready"; message: string };

/**
 * Parse the only values that may enable the settlement adapter. The parser is
 * intentionally strict so a decimal USDC value, a mainnet network, or a
 * malformed recipient cannot silently widen the spend envelope.
 */
export function createX402ExecutionPolicy(input: {
  enabled: boolean;
  network?: string;
  maxAmountBaseUnits: string | bigint;
  allowedRecipients?: readonly string[];
}): X402ExecutionPolicy {
  if (input.network !== undefined && input.network !== AGON_X402_POLICY_NETWORK) {
    throw new Error(`x402 execution is pinned to ${AGON_X402_POLICY_NETWORK}`);
  }
  const maxAmountBaseUnits = amountSchema.parse(input.maxAmountBaseUnits);
  const allowedRecipients = input.allowedRecipients?.map((value) => getAddress(value) as `0x${string}`);
  return {
    enabled: input.enabled,
    network: AGON_X402_POLICY_NETWORK,
    maxAmountBaseUnits,
    ...(allowedRecipients ? { allowedRecipients } : {}),
  };
}

export function evaluateX402ExecutionPolicy(
  policy: X402ExecutionPolicy,
  plan: X402ExecutionPlan,
): X402PolicyDecision {
  if (!policy.enabled) {
    return { ok: false, code: "execution_disabled", message: "x402 execution is disabled by policy" };
  }
  if (policy.network !== AGON_X402_POLICY_NETWORK || plan.requirements.network !== AGON_X402_POLICY_NETWORK) {
    return { ok: false, code: "execution_not_ready", message: "x402 execution is restricted to Arc Testnet" };
  }
  if (policy.maxAmountBaseUnits <= 0n) {
    return { ok: false, code: "execution_disabled", message: "x402 execution has no positive spend cap" };
  }
  let amount: bigint;
  try {
    amount = BigInt(plan.requirements.amount);
  } catch {
    return { ok: false, code: "execution_not_ready", message: "x402 amount is not an integer USDC base-unit value" };
  }
  if (amount <= 0n || amount > policy.maxAmountBaseUnits) {
    return { ok: false, code: "execution_not_ready", message: "x402 amount exceeds the configured spend cap" };
  }
  if (policy.allowedRecipients?.length) {
    try {
      const recipient = getAddress(plan.requirements.payTo);
      if (!policy.allowedRecipients.some((allowed) => allowed === recipient)) {
        return { ok: false, code: "execution_not_ready", message: "x402 recipient is not approved by policy" };
      }
    } catch {
      return { ok: false, code: "execution_not_ready", message: "x402 recipient is invalid" };
    }
  }
  return { ok: true };
}
