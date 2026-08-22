import { getAddress } from "viem";
import { AGON_ESCROW_NETWORK, AGON_ESCROW_USDC } from "../escrow-policy.ts";
import { AGON_ESCROW_TRANSACTION_APPROVAL_PHRASES } from "./escrow-transaction-approval.ts";

const ARC_TESTNET_CHAIN_ID = 5_042_002;
const ADDRESS = /^0x[0-9a-f]{40}$/i;

type DeploymentShape = {
  chainId?: number;
  contracts?: {
    AgonProfileRegistry?: string;
    AgonServiceRegistry?: string;
    PrizeEscrow?: string;
  };
  external?: {
    IdentityRegistry?: { address?: string; chainId?: number };
  };
};

export type AgonEscrowProductionReadiness = {
  testnetOnly: true;
  ready: boolean;
  executionEnabled: false;
  checkedAt: string;
  reasons: string[];
  requiredApprovals: string[];
};

function validAddress(value: unknown): boolean {
  if (typeof value !== "string" || !ADDRESS.test(value)) return false;
  try {
    getAddress(value);
    return true;
  } catch {
    return false;
  }
}

/** Pure release gate; it never reads RPC, constructs a signer, or submits a tx. */
export function evaluateAgonEscrowProductionReadiness(input: {
  chainId: number | string;
  network: string;
  asset: string;
  deployment: DeploymentShape | null | undefined;
  prizeEscrowAddress?: string | null;
  controller?: string | null;
  controllerPolicyConfigured: boolean;
  flags: {
    writesEnabled: boolean;
    escrowEnabled: boolean;
    executionEnabled: boolean;
    preflightEnabled: boolean;
    writerEnabled: boolean;
    lifecycleAdapterEnabled: boolean;
    reconciliationEnabled: boolean;
  };
  approvalRequired: boolean;
  approvalPhrases?: Partial<Record<keyof typeof AGON_ESCROW_TRANSACTION_APPROVAL_PHRASES, string>>;
  exactTransactionPlanBound: boolean;
  signerAvailable: boolean;
  providerFinalityConfigured: boolean;
  now?: Date;
}): AgonEscrowProductionReadiness {
  const reasons: string[] = [];
  const requiredApprovals: string[] = [];
  const chainId = typeof input.chainId === "string" ? Number(input.chainId) : input.chainId;

  if (chainId !== ARC_TESTNET_CHAIN_ID) reasons.push("chain_not_arc_testnet");
  if (input.network !== AGON_ESCROW_NETWORK) reasons.push("network_not_arc_testnet");
  if (input.asset.toLowerCase() !== AGON_ESCROW_USDC.toLowerCase()) reasons.push("asset_not_arc_testnet_usdc");

  const deployment = input.deployment;
  if (!deployment) {
    reasons.push("deployment_missing");
  } else {
    if (deployment.chainId !== ARC_TESTNET_CHAIN_ID) reasons.push("deployment_chain_mismatch");
    if (!validAddress(deployment.contracts?.AgonProfileRegistry)) reasons.push("profile_registry_missing_or_invalid");
    if (!validAddress(deployment.contracts?.AgonServiceRegistry)) reasons.push("service_registry_missing_or_invalid");
    const identity = deployment.external?.IdentityRegistry;
    if (!validAddress(identity?.address) || identity?.chainId !== ARC_TESTNET_CHAIN_ID) {
      reasons.push("identity_registry_missing_or_invalid");
    }
  }

  const escrowAddress = input.prizeEscrowAddress ?? deployment?.contracts?.PrizeEscrow;
  if (!validAddress(escrowAddress)) reasons.push("prize_escrow_not_deployed");
  if (!validAddress(input.controller)) reasons.push("escrow_controller_unconfigured");
  if (!input.controllerPolicyConfigured) reasons.push("controller_policy_unconfigured");

  if (!input.flags.writesEnabled) reasons.push("writes_flag_disabled");
  if (!input.flags.escrowEnabled) reasons.push("escrow_flag_disabled");
  if (!input.flags.executionEnabled) reasons.push("execution_flag_disabled");
  if (!input.flags.preflightEnabled) reasons.push("write_preflight_disabled");
  if (!input.flags.writerEnabled) reasons.push("transaction_writer_disabled");
  if (!input.flags.lifecycleAdapterEnabled) reasons.push("lifecycle_adapter_disabled");
  if (!input.flags.reconciliationEnabled) reasons.push("reconciliation_flag_disabled");

  if (!input.approvalRequired) {
    reasons.push("per_transaction_approval_required");
  } else {
    for (const operation of Object.keys(AGON_ESCROW_TRANSACTION_APPROVAL_PHRASES) as Array<keyof typeof AGON_ESCROW_TRANSACTION_APPROVAL_PHRASES>) {
      if (input.approvalPhrases?.[operation] !== AGON_ESCROW_TRANSACTION_APPROVAL_PHRASES[operation]) {
        requiredApprovals.push(operation);
      }
    }
    if (requiredApprovals.length > 0) reasons.push("approval_phrase_required");
  }

  if (!input.exactTransactionPlanBound) reasons.push("exact_transaction_plan_not_bound");
  if (!input.signerAvailable) reasons.push("signer_unavailable");
  if (!input.providerFinalityConfigured) reasons.push("provider_finality_not_configured");

  return {
    testnetOnly: true,
    ready: reasons.length === 0,
    executionEnabled: false,
    checkedAt: (input.now ?? new Date()).toISOString(),
    reasons,
    requiredApprovals,
  };
}
