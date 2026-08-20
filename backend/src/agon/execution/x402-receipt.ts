export type X402ReceiptState =
  | "prepared"
  | "approved"
  | "payment_required"
  | "authorization_ready"
  | "authorization_submitted"
  | "settlement_submitted"
  | "service_delivered"
  | "reconciled"
  | "rejected"
  | "failed"
  | "unknown";

export type X402ReceiptEvent =
  | { type: "approve"; approvedAmountUSDC: string }
  | { type: "payment_required"; quoteHash: string; quoteSnapshot: unknown }
  | { type: "authorization_ready"; authorizationPayloadHash: string; authorizationPayload: unknown }
  | { type: "authorization_submitted"; authorizationHash: string }
  | { type: "settlement_submitted"; settlementRef: string }
  | { type: "service_delivered"; serviceStatus: number; paymentResponseHash: string }
  | { type: "reconcile"; settlementRef?: string }
  | { type: "reject"; failureCode: string; failureMessage: string }
  | { type: "fail"; failureCode: string; failureMessage: string }
  | { type: "mark_unknown"; failureCode: string; failureMessage: string };

export type X402ReceiptEvidencePatch = {
  approvedAmountUSDC?: string;
  quoteHash?: string;
  quoteSnapshot?: unknown;
  authorizationPayloadHash?: string;
  authorizationPayload?: unknown;
  authorizationHash?: string;
  settlementRef?: string;
  serviceStatus?: number;
  paymentResponseHash?: string;
  failureCode?: string;
  failureMessage?: string;
};

export type X402ReceiptTransition = {
  from: X402ReceiptState;
  to: X402ReceiptState;
  patch: X402ReceiptEvidencePatch;
};

export class X402ReceiptInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "X402ReceiptInvariantError";
  }
}

const ALLOWED: Record<X402ReceiptState, readonly X402ReceiptState[]> = {
  prepared: ["approved", "rejected"],
  approved: ["payment_required", "rejected", "failed"],
  payment_required: ["authorization_ready", "rejected", "failed"],
  authorization_ready: ["authorization_submitted", "rejected", "failed"],
  authorization_submitted: ["settlement_submitted", "failed", "unknown"],
  settlement_submitted: ["service_delivered", "failed", "unknown"],
  service_delivered: ["reconciled", "unknown"],
  reconciled: [],
  rejected: [],
  failed: [],
  unknown: ["settlement_submitted", "service_delivered", "reconciled", "failed"],
};

function requireHash(value: string, label: string): string {
  if (!/^0x[0-9a-f]{64}$/i.test(value)) throw new X402ReceiptInvariantError(`${label} must be a bytes32 hash`);
  return value.toLowerCase();
}

function requireText(value: string, label: string): string {
  if (!value.trim() || value.length > 512) throw new X402ReceiptInvariantError(`${label} must be 1-512 characters`);
  return value;
}

function requireQuoteSnapshot(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new X402ReceiptInvariantError("payment quote snapshot must be an object");
  }
  const encoded = JSON.stringify(value);
  if (!encoded || Buffer.byteLength(encoded, "utf8") > 64 * 1024) {
    throw new X402ReceiptInvariantError("payment quote snapshot exceeds the 64 KiB limit");
  }
  return value;
}

function requireAuthorizationPayload(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new X402ReceiptInvariantError("authorization payload must be an object");
  }
  const encoded = JSON.stringify(value);
  if (!encoded || Buffer.byteLength(encoded, "utf8") > 64 * 1024) {
    throw new X402ReceiptInvariantError("authorization payload exceeds the 64 KiB limit");
  }
  return value;
}

function requireAmount(value: string): string {
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value)) {
    throw new X402ReceiptInvariantError("approved amount must be a USDC amount with up to 6 decimals");
  }
  const [whole = "0", fraction = ""] = value.split(".");
  if (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0")) <= 0n) {
    throw new X402ReceiptInvariantError("approved amount must be positive");
  }
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

export function transitionX402Receipt(current: X402ReceiptState, event: X402ReceiptEvent): X402ReceiptTransition {
  let to: X402ReceiptState;
  let patch: X402ReceiptEvidencePatch = {};
  switch (event.type) {
    case "approve": to = "approved"; patch = { approvedAmountUSDC: requireAmount(event.approvedAmountUSDC) }; break;
    case "payment_required": to = "payment_required"; patch = { quoteHash: requireHash(event.quoteHash, "quote hash"), quoteSnapshot: requireQuoteSnapshot(event.quoteSnapshot) }; break;
    case "authorization_ready": to = "authorization_ready"; patch = { authorizationPayloadHash: requireHash(event.authorizationPayloadHash, "authorization payload hash"), authorizationPayload: requireAuthorizationPayload(event.authorizationPayload) }; break;
    case "authorization_submitted": to = "authorization_submitted"; patch = { authorizationHash: requireHash(event.authorizationHash, "authorization hash") }; break;
    case "settlement_submitted": to = "settlement_submitted"; patch = { settlementRef: requireText(event.settlementRef, "settlement reference") }; break;
    case "service_delivered":
      if (!Number.isInteger(event.serviceStatus) || event.serviceStatus < 200 || event.serviceStatus > 299) {
        throw new X402ReceiptInvariantError("service status must be a successful HTTP status");
      }
      to = "service_delivered";
      patch = { serviceStatus: event.serviceStatus, paymentResponseHash: requireHash(event.paymentResponseHash, "payment response hash") };
      break;
    case "reconcile":
      to = "reconciled";
      patch = event.settlementRef ? { settlementRef: requireText(event.settlementRef, "settlement reference") } : {};
      break;
    case "reject": to = "rejected"; patch = { failureCode: requireText(event.failureCode, "failure code"), failureMessage: requireText(event.failureMessage, "failure message") }; break;
    case "fail": to = "failed"; patch = { failureCode: requireText(event.failureCode, "failure code"), failureMessage: requireText(event.failureMessage, "failure message") }; break;
    case "mark_unknown": to = "unknown"; patch = { failureCode: requireText(event.failureCode, "failure code"), failureMessage: requireText(event.failureMessage, "failure message") }; break;
  }
  if (!ALLOWED[current].includes(to)) {
    throw new X402ReceiptInvariantError(`cannot move receipt from ${current} to ${to}`);
  }
  return { from: current, to, patch };
}
