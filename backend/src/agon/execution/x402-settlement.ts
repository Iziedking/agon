import { getAddress, keccak256 } from "viem";
import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";
import { hashX402ExecutionApproval } from "./x402-execution-approval.ts";
import {
  AGON_X402_TESTNET_FACILITATOR,
  AGON_X402_TESTNET_NETWORK,
  hashX402ExecutionPlan,
  type X402ExecutionPlan,
} from "./x402-facilitator.ts";
import {
  createX402ExecutionPolicy,
  evaluateX402ExecutionPolicy,
  type X402ExecutionPolicy,
} from "./x402-policy.ts";

export const X402_EXECUTION_CONFIRMATION_PHRASE = "EXECUTE_ARC_TESTNET_X402" as const;
export const X402_VERIFY_CONFIRMATION_PHRASE = "VERIFY_ARC_TESTNET_X402" as const;

export type X402FacilitatorPayload = {
  x402Version: 2;
  payload: {
    authorization: X402ExecutionPlan["authorization"];
    signature: `0x${string}`;
  };
};

export type X402FacilitatorRequirements = X402ExecutionPlan["requirements"];

export type X402FacilitatorClient = {
  /** Verify a signed payment without submitting or settling it. */
  verify?(
    paymentPayload: X402FacilitatorPayload,
    paymentRequirements: X402FacilitatorRequirements,
  ): Promise<{
    isValid: boolean;
    payer?: string;
    invalidReason?: string;
  }>;
  settle(
    paymentPayload: X402FacilitatorPayload,
    paymentRequirements: X402FacilitatorRequirements,
  ): Promise<{
    success: boolean;
    transaction: string;
    network: string;
    payer?: string;
    errorReason?: string;
  }>;
};

export type X402StoredApprovalEvidence = {
  approvalHash: string;
  intentId: string;
  actor: string;
  planHash: string;
  authorizationHash: string;
  approvalIdempotencyKey: string;
  approvedAt: Date;
  expiresAt: Date;
};

export type X402SettlementRequest = {
  approval: X402StoredApprovalEvidence;
  plan: X402ExecutionPlan;
  signature: string;
  confirmation: typeof X402_EXECUTION_CONFIRMATION_PHRASE;
  nowSeconds?: number;
  delivery?: {
    targetUrl: string;
    method: "GET" | "POST";
    input: unknown;
  };
};

export type X402FacilitatorVerificationRequest = Omit<X402SettlementRequest, "confirmation"> & {
  confirmation: typeof X402_VERIFY_CONFIRMATION_PHRASE;
};

export type X402SettlementResult =
  | {
      ok: true;
      value: {
        intentId: string;
        approvalHash: `0x${string}`;
        transaction: `0x${string}` | null;
        providerTransferId?: string | null;
        network: typeof AGON_X402_TESTNET_NETWORK;
        payer: `0x${string}` | null;
        executionEnabled: true;
        delivery?: {
          serviceStatus: number;
          latencyMs: number;
          responseHash: `0x${string}`;
          deliveredAt: string;
          result: unknown;
        };
      };
    }
  | { ok: false; error: { code: X402SettlementErrorCode; message: string } };

export type X402FacilitatorVerificationResult =
  | {
      ok: true;
      value: {
        intentId: string;
        approvalHash: `0x${string}`;
        network: typeof AGON_X402_TESTNET_NETWORK;
        payer: `0x${string}` | null;
        verified: true;
      };
    }
  | { ok: false; error: { code: X402SettlementErrorCode; message: string } };

export type X402SettlementErrorCode =
  | "execution_disabled"
  | "execution_not_ready"
  | "facilitator_rejected"
  | "facilitator_unavailable";

function fail(code: X402SettlementErrorCode, message: string): { ok: false; error: { code: X402SettlementErrorCode; message: string } } {
  return { ok: false, error: { code, message } };
}

function sameAddress(left: string, right: string): boolean {
  try {
    return getAddress(left) === getAddress(right);
  } catch {
    return false;
  }
}

