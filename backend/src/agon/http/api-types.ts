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
  arenaVerification: boolean;
  syndicateRegistry: boolean;
  prizeVault: boolean;
  writeReadiness: {
    checkedAt: string | null;
    reasons: string[];
  };
  escrowReadiness: {
    testnetOnly: true;
    ready: boolean;
    executionEnabled: false;
    checkedAt: string | null;
    reasons: string[];
    requiredApprovals: string[];
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
  endpointUrl?: string;
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
  /** The provider URL observed in the exact manifest. Legacy intents may omit it. */
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

export type X402AuthorizationView = {
  receiptId: string;
  intentId: string;
  state: "authorization_ready";
  payloadHash: string;
  payload: {
    x402Version: 2;
    domain: { name: "GatewayWalletBatched"; version: "1"; chainId: number; verifyingContract: `0x${string}` };
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: "TransferWithAuthorization";
    message: { from: `0x${string}`; to: `0x${string}`; value: string; validAfter: string; validBefore: string; nonce: `0x${string}` };
  };
  expiresAt: string;
  executionEnabled: false;
  nextAction: "user_signature_required";
  preparedAt: string;
};

export type X402AuthorizationSignatureRequest = {
  payloadHash: string;
  signature: `0x${string}`;
};

export type X402AuthorizationSubmittedView = {
  receiptId: string;
  intentId: string;
  state: "authorization_submitted";
  authorizationHash: string;
  signatureAccepted: true;
  executionEnabled: false;
  nextAction: "settlement_not_enabled";
  submittedAt: string;
};

export type X402ExecutionPlanView = {
  receiptId: string;
  intentId: string;
  state: "authorization_submitted";
  plan: {
    testnetOnly: true;
    facilitatorUrl: "https://gateway-api-testnet.circle.com";
    settlementEndpoint: "https://gateway-api-testnet.circle.com/v1/x402/settle";
    requirements: {
      scheme: "exact";
      network: "eip155:5042002";
      asset: `0x${string}`;
      amount: string;
      payTo: `0x${string}`;
      maxTimeoutSeconds: number;
      extra: { name: "GatewayWalletBatched"; version: "1"; verifyingContract: `0x${string}` };
    };
    authorization: { from: `0x${string}`; to: `0x${string}`; value: string; validAfter: string; validBefore: string; nonce: `0x${string}` };
    authorizationHash: string;
    planHash: string;
    paymentPayloadPreview: { x402Version: 2; payload: { authorization: X402ExecutionPlanView["plan"]["authorization"]; signatureHash: string; signature: null } };
    executionEnabled: false;
    nextAction: "explicit_execution_approval";
  };
  executionEnabled: false;
  nextAction: "explicit_execution_approval";
  preparedAt: string;
};

export type X402ExecutionApprovalRequest = {
  planHash: string;
  approvalIdempotencyKey: string;
  confirmation: "APPROVE_ARC_TESTNET_X402";
};

export type X402ExecutionApprovalView = {
  approvalHash: string;
  receiptId: string;
  intentId: string;
  actor: `0x${string}`;
  planHash: string;
  authorizationHash: string;
  approvalIdempotencyKey: string;
  testnetOnly: true;
  approvedAt: string;
  expiresAt: string;
  executionEnabled: false;
  nextAction: "execution_adapter_not_enabled";
};

export type X402ExecutionReadinessView = {
  receiptId: string;
  intentId: string;
  state: "authorization_submitted";
  plan: X402ExecutionPlanView["plan"];
  approval: X402ExecutionApprovalView | null;
  status: "approval_required" | "approved_but_disabled" | "approval_expired";
  reason: string;
  executionEnabled: false;
  nextAction: "explicit_execution_approval" | "execution_adapter_not_enabled";
  checkedAt: string;
};

export type X402SettlementReadinessView = {
  receiptId: string;
  intentId: string;
  state: "prepared" | "approved" | "payment_required" | "authorization_ready" | "authorization_submitted" | "settlement_submitted" | "service_delivered" | "reconciled" | "rejected" | "failed" | "unknown";
  network: "eip155:5042002";
  settlementRef: string | null;
  providerTransferId: string | null;
  status: "authorization_required" | "ready_but_disabled" | "service_delivery_pending" | "reconciliation_required" | "terminal";
  reason: string;
  executionEnabled: false;
  nextAction: "complete_authorization" | "execution_adapter_not_enabled" | "deliver_service" | "reconcile_settlement" | "none";
  checkedAt: string;
};

export type X402ReconciliationReadinessView = {
  receiptId: string;
  intentId: string;
  state: X402SettlementReadinessView["state"];
  network: "eip155:5042002";
  transaction: `0x${string}` | null;
  providerTransferId: string | null;
  status: "not_required" | "lookup_disabled" | "lookup_required" | "reference_required" | "terminal";
  reason: string;
  lookupEnabled: boolean;
  executionEnabled: false;
  nextAction: "complete_authorization" | "enable_receipt_lookup" | "record_provider_reference" | "reconcile_receipt" | "none";
  checkedAt: string;
};

export type X402ReconciliationRequest = {
  confirmation: "RECONCILE_ARC_TESTNET_X402";
};

export type X402DeliveryEvidenceRequest = {
  deliveryId: string;
  serviceStatus: number;
  latencyMs: number;
  responseHash: string;
  resultAttestationHash?: string | null;
  chargedAmountUSDC?: string | null;
  deliveredAt: string;
};

export type X402DeliveryEvidenceView = {
  deliveryId: string;
  receiptId: string;
  intentId: string;
  provider: `0x${string}`;
  listingReference: string;
  state: "service_delivered";
  serviceStatus: number;
  latencyMs: number;
  responseHash: string;
  resultAttestationHash: string | null;
  chargedAmountUSDC: string | null;
  evidenceHash: string;
  deliveredAt: string;
  executionEnabled: false;
  nextAction: "reconcile_receipt";
};

export type X402SettlementRequest = {
  signature: `0x${string}`;
  confirmation: "EXECUTE_ARC_TESTNET_X402";
};

export type X402SettlementView = {
  receiptId: string;
  intentId: string;
  state: "settlement_submitted" | "unknown" | "failed";
  network: "eip155:5042002";
  transaction: `0x${string}` | null;
  providerTransferId: string | null;
  payer: `0x${string}` | null;
  executionEnabled: boolean;
  serviceDeliveryPending: boolean;
  nextAction: "deliver_service" | "reconcile_receipt" | "none";
  recordedAt: string;
};

export type X402ReconciliationView = {
  receiptId: string;
  intentId: string;
  state: X402SettlementReadinessView["state"];
  network: "eip155:5042002";
  status: "confirmed" | "pending" | "failed";
  transaction: `0x${string}` | null;
  providerTransferId: string | null;
  executionEnabled: false;
  serviceDeliveryPending: boolean;
  nextAction: "deliver_service" | "reconcile_receipt" | "none";
  recordedAt: string;
};

export type X402FacilitatorVerificationRequest = {
  signature: `0x${string}`;
  confirmation: "VERIFY_ARC_TESTNET_X402";
};

export type X402FacilitatorVerificationView = {
  receiptId: string;
  intentId: string;
  state: "facilitator_verified";
  network: "eip155:5042002";
  payer: `0x${string}` | null;
  approvalHash: string;
  evidenceHash: string;
  verified: true;
  executionEnabled: false;
  nextAction: "settlement_remains_disabled";
  verifiedAt: string;
};

export type AgonEscrowIntentRequest = {
  listingReference: string;
  idempotencyKey: string;
  amountBaseUnits: string;
  feeBps: number;
  expiresAt: string;
  poolBinding?: {
    controller: string;
    poolId: string;
  };
};

export type AgonEscrowLifecycleRequest = {
  confirmation:
    | "FUND_ARC_TESTNET_ESCROW"
    | "RELEASE_ARC_TESTNET_ESCROW"
    | "REFUND_ARC_TESTNET_ESCROW";
};

export type AgonEscrowIntentView = {
  intentId: string;
  actor: `0x${string}`;
  idempotencyKey: string;
  listingReference: string;
  termsHash: string;
  network: "eip155:5042002";
  asset: `0x${string}`;
  buyer: `0x${string}`;
  beneficiary: `0x${string}`;
  listing: {
    serviceRegistry: `0x${string}`;
    listingId: string;
    agentId: string;
    version: string;
    manifestHash: string;
  };
  amountBaseUnits: string;
  feeBps: number;
  expiresAt: string;
  state: "prepared" | "funding" | "funded" | "release_pending" | "released" | "refund_pending" | "refunded" | "unknown" | "failed";
  providerReference: string | null;
  transaction: `0x${string}` | null;
  poolBinding: {
    contractAddress: `0x${string}`;
    controller: `0x${string}`;
    poolId: string;
  } | null;
  executionEnabled: false;
  nextAction: "escrow_adapter_not_enabled" | "reconcile_unknown_outcome" | "none";
  createdAt: string;
  updatedAt: string;
};

export type AgonEscrowReadinessView = {
  intentId: string;
  state: AgonEscrowIntentView["state"];
  status: "adapter_disabled" | "reconciliation_required" | "terminal";
  reason: string;
  executionEnabled: false;
  nextAction: AgonEscrowIntentView["nextAction"];
  pool: {
    status: "unbound" | "lookup_disabled" | "controller_unapproved" | "match" | "mismatch" | "unavailable";
    contractAddress: `0x${string}` | null;
    controller: `0x${string}` | null;
    poolId: string | null;
    balanceBaseUnits: string | null;
    checkedAt: string | null;
  };
  checkedAt: string;
};

export type AgonEscrowTransactionApprovalRequest = {
  operation: "fund" | "release" | "refund";
  approvalIdempotencyKey: string;
  confirmation: string;
};

export type AgonEscrowTransactionApprovalView = {
  status: "approved" | "expired";
  approvalHash: string;
  intentId: string;
  actor: `0x${string}`;
  operation: "fund" | "release" | "refund";
  intentHash: string;
  approvalIdempotencyKey: string;
  testnetOnly: true;
  approvedAt: string;
  expiresAt: string;
  executionEnabled: false;
  nextAction: "transaction_adapter_not_enabled" | "refresh_expired_approval";
};

export type AgonEscrowTransactionApprovalReadinessView = {
  intentId: string;
  status: "approval_required" | "preflight_disabled" | "approved" | "expired";
  reason: string;
  approval: AgonEscrowTransactionApprovalView | null;
  executionEnabled: false;
  nextAction: "explicit_transaction_approval" | "enable_read_only_preflight" | "transaction_adapter_not_enabled" | "refresh_expired_approval";
  checkedAt: string;
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
