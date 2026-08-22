import { getAddress } from "viem";
import { AGON_ESCROW_NETWORK, AGON_ESCROW_USDC } from "../escrow-policy.ts";

const ADDRESS = /^0x[0-9a-f]{40}$/i;

export type AgonEscrowRuntimeReadiness = {
  testnetOnly: true;
  ready: boolean;
  executionEnabled: false;
  checkedAt: string;
  reasons: string[];
};

function validAddress(value: string | null | undefined): boolean {
  if (!value || !ADDRESS.test(value)) return false;
  try { getAddress(value); return true; } catch { return false; }
}

/**
 * Pure operator gate. It reports every missing prerequisite without touching
 * RPC, a signer, a wallet, or a transaction provider.
 */
export function evaluateAgonEscrowRuntimeReadiness(input: {
  network: string;
  asset: string;
  escrowAddress?: string | null;
  controller?: string | null;
  executionEnabled: boolean;
  preflightEnabled: boolean;
  writerEnabled: boolean;
  lifecycleAdapterEnabled: boolean;
  signerAvailable: boolean;
  now?: Date;
}): AgonEscrowRuntimeReadiness {
  const reasons: string[] = [];
  if (input.network !== AGON_ESCROW_NETWORK) reasons.push("network_not_arc_testnet");
  if (input.asset.toLowerCase() !== AGON_ESCROW_USDC.toLowerCase()) reasons.push("asset_not_arc_testnet_usdc");
  if (!validAddress(input.escrowAddress)) reasons.push("escrow_contract_unconfigured_or_invalid");
  if (!validAddress(input.controller)) reasons.push("controller_unconfigured_or_invalid");
  if (!input.executionEnabled) reasons.push("execution_flag_disabled");
  if (!input.preflightEnabled) reasons.push("write_preflight_disabled");
  if (!input.writerEnabled) reasons.push("transaction_writer_disabled");
  if (!input.lifecycleAdapterEnabled) reasons.push("lifecycle_adapter_disabled");
  if (!input.signerAvailable) reasons.push("signer_unavailable");
  return {
    testnetOnly: true,
    ready: reasons.length === 0,
    executionEnabled: false,
    checkedAt: (input.now ?? new Date()).toISOString(),
    reasons,
  };
}

