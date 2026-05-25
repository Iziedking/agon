import { parseAbi } from "viem";
import { CONTRACTS, publicClient } from "./arc";

/// ChallengeArena: peer-to-peer USDC-staked challenges. An operator creates one,
/// others join with an agent, the coordinator resolves, winners claim. This file
/// covers creation; join and claim land with the full challenge loop.

export const challengeArenaAbi = parseAbi([
  "function createChallenge(uint8 kind, uint128 stake, uint64 maxEntrants, uint64 joinDeadline, uint64 resolveDeadline, bool isPrivate) returns (uint256)",
  "function nextChallengeId() view returns (uint256)",
]);

export const CHALLENGE_KIND = ["Prediction", "Puzzle", "Volume", "Custom"] as const;

/// The id the next created challenge will get. Read before creating so we can
/// show the operator the id of the challenge they just opened.
export async function nextChallengeId(): Promise<number> {
  const n = await publicClient.readContract({
    address: CONTRACTS.ChallengeArena,
    abi: challengeArenaAbi,
    functionName: "nextChallengeId",
  });
  return Number(n);
}
