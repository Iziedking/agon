import type { X402ExecutionReadinessView } from "./types";

const USDC_DECIMALS = 6;

export function formatUSDCBaseUnits(amount: string): string {
  if (!/^\d+$/.test(amount)) return `${amount} base units`;
  const normalized = amount.replace(/^0+(?=\d)/, "");
  const padded = normalized.padStart(USDC_DECIMALS + 1, "0");
  const whole = padded.slice(0, -USDC_DECIMALS);
  const fraction = padded.slice(-USDC_DECIMALS).replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""} USDC`;
}

export function executionReadinessLabel(status: X402ExecutionReadinessView["status"]): string {
  switch (status) {
    case "approval_required": return "APPROVAL REQUIRED";
    case "approved_but_disabled": return "APPROVED · ADAPTER OFF";
    case "approval_expired": return "APPROVAL EXPIRED";
  }
}

export function executionReadinessTone(status: X402ExecutionReadinessView["status"]): "warn" | "ok" | "err" {
  return status === "approved_but_disabled" ? "ok" : status === "approval_expired" ? "err" : "warn";
}

export function formatExecutionTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toISOString().replace("T", " ").replace(".000Z", " UTC");
}