function isBytes32(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

function isSignature(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{130}$/.test(value);
}

function isTransaction(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

function approvalHashMatches(approval: X402StoredApprovalEvidence): boolean {
  if (!isBytes32(approval.approvalHash) || !isBytes32(approval.planHash) || !isBytes32(approval.authorizationHash)) return false;
  if (!/^[0-9a-f-]{36}$/i.test(approval.intentId) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(approval.approvalIdempotencyKey)) return false;
  if (!(approval.approvedAt instanceof Date) || !(approval.expiresAt instanceof Date) || !Number.isFinite(approval.approvedAt.getTime()) || !Number.isFinite(approval.expiresAt.getTime()) || approval.expiresAt <= approval.approvedAt) return false;
  try {
    return approval.approvalHash.toLowerCase() === hashX402ExecutionApproval({
      actor: approval.actor.toLowerCase(),
      approvalIdempotencyKey: approval.approvalIdempotencyKey,
      approvedAt: approval.approvedAt.toISOString(),
      expiresAt: approval.expiresAt.toISOString(),
      intentId: approval.intentId,
      planHash: approval.planHash.toLowerCase(),
    }).toLowerCase();
  } catch {
    return false;
  }
}

export type ValidatedSettlement = { ok: true; signature: `0x${string}` } | { ok: false; error: { code: X402SettlementErrorCode; message: string } };

function validateX402Request(input: X402SettlementRequest | X402FacilitatorVerificationRequest, confirmation: string): ValidatedSettlement {
  const { approval, plan } = input;
  if (input.confirmation !== confirmation) return fail("execution_not_ready", "explicit Arc Testnet confirmation is required");
  if (!isSignature(input.signature)) return fail("execution_not_ready", "a 65-byte authorization signature is required at execution time");
  if (!approvalHashMatches(approval)) return fail("execution_not_ready", "durable execution approval evidence is invalid");
  if (!isBytes32(plan.planHash) || plan.planHash.toLowerCase() !== hashX402ExecutionPlan(plan).toLowerCase()) return fail("execution_not_ready", "execution plan hash does not match the reviewed plan");
  if (approval.planHash.toLowerCase() !== plan.planHash.toLowerCase()) return fail("execution_not_ready", "approval does not match the reviewed execution plan");
  if (approval.authorizationHash.toLowerCase() !== plan.authorizationHash.toLowerCase()) return fail("execution_not_ready", "approval does not match the signed authorization");
  if (!sameAddress(approval.actor, plan.authorization.from)) return fail("execution_not_ready", "approval actor does not match authorization owner");
  if (keccak256(input.signature).toLowerCase() !== plan.authorizationHash.toLowerCase()) return fail("execution_not_ready", "signature does not match the authorization evidence");
  if (plan.facilitatorUrl !== AGON_X402_TESTNET_FACILITATOR || plan.settlementEndpoint !== `${AGON_X402_TESTNET_FACILITATOR}/v1/x402/settle`) return fail("execution_not_ready", "facilitator is not the pinned Circle testnet endpoint");
  if (!plan.testnetOnly || plan.executionEnabled || plan.requirements.network !== AGON_X402_TESTNET_NETWORK || plan.requirements.scheme !== "exact") return fail("execution_not_ready", "only the disabled Arc Testnet exact plan may be executed");
  if (plan.requirements.extra.name !== "GatewayWalletBatched" || plan.requirements.extra.version !== "1" || !/^0x[0-9a-fA-F]{40}$/.test(plan.requirements.extra.verifyingContract)) return fail("execution_not_ready", "Gateway requirements are not pinned to a valid contract");
  if (!sameAddress(plan.requirements.payTo, plan.authorization.to) || plan.requirements.amount !== plan.authorization.value) return fail("execution_not_ready", "payment requirements do not match the signed authorization");
  const now = Math.floor(input.nowSeconds ?? Date.now() / 1000);
  if (now >= Math.floor(approval.expiresAt.getTime() / 1000)) return fail("execution_not_ready", "execution approval has expired");
  if (now < Number(plan.authorization.validAfter) || now > Number(plan.authorization.validBefore)) return fail("execution_not_ready", "authorization is outside its validity window");
  return { ok: true, signature: input.signature };
}

export function validateX402SettlementRequest(input: X402SettlementRequest): ValidatedSettlement {
  return validateX402Request(input, X402_EXECUTION_CONFIRMATION_PHRASE);
}

export function validateX402FacilitatorVerificationRequest(input: X402FacilitatorVerificationRequest): ValidatedSettlement {
  return validateX402Request(input, X402_VERIFY_CONFIRMATION_PHRASE);
}

/**
 * Create the only settlement seam. The default adapter is deliberately
 * disabled and has no facilitator client, so importing this module cannot
 * make a network call. Raw signatures live only in this call frame.
 */
export function createX402FacilitatorAdapter(options: {
  enabled?: boolean;
  client?: X402FacilitatorClient;
  policy?: X402ExecutionPolicy;
} = {}) {
  return {
    async verify(input: X402FacilitatorVerificationRequest): Promise<X402FacilitatorVerificationResult> {
      const checked = validateX402FacilitatorVerificationRequest(input);
      if (!checked.ok) return { ok: false, error: checked.error };
      if (options.enabled !== true) return fail("execution_disabled", "x402 verification adapter is disabled by policy");
      if (!options.policy) return fail("execution_disabled", "x402 verification requires an explicit spend policy");
      const policy = evaluateX402ExecutionPolicy(options.policy, input.plan);
      if (!policy.ok) return fail(policy.code, policy.message);
      if (!options.client?.verify) return fail("facilitator_unavailable", "x402 facilitator verification is not configured");
      try {
        const result = await options.client.verify(
          { x402Version: 2, payload: { authorization: input.plan.authorization, signature: checked.signature } },
          input.plan.requirements,
        );
        if (!result.isValid) return fail("facilitator_rejected", result.invalidReason ?? "Circle facilitator rejected verification");
        if (result.payer && !sameAddress(result.payer, input.plan.authorization.from)) {
          return fail("facilitator_rejected", "Circle facilitator payer does not match the authorization owner");
        }
        return {
          ok: true,
          value: {
            intentId: input.approval.intentId,
            approvalHash: input.approval.approvalHash as `0x${string}`,
            network: AGON_X402_TESTNET_NETWORK,
            payer: result.payer ? (getAddress(result.payer) as `0x${string}`) : null,
            verified: true,
          },
        };
      } catch {
        return fail("facilitator_unavailable", "Circle facilitator verification failed without a trusted result");
      }
    },
    async settle(input: X402SettlementRequest): Promise<X402SettlementResult> {
      const checked = validateX402SettlementRequest(input);
      if (!checked.ok) return { ok: false, error: checked.error };
      if (options.enabled !== true) return fail("execution_disabled", "x402 execution adapter is disabled by policy");
      if (!options.policy) return fail("execution_disabled", "x402 execution requires an explicit spend policy");
      const policy = evaluateX402ExecutionPolicy(options.policy, input.plan);
      if (!policy.ok) return fail(policy.code, policy.message);
      if (!options.client) return fail("facilitator_unavailable", "x402 facilitator client is not configured");
      try {
        const result = await options.client.settle(
          { x402Version: 2, payload: { authorization: input.plan.authorization, signature: checked.signature } },
          input.plan.requirements,
        );
        if (!result.success) return fail("facilitator_rejected", result.errorReason ?? "Circle facilitator rejected settlement");
        const transaction = isTransaction(result.transaction) ? result.transaction : null;
        const providerTransferId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result.transaction) ? result.transaction.toLowerCase() : null;
        if (result.network !== AGON_X402_TESTNET_NETWORK || (!transaction && !providerTransferId)) return fail("facilitator_rejected", "Circle facilitator returned an invalid Arc Testnet receipt reference");
        return {
          ok: true,
          value: {
            intentId: input.approval.intentId,
            approvalHash: input.approval.approvalHash as `0x${string}`,
            transaction,
            providerTransferId,
            network: AGON_X402_TESTNET_NETWORK,
            payer: result.payer && sameAddress(result.payer, input.plan.authorization.from) ? (getAddress(result.payer) as `0x${string}`) : null,
            executionEnabled: true,
          },
        };
      } catch {
        return fail("facilitator_rejected", "Circle facilitator settlement failed without a trusted receipt");
      }
    },
  };
}

/** Build a policy from env/config values without making a network call. */
export { createX402ExecutionPolicy };

/** Construct the pinned Circle client without making a request. */
export function createCircleTestnetFacilitatorClient(): X402FacilitatorClient {
  const client = new BatchFacilitatorClient({ url: AGON_X402_TESTNET_FACILITATOR });
  return {
    verify: (paymentPayload, paymentRequirements) => client.verify(paymentPayload, paymentRequirements),
    settle: (paymentPayload, paymentRequirements) => client.settle(paymentPayload, paymentRequirements),
  };
}
