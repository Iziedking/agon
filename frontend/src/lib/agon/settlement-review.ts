import type { X402SettlementReadinessView } from "./types";

export function settlementReadinessLabel(status: X402SettlementReadinessView["status"]): string {
  switch (status) {
    case "authorization_required": return "WALLET APPROVAL NEEDED";
    case "ready_but_disabled": return "PAYMENT UNAVAILABLE";
    case "ready": return "READY TO PAY";
    case "service_delivery_pending": return "WAITING FOR SERVICE";
    case "reconciliation_required": return "CHECKING PAYMENT";
    case "terminal": return "COMPLETE";
  }
}

export function settlementReadinessTone(status: X402SettlementReadinessView["status"]): "warn" | "ok" | "err" {
  switch (status) {
    case "terminal":
    case "ready": return "ok";
    case "reconciliation_required": return "err";
    default: return "warn";
  }
}
