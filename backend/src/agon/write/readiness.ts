import { getAddress, type PublicClient } from "viem";
import type { AgonDeployment } from "../../config/deployments.ts";
import { agonProfileRegistryAbi, agonServiceRegistryAbi } from "./abi.ts";

export type AgonReadinessReason =
  | "writes_disabled"
  | "deployment_unavailable"
  | "configured_chain_mismatch"
  | "rpc_unavailable"
  | "rpc_chain_mismatch"
  | "profile_code_missing"
  | "service_code_missing"
  | "identity_registry_mismatch"
  | "profile_registry_link_mismatch";

export type AgonReadiness = {
  ready: boolean;
  checkedAt: string;
  reasons: AgonReadinessReason[];
};

export type AgonReadinessOptions = {
  enabled: boolean;
  configuredChainId: number;
  deployment: AgonDeployment | null;
  client: Pick<PublicClient, "getChainId" | "getBytecode" | "readContract">;
};

function sameAddress(left: string, right: string): boolean {
  try {
    return getAddress(left) === getAddress(right);
  } catch {
    return false;
  }
}

export async function inspectAgonReadiness(options: AgonReadinessOptions): Promise<AgonReadiness> {
  const reasons: AgonReadinessReason[] = [];
  const checkedAt = new Date().toISOString();
  if (!options.enabled) reasons.push("writes_disabled");
  if (!options.deployment) reasons.push("deployment_unavailable");
  if (!options.enabled || !options.deployment) return { ready: false, checkedAt, reasons };

  const deployment = options.deployment;
  if (deployment.chainId !== options.configuredChainId) reasons.push("configured_chain_mismatch");

  let rpcChainId: number;
  try {
    rpcChainId = await options.client.getChainId();
  } catch {
    reasons.push("rpc_unavailable");
    return { ready: false, checkedAt, reasons };
  }
  if (rpcChainId !== deployment.chainId) reasons.push("rpc_chain_mismatch");

  try {
    const [profileCode, serviceCode, identityRegistry, linkedProfiles] = await Promise.all([
      options.client.getBytecode({ address: deployment.contracts.AgonProfileRegistry }),
      options.client.getBytecode({ address: deployment.contracts.AgonServiceRegistry }),
      options.client.readContract({
        address: deployment.contracts.AgonProfileRegistry,
        abi: agonProfileRegistryAbi,
        functionName: "identityRegistry",
      }),
      options.client.readContract({
        address: deployment.contracts.AgonServiceRegistry,
        abi: agonServiceRegistryAbi,
        functionName: "profiles",
      }),
    ]);
    if (!profileCode || profileCode === "0x") reasons.push("profile_code_missing");
    if (!serviceCode || serviceCode === "0x") reasons.push("service_code_missing");
    if (!sameAddress(String(identityRegistry), deployment.external.IdentityRegistry.address)) {
      reasons.push("identity_registry_mismatch");
    }
    if (!sameAddress(String(linkedProfiles), deployment.contracts.AgonProfileRegistry)) {
      reasons.push("profile_registry_link_mismatch");
    }
  } catch {
    reasons.push("rpc_unavailable");
  }

  return { ready: reasons.length === 0, checkedAt, reasons };
}

export class CachedAgonReadiness {
  private cached: { expiresAt: number; value: AgonReadiness } | null = null;
  private readonly options: AgonReadinessOptions;
  private readonly ttlMs: number;

  constructor(options: AgonReadinessOptions, ttlMs = 30_000) {
    this.options = options;
    this.ttlMs = ttlMs;
  }

  async get(force = false): Promise<AgonReadiness> {
    const now = Date.now();
    if (!force && this.cached && this.cached.expiresAt > now) return this.cached.value;
    const value = await inspectAgonReadiness(this.options);
    this.cached = { expiresAt: now + this.ttlMs, value };
    return value;
  }
}
