import { CONTRACTS, publicClient } from "./arc";
import { contestEngineAbi, hasClaimed } from "./contests";
import { challengeArenaAbi, hasClaimedChallenge } from "./challenges";

/// Unified pending-winnings list: contests + challenges the operator has
/// won but not yet claimed. Backend returns the raw payouts; this helper
/// pairs each row with the on-chain claim check so already-claimed rows
/// drop out before reaching the dashboard.

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

export type WinningSource = "contest" | "challenge";

export interface PendingWinning {
  source: WinningSource;
  id: number;
  amount: bigint;
  /// Contest type number (0=Scout, 1=Analyst, 2=Solver) or challenge kind
  /// (0=Prediction, 1=Puzzle, 2=Volume, 3=Custom). Optional because the
  /// indexer may not have synced the kind yet for very fresh rows.
  typeNum: number | null;
}

interface ContestRow { id: number; amount: string; contestType: number | null }
interface ChallengeRow { id: number; amount: string; kind: number | null }

export async function fetchPendingWinnings(operator: `0x${string}`): Promise<PendingWinning[]> {
  try {
    const res = await fetch(`${AUTH_URL}/operators/${operator}/winnings-pending`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as { contests?: ContestRow[]; challenges?: ChallengeRow[] };

    const contestRows = data.contests ?? [];
    const challengeRows = data.challenges ?? [];

    // On-chain checks in parallel: is it claimed, and is the event actually
    // SETTLED on-chain. The backend serves a payout row as soon as scoring
    // persists it, but the prize is only real once the winner root is posted
    // (contest status 3 / challenge status 2). An event that scored but missed
    // its resolve deadline keeps a payout row yet never settles — it cancels and
    // refunds — so showing it as a claimable prize produces the "claim reverts
    // and comes back" confusion. Gate on settled so phantom prizes drop out and
    // surface as refunds instead.
    const [contestClaimed, challengeClaimed, contestSettled, challengeSettled] = await Promise.all([
      Promise.all(contestRows.map((r) => hasClaimed(r.id, operator).catch(() => false))),
      Promise.all(challengeRows.map((r) => hasClaimedChallenge(r.id, operator).catch(() => false))),
      Promise.all(contestRows.map((r) => isContestSettled(r.id).catch(() => false))),
      Promise.all(challengeRows.map((r) => isChallengeSettled(r.id).catch(() => false))),
    ]);

    const unclaimed: PendingWinning[] = [];
    contestRows.forEach((r, i) => {
      if (contestSettled[i] && !contestClaimed[i]) {
        unclaimed.push({ source: "contest", id: r.id, amount: BigInt(r.amount), typeNum: r.contestType });
      }
    });
    challengeRows.forEach((r, i) => {
      if (challengeSettled[i] && !challengeClaimed[i]) {
        unclaimed.push({ source: "challenge", id: r.id, amount: BigInt(r.amount), typeNum: r.kind });
      }
    });
    // Sort by amount descending so the biggest payout is the first thing
    // the eye lands on.
    unclaimed.sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
    return unclaimed;
  } catch {
    return [];
  }
}

/// True only when the contest is SETTLED on-chain (status 3 = settled, winner
/// root posted), so a prize is genuinely claimable. A contest that scored but
/// never settled, or was cancelled (status 4), is not — its DB payout row is a
/// phantom and any "claim" would revert.
async function isContestSettled(id: number): Promise<boolean> {
  const c = (await publicClient.readContract({
    address: CONTRACTS.ContestEngine,
    abi: contestEngineAbi,
    functionName: "getContest",
    args: [BigInt(id)],
  })) as { status: number };
  return Number(c.status) === 3;
}

/// True only when the challenge is SETTLED on-chain (status 2). A locked-but-
/// unsettled or cancelled (status 3) challenge is not — a cancelled one refunds
/// the stake through the refunds flow, it is not a claimable prize.
async function isChallengeSettled(id: number): Promise<boolean> {
  const ch = (await publicClient.readContract({
    address: CONTRACTS.ChallengeArena,
    abi: challengeArenaAbi,
    functionName: "getChallenge",
    args: [BigInt(id)],
  })) as { status: number };
  return Number(ch.status) === 2;
}

/// Build the merkle proof + amount needed for the claim call. Source-aware
/// so callers don't have to branch on contest vs challenge.
export async function fetchClaimProof(
  source: WinningSource,
  id: number,
  operator: string,
): Promise<{ amount: bigint; proof: `0x${string}`[] } | null> {
  const endpoint = source === "contest"
    ? `${AUTH_URL}/contests/${id}/payout?operator=${operator}`
    : `${AUTH_URL}/challenges/${id}/payout?operator=${operator}`;
  try {
    const res = await fetch(endpoint);
    if (!res.ok) return null;
    const data = (await res.json()) as { amount: string | null; proof?: `0x${string}`[] };
    if (!data || data.amount == null) return null;
    return { amount: BigInt(data.amount), proof: data.proof ?? [] };
  } catch {
    return null;
  }
}

/// The contract address + function shape used to claim a given winning.
/// Lets the dashboard build the writeContract args without knowing the
/// claim function names per kind.
export function claimWriteShape(source: WinningSource) {
  if (source === "contest") {
    return {
      address: CONTRACTS.ContestEngine,
      abi: contestEngineAbi,
      functionName: "claimPrize" as const,
    };
  }
  return {
    address: CONTRACTS.ChallengeArena,
    abi: challengeArenaAbi,
    functionName: "claimChallengePayout" as const,
  };
}

// Re-export publicClient passthrough so the dashboard can wait on receipts
// without importing arc.ts directly twice.
export { publicClient };
