import { z } from "zod";

import { parsePaymentRequiredHeader, type ParsedX402Quote } from "./execution/x402-quote.ts";

const healthSchema = z.object({
  ok: z.literal(true),
  service: z.literal("agon-provider"),
  serviceKey: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  status: z.literal("ready"),
  runtime: z.string().min(1).max(64),
}).strict();

export type ProviderContractExpectation = {
  serviceKey: string;
  version: string;
  endpoint: string;
  chainId: string;
  maxAmountUSDC: string;
};

export type ProviderHealth = z.infer<typeof healthSchema>;
export type ProviderContractFailure = {
  ok: false;
  code: "invalid_health" | "invalid_payment_challenge";
  message: string;
};

export type ProviderHealthResult = { ok: true; value: ProviderHealth } | ProviderContractFailure;
export type ProviderPaymentChallengeResult = { ok: true; value: ParsedX402Quote } | ProviderContractFailure;

function failure(code: ProviderContractFailure["code"], message: string): ProviderContractFailure {
  return { ok: false, code, message };
}

export function validateProviderHealth(input: unknown, expected: Pick<ProviderContractExpectation, "serviceKey" | "version">): ProviderHealthResult {
  const parsed = healthSchema.safeParse(input);
  if (!parsed.success) return failure("invalid_health", parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  if (parsed.data.serviceKey !== expected.serviceKey) return failure("invalid_health", "health serviceKey does not match the listing");
  if (parsed.data.version !== expected.version) return failure("invalid_health", "health version does not match the manifest");
  return { ok: true, value: parsed.data };
}

export function parseProviderPaymentChallenge(header: string | null, expected: ProviderContractExpectation): ProviderPaymentChallengeResult {
  const parsed = parsePaymentRequiredHeader(header, expected.endpoint, expected.chainId, expected.maxAmountUSDC);
  if (!parsed.ok) return failure("invalid_payment_challenge", parsed.error.message);
  for (const option of parsed.value.snapshot.accepts) {
    if (option.extra.serviceKey !== expected.serviceKey) return failure("invalid_payment_challenge", "payment challenge serviceKey does not match the listing");
    if (option.extra.serviceVersion !== expected.version) return failure("invalid_payment_challenge", "payment challenge serviceVersion does not match the manifest");
  }
  return parsed;
}
