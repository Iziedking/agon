import type {
  ListingStatus,
  PaymentRail,
  VerificationStatus,
} from "../store/repository.ts";

export type ApiIssue = {
  path: string[];
  code: string;
  message: string;
};

export type ApiErrorResponse = {
  error: {
    code: string;
    message: string;
    issues?: ApiIssue[];
  };
};

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

export type VerificationScope = {
  agentId: string;
  listingId: string;
  version: string;
  category: string;
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
};

export type AgonListingView = {
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
    /** Optional validated manifest content. Clients must handle an anchor-only response. */
    body?: unknown | null;
  };
  providerSnapshot: string;
  status: ListingStatus;
  verification: {
    status: VerificationStatus;
    scope: VerificationScope;
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

export type ListingPage = {
  items: AgonListingView[];
  nextCursor: string | null;
};

export type ListingQuery = {
  limit: number;
  cursor: string | null;
  category: string | null;
  agentId: string | null;
};

export type X402CallIntentRequest = {
  idempotencyKey: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  input: unknown;
  maxAmountUSDC: string;
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
  proof: {
    blockNumber: string;
    logIndex: number;
  } | null;
};

export type ConfirmOperationRequest = { txHash: `0x${string}` };
