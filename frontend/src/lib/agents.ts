import { parseAbi } from "viem";
import { publicClient, CONTRACTS } from "./arc";

/// Reads agent state from AgentRegistry on Arc, plus the bits needed to upgrade.

export const agentRegistryAbi = parseAbi([
  "function agentsOf(address owner) view returns (uint256[])",
  "function getAgent(uint256 agentId) view returns ((address owner, uint16 scoutTier, uint16 analystTier, uint16 solverTier, uint128 reputation, uint64 lastActivityAt, uint64 createdAt, uint256 erc8004TokenId))",
  "function upgradePrice(uint8 cType, uint16 fromTier) view returns (uint256)",
  "function upgradeAgent(uint256 agentId, uint8 cType, uint16 newTier)",
  "function createAgent(string metadataURI) returns (uint256)",
]);

export const erc20Abi = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
]);

export const CONTEST_TYPES = ["scout", "analyst", "solver"] as const;
export type ContestTypeName = (typeof CONTEST_TYPES)[number];
export const MAX_TIER = 2; // v0 ships tiers 0 to 2

/// Abilities at each tier, by contest type. Index = tier.
export const ABILITIES: Record<ContestTypeName, string[]> = {
  scout: [
    "5 swaps per contest, $10 max each, single dex",
    "20 swaps, $100 max each, two dexs, basic liquidity",
    "unlimited swaps, $1000 max, all dexs, cctp bridge",
  ],
  analyst: [
    "random predictions with a base-rate bias",
    "market data feeds and sharper logic",
    "advanced prediction models",
  ],
  solver: [
    "basic puzzle attempts, low compute",
    "more puzzle types, higher compute budget",
    "the full puzzle suite, fast solves",
  ],
};

export interface AgentState {
  id: number;
  scoutTier: number;
  analystTier: number;
  solverTier: number;
  reputation: bigint;
}

export function ctypeIndex(t: ContestTypeName): number {
  return t === "scout" ? 0 : t === "analyst" ? 1 : 2;
}

export function tierOf(a: AgentState, t: ContestTypeName): number {
  return t === "scout" ? a.scoutTier : t === "analyst" ? a.analystTier : a.solverTier;
}

export function usdc(amount6: bigint): string {
  return `${(Number(amount6) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`;
}

/// The operator's first agent, or null if they have none yet.
export async function fetchFirstAgent(owner: `0x${string}`): Promise<AgentState | null> {
  const ids = (await publicClient.readContract({
    address: CONTRACTS.AgentRegistry,
    abi: agentRegistryAbi,
    functionName: "agentsOf",
    args: [owner],
  })) as readonly bigint[];
  if (ids.length === 0) return null;

  const id = ids[0];
  const a = await publicClient.readContract({
    address: CONTRACTS.AgentRegistry,
    abi: agentRegistryAbi,
    functionName: "getAgent",
    args: [id],
  });
  return {
    id: Number(id),
    scoutTier: Number(a.scoutTier),
    analystTier: Number(a.analystTier),
    solverTier: Number(a.solverTier),
    reputation: a.reputation,
  };
}

export async function fetchPrice(t: ContestTypeName, fromTier: number): Promise<bigint> {
  return (await publicClient.readContract({
    address: CONTRACTS.AgentRegistry,
    abi: agentRegistryAbi,
    functionName: "upgradePrice",
    args: [ctypeIndex(t), fromTier],
  })) as bigint;
}
