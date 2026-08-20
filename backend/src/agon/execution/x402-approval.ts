import type { Result } from "../core/result.ts";
import type { X402ApprovalRequest } from "../http/api-types.ts";

const AMOUNT_PATTERN = /^(0|[1-9]\d*)(\.\d{1,6})?$/;

export type X402ApprovalError = {
  code: "invalid_request" | "limit_exceeded";
  message: string;
};

export type ValidatedX402Approval = {
  approvedAmountUSDC: string;
};

function micros(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

function normalize(value: string): string {
  const [whole = "0", fraction = ""] = value.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

export function validateX402Approval(
  maxAmountUSDC: string,
  request: X402ApprovalRequest,
): Result<ValidatedX402Approval, X402ApprovalError> {
  if (!AMOUNT_PATTERN.test(request.approvedAmountUSDC) || micros(request.approvedAmountUSDC) <= 0n) {
    return {
      ok: false,
      error: { code: "invalid_request", message: "approvedAmountUSDC must be a positive USDC amount with up to 6 decimals" },
    };
  }
  if (!AMOUNT_PATTERN.test(maxAmountUSDC) || micros(request.approvedAmountUSDC) > micros(maxAmountUSDC)) {
    return {
      ok: false,
      error: { code: "limit_exceeded", message: "approved amount cannot exceed the prepared maximum" },
    };
  }
  return { ok: true, value: { approvedAmountUSDC: normalize(request.approvedAmountUSDC) } };
}
