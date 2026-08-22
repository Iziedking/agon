import type { X402SettlementReadinessView } from "./types";

export function settlementReadinessLabel(status: X402SettlementReadinessView["status"]): string {
  switch (status) {
    case "authorization_required": return "AUTHORIZATION REQUIRED";
    case "ready_but_disabled": return "READY · ADAPTER OFF";
    case "service_delivery_pending": return "SERVICE DELIVERY PENDING";
    case "reconciliation_required": return "RECONCILIATION REQUIRED";
    case "terminal": return "TERMINAL RECEIPT";
  }
}

export function settlementReadinessTone(status: X402SettlementReadinessView["status"]): "warn" | "ok" | "err" {
  switch (status) {
    case "terminal": return "ok";
    case "reconciliation_required": return "err";
    default: return "warn";
  }
}
