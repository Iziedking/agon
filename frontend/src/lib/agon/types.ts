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
