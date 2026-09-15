import { getAddress, keccak256, stringToHex } from "viem";

export const AGON_ARENA_EVALUATOR_ROLE = keccak256(stringToHex("EVALUATOR_ROLE"));

export type AgonArenaRoleReadClient = {
  readContract(input: { address: `0x${string}`; abi: readonly unknown[]; functionName: "hasRole"; args: readonly unknown[] }): Promise<unknown>;
};

export type AgonArenaEvaluatorReadiness = {
  enabled: boolean;
  arenaAddress: `0x${string}`;
  evaluatorAddress: `0x${string}` | null;
  role: `0x${string}`;
  assigned: boolean;
  reason: "assigned" | "evaluator_not_configured" | "role_not_assigned" | "read_failed" | "disabled";
};

const ABI = [{ type: "function", name: "hasRole", stateMutability: "view", inputs: [{ name: "role", type: "bytes32" }, { name: "account", type: "address" }], outputs: [{ name: "", type: "bool" }] }] as const;

function address(value: string, label: string): `0x${string}` {
  try { return getAddress(value).toLowerCase() as `0x${string}`; } catch { throw new Error(`${label} must be a valid EVM address`); }
}

/** Read-only evaluator role check. It never builds or submits an admin write. */
export async function readAgonArenaEvaluatorReadiness(input: {
  enabled: boolean;
  client?: AgonArenaRoleReadClient;
  arenaAddress: string;
  evaluatorAddress?: string;
}): Promise<AgonArenaEvaluatorReadiness> {
  const arenaAddress = address(input.arenaAddress, "Arena address");
  const evaluatorAddress = input.evaluatorAddress ? address(input.evaluatorAddress, "evaluator address") : null;
  if (!input.enabled || !input.client) return { enabled: false, arenaAddress, evaluatorAddress, role: AGON_ARENA_EVALUATOR_ROLE, assigned: false, reason: "disabled" };
  if (!evaluatorAddress) return { enabled: true, arenaAddress, evaluatorAddress: null, role: AGON_ARENA_EVALUATOR_ROLE, assigned: false, reason: "evaluator_not_configured" };
  try {
    const assigned = await input.client.readContract({ address: arenaAddress, abi: ABI, functionName: "hasRole", args: [AGON_ARENA_EVALUATOR_ROLE, evaluatorAddress] });
    if (assigned !== true && assigned !== false) throw new Error("invalid role result");
    return { enabled: true, arenaAddress, evaluatorAddress, role: AGON_ARENA_EVALUATOR_ROLE, assigned, reason: assigned ? "assigned" : "role_not_assigned" };
  } catch {
    return { enabled: true, arenaAddress, evaluatorAddress, role: AGON_ARENA_EVALUATOR_ROLE, assigned: false, reason: "read_failed" };
  }
}
