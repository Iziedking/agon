import type { AgonDeployment } from "../config/deployments.ts";

export const AGON_PROTOCOL_CONTRACTS = [
  "AgonProfileRegistry",
  "AgonServiceRegistry",
  "AgonJobEscrow",
  "AgonArena",
  "AgonSyndicateRegistry",
  "AgonPrizeVault",
] as const;

export type AgonProtocolContract = typeof AGON_PROTOCOL_CONTRACTS[number];

export type AgonProtocolReadiness = {
  ready: boolean;
  chainId: number | null;
  missingContracts: AgonProtocolContract[];
  unverifiedContracts: AgonProtocolContract[];
  externalRegistry: {
    identity: string | null;
    validation: string | null;
  };
  reasons: string[];
};

function validAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

/**
 * Receipt-only release gate. It does not call RPC, infer deployment state, or
 * enable any write path. A protocol is ready only when every Agon contract,
 * both ERC-8004 registry links, and source-verification records are present.
 */
export function inspectAgonProtocolReadiness(deployment: AgonDeployment | null): AgonProtocolReadiness {
  const missingContracts = AGON_PROTOCOL_CONTRACTS.filter((name) => !validAddress(deployment?.contracts[name]));
  const unverifiedContracts = AGON_PROTOCOL_CONTRACTS.filter((name) => !deployment?.sourceVerification?.[name]);
  const identity = deployment?.external.IdentityRegistry;
  const validation = deployment?.external.ValidationRegistry;
  const reasons: string[] = [];

  if (!deployment) reasons.push("deployment_missing");
  else if (deployment.chainId !== 5042002) reasons.push("deployment_chain_mismatch");
  if (missingContracts.length) reasons.push("protocol_contracts_incomplete");
  if (unverifiedContracts.length) reasons.push("source_verification_incomplete");
  if (!validAddress(identity?.address) || identity?.chainId !== 5042002) reasons.push("identity_registry_incomplete");
  if (!validAddress(validation?.address) || validation?.chainId !== 5042002) reasons.push("validation_registry_incomplete");

  return {
    ready: reasons.length === 0,
    chainId: deployment?.chainId ?? null,
    missingContracts,
    unverifiedContracts,
    externalRegistry: {
      identity: validAddress(identity?.address) ? identity.address : null,
      validation: validAddress(validation?.address) ? validation.address : null,
    },
    reasons,
  };
}
