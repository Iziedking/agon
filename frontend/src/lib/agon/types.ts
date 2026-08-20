export type ListingStatus = "Listed" | "Suspended" | "Delisted";
export type PaymentRail = "X402" | "Escrow";
export type VerificationStatus =
  | "Unverified"
  | "Pending"
  | "Verified"
  | "Expired"
  | "Suspended"
  | "Revoked";

export type AgonCapabilities = {
  identityReads: boolean;
  profileWrites: boolean;
  listingReads: boolean;
  listingWrites: boolean;
  endpointQa: boolean;
  directX402: boolean;
  escrow: boolean;
  writeReadiness: {
    checkedAt: string | null;
    reasons: string[];
  };
};

export type AgonEndpointQa = {
  status: "passed" | "failed" | "not_checked";
  checkedAt: string | null;
  endpointStatus: number | null;
  evidenceHash: string | null;
  reason: string;
  attempts: number;
  passedAttempts: number;
  successRate: number | null;
  endpointUrl?: string;
};

export type AgonListing = {
  id: string;
  chainId: string;
  serviceRegistry: string;
  listingId: string;
  agentId: string;
  serviceKey: string;
  category: string;
  version: string;
  manifest: {
    hash: string;
    uri: string;
    body?: unknown | null;
  };
  providerSnapshot: string;
  status: ListingStatus;
  verification: {
    status: VerificationStatus;
    scope: {
      agentId: string;
      listingId: string;
      version: string;
      category: string;
    };
  };
  risk: {
    unverified: boolean;
    warning: string | null;
    quarantineReason: string | null;
  };
  endpointQa: AgonEndpointQa;
  payment: {
    rail: PaymentRail;
    directX402: boolean;
    escrowEligible: boolean;
  };
  provenance: {
    sourceBlockNumber: string;
    sourceTxHash: string;
    sourceLogIndex: number;
  };
};

export type AgonListingPage = {
  items: AgonListing[];
  nextCursor: string | null;
};

export type ListListingsQuery = {
  limit?: number;
  cursor?: string | null;
  category?: string | null;
  agentId?: string | null;
};

export type BindProfileRequest = {
  chainId: string;
  agentId: string;
  metadataUri: string;
};

export type PublishListingRequest = {
  chainId: string;
  agentId: string;
  serviceKey: string;
  manifestHash: string;
  manifestUri: string;
  category: string;
  paymentRail: PaymentRail;
};

export type SubmittedOperation = {
  operationId: string;
  state: "prepared" | "confirmed";
  transaction: {
    chainId: string;
    to: `0x${string}`;
    data: `0x${string}`;
    functionName: "bindProfile" | "publish";
    args: string[];
  };
  txHash: `0x${string}` | null;
  resultReference: string | null;
  proof: { blockNumber: string; logIndex: number } | null;
};

export type X402CallIntentRequest = {
  idempotencyKey: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  input: unknown;
  maxAmountUSDC: string;
  endpointUrl?: string;
};

export type X402CallIntentView = {
  intentId: string;
  actor: string;
  idempotencyKey: string;
  listingReference: string;
  listingVersion: string;
  inputHash: string;
  maxAmountUSDC: string;
  state: "prepared";
  executionEnabled: false;
  nextAction: "execution_adapter_not_enabled";
  createdAt: string;
  targetUrl?: string | null;
};

export type X402ApprovalRequest = {
  approvedAmountUSDC: string;
};

export type X402ApprovalView = {
  receiptId: string;
  intentId: string;
  actor: string;
  state: "approved";
  approvedAmountUSDC: string;
  executionEnabled: false;
  nextAction: "payment_adapter_not_enabled";
  approvedAt: string;
};

export type X402QuoteRequirementView = {
  scheme: "exact";
  network: string;
  asset: `0x${string}`;
  amount: string;
  payTo: `0x${string}`;
  maxTimeoutSeconds: number;
  gateway: boolean;
};

export type X402QuoteView = {
  receiptId: string;
  intentId: string;
  state: "payment_required";
  status: 402;
  targetUrl: string;
  quoteHash: string;
  x402Version: 2;
  resource: { url: string; description: string | null; mimeType: string | null };
  accepts: X402QuoteRequirementView[];
  executionEnabled: false;
  nextAction: "authorization_not_enabled";
  capturedAt: string;
};

export type AgonHealth = {
  ok: boolean;
  service: "agon";
  capabilities: AgonCapabilities;
};

export type ApiIssue = {
  path: string[];
  code: string;
  message: string;
};

export type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
    issues?: ApiIssue[];
  };
};
