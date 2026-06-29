import { parseAbi } from "viem";
import { CONTRACTS, publicClient } from "./arc";

/// Reads SyndicateFactory state from Arc and exposes the write entrypoints for
/// joining and leaving. Join auto-switches if the operator is already in a
/// different syndicate, per the contract.

export const syndicateFactoryAbi = parseAbi([
  "function joinSyndicate(uint256 syndicateId)",
  "function leaveSyndicate()",
  "function getSyndicate(uint256 syndicateId) view returns ((uint256 id, string name, string theme, address founder, uint128 totalReputation, uint64 memberCount, bool isCustom, uint16 platformFeeBps))",
  "function getMembership(uint256 syndicateId, address member) view returns ((uint256 syndicateId, uint64 joinedAt, uint128 contribution))",
  "function syndicateCount() view returns (uint256)",
  "function currentSyndicate(address) view returns (uint256)",
]);

export interface Syndicate {
  id: number;
  name: string;
  theme: string;
  founder: `0x${string}`;
  totalReputation: bigint;
  memberCount: number;
  isCustom: boolean;
  platformFeeBps: number;
}

export interface Membership {
  syndicateId: number;
  joinedAt: number;
  contribution: bigint;
}

export async function fetchSyndicate(id: number): Promise<Syndicate | null> {
  try {
    const s = await publicClient.readContract({
      address: CONTRACTS.SyndicateFactory,
      abi: syndicateFactoryAbi,
      functionName: "getSyndicate",
      args: [BigInt(id)],
    });
    if (Number(s.id) === 0) return null;
    return {
      id: Number(s.id),
      name: s.name,
      theme: s.theme,
      founder: s.founder,
      totalReputation: s.totalReputation,
      memberCount: Number(s.memberCount),
      isCustom: s.isCustom,
      platformFeeBps: Number(s.platformFeeBps),
    };
  } catch {
    return null;
  }
}

export async function fetchSyndicates(): Promise<Syndicate[]> {
  const count = (await publicClient.readContract({
    address: CONTRACTS.SyndicateFactory,
    abi: syndicateFactoryAbi,
    functionName: "syndicateCount",
  })) as bigint;
  const n = Number(count);
  if (n <= 0) return [];
  const ids = Array.from({ length: n }, (_, i) => i + 1);
  const all = await Promise.all(ids.map(fetchSyndicate));
  return all.filter((s): s is Syndicate => s !== null);
}

export async function fetchCurrentSyndicate(owner: `0x${string}`): Promise<number> {
  try {
    const id = (await publicClient.readContract({
      address: CONTRACTS.SyndicateFactory,
      abi: syndicateFactoryAbi,
      functionName: "currentSyndicate",
      args: [owner],
    })) as bigint;
    return Number(id);
  } catch {
    return 0;
  }
}

export async function fetchMembership(syndicateId: number, member: `0x${string}`): Promise<Membership | null> {
  try {
    const m = await publicClient.readContract({
      address: CONTRACTS.SyndicateFactory,
      abi: syndicateFactoryAbi,
      functionName: "getMembership",
      args: [BigInt(syndicateId), member],
    });
    return {
      syndicateId: Number(m.syndicateId),
      joinedAt: Number(m.joinedAt),
      contribution: m.contribution,
    };
  } catch {
    return null;
  }
}

export function formatReputationBig(raw: bigint): number {
  // Reputation is stored at 1e6 precision on-chain (per AgentRegistry). Render
  // as whole points to match the rest of the UI.
  return Math.round(Number(raw) / 1e6);
}

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

export interface SyndicateLeaderRow {
  rank: number;
  syndicateId: number;
  name: string | null;
  reputation: string; // 1e6-scaled reputation earned this ISO-week
  memberCount: number;
}

/// Weekly syndicate leaderboard: reputation each syndicate's members earned this
/// ISO-week, resetting every Monday so no syndicate keeps an all-time lead.
/// Returns [] on any error so the page renders empty rather than throwing.
export async function fetchSyndicateLeaderboard(): Promise<SyndicateLeaderRow[]> {
  try {
    const res = await fetch(`${AUTH_URL}/syndicates/leaderboard`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as { syndicates?: SyndicateLeaderRow[] };
    return data.syndicates ?? [];
  } catch {
    return [];
  }
}
