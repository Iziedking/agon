import { parseAbi } from "viem";
import { CONTRACTS, publicClient } from "./arc";

/// ChallengeArena: peer-to-peer USDC-staked challenges. An operator creates one,
/// others join with an agent, the coordinator locks and resolves, winners claim.
/// If a challenge underfills or the coordinator misses the window, it cancels and
/// entrants refund.

export const challengeArenaAbi = parseAbi([
  "function createChallenge(uint8 kind, uint128 stake, uint64 maxEntrants, uint64 joinDeadline, uint64 resolveDeadline, bool isPrivate) returns (uint256)",
  "function nextChallengeId() view returns (uint256)",
  "function getChallenge(uint256 id) view returns ((address creator, uint8 kind, uint8 status, bool isPrivate, uint16 platformFeeBps, uint128 stake, uint64 maxEntrants, uint64 joinDeadline, uint64 resolveDeadline, bytes32 winnerRoot))",
  "function entrantCount(uint256 id) view returns (uint64)",
  "function joined(uint256 id, address operator) view returns (bool)",
  "function payoutClaimed(uint256 id, address operator) view returns (bool)",
  "function refunded(uint256 id, address operator) view returns (bool)",
  "function joinChallenge(uint256 id, uint256 agentId)",
  "function claimChallengePayout(uint256 id, uint256 amount, bytes32[] proof)",
  "function refund(uint256 id)",
]);

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";
const ZERO = "0x0000000000000000000000000000000000000000";

export const CHALLENGE_KIND = ["Prediction", "Puzzle", "Volume", "Custom"] as const;
export const CHALLENGE_STATUS = ["Open", "Locked", "Settled", "Cancelled"] as const;

export interface Challenge {
  id: number;
  creator: `0x${string}`;
  kind: number;
  status: number;
  isPrivate: boolean;
  platformFeeBps: number;
  stake: bigint;
  maxEntrants: number;
  joinDeadline: bigint;
  resolveDeadline: bigint;
  winnerRoot: `0x${string}`;
  entrants: number;
}

/// The id the next created challenge will get.
export async function nextChallengeId(): Promise<number> {
  const n = await publicClient.readContract({
    address: CONTRACTS.ChallengeArena,
    abi: challengeArenaAbi,
    functionName: "nextChallengeId",
  });
  return Number(n);
}

export async function fetchChallenge(id: number): Promise<Challenge | null> {
  try {
    const [ch, entrants] = await Promise.all([
      publicClient.readContract({ address: CONTRACTS.ChallengeArena, abi: challengeArenaAbi, functionName: "getChallenge", args: [BigInt(id)] }),
      publicClient.readContract({ address: CONTRACTS.ChallengeArena, abi: challengeArenaAbi, functionName: "entrantCount", args: [BigInt(id)] }),
    ]);
    if (ch.creator === ZERO) return null;
    return {
      id,
      creator: ch.creator,
      kind: Number(ch.kind),
      status: Number(ch.status),
      isPrivate: ch.isPrivate,
      platformFeeBps: Number(ch.platformFeeBps),
      stake: ch.stake,
      maxEntrants: Number(ch.maxEntrants),
      joinDeadline: ch.joinDeadline,
      resolveDeadline: ch.resolveDeadline,
      winnerRoot: ch.winnerRoot,
      entrants: Number(entrants),
    };
  } catch {
    return null;
  }
}

export async function fetchChallenges(): Promise<Challenge[]> {
  const count = (await nextChallengeId()) - 1;
  if (count <= 0) return [];
  const ids = Array.from({ length: count }, (_, i) => i + 1);
  const all = await Promise.all(ids.map((id) => fetchChallenge(id)));
  return all.filter((c): c is Challenge => c !== null).reverse();
}

export async function hasJoined(id: number, operator: `0x${string}`): Promise<boolean> {
  try {
    return (await publicClient.readContract({ address: CONTRACTS.ChallengeArena, abi: challengeArenaAbi, functionName: "joined", args: [BigInt(id), operator] })) as boolean;
  } catch {
    return false;
  }
}

export async function hasClaimedChallenge(id: number, operator: `0x${string}`): Promise<boolean> {
  try {
    return (await publicClient.readContract({ address: CONTRACTS.ChallengeArena, abi: challengeArenaAbi, functionName: "payoutClaimed", args: [BigInt(id), operator] })) as boolean;
  } catch {
    return false;
  }
}

export async function hasRefunded(id: number, operator: `0x${string}`): Promise<boolean> {
  try {
    return (await publicClient.readContract({ address: CONTRACTS.ChallengeArena, abi: challengeArenaAbi, functionName: "refunded", args: [BigInt(id), operator] })) as boolean;
  } catch {
    return false;
  }
}

/// The operator's payout for a resolved challenge: amount and merkle proof for
/// claimChallengePayout. Null if they did not win. Served by the coordinator.
export async function fetchChallengePayout(
  id: number,
  operator: string,
): Promise<{ amount: bigint; proof: `0x${string}`[] } | null> {
  try {
    const res = await fetch(`${AUTH_URL}/challenges/${id}/payout?operator=${operator}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { amount: string | null; proof?: `0x${string}`[] };
    if (!data || data.amount == null) return null;
    return { amount: BigInt(data.amount), proof: data.proof ?? [] };
  } catch {
    return null;
  }
}
