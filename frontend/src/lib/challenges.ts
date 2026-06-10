import { parseAbi } from "viem";
import { CONTRACTS, publicClient } from "./arc";

/// ChallengeArena: peer-to-peer USDC-staked challenges. An operator creates one,
/// others join with an agent, the coordinator locks and resolves, winners claim.
/// If a challenge underfills or the coordinator misses the window, it cancels and
/// entrants refund.

export const challengeArenaAbi = parseAbi([
  "function createChallenge(uint8 kind, uint128 stake, uint64 maxEntrants, uint64 joinDeadline, uint64 resolveDeadline, bool isPrivate) returns (uint256)",
  "function invite(uint256 id, address[] invitees)",
  "function invited(uint256 id, address operator) view returns (bool)",
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

/// Public read of who's been invited to a private challenge.
export interface ChallengeInvitee {
  address: string;
  invitedAt: string;
}

export async function fetchChallengeInvites(id: number): Promise<ChallengeInvitee[]> {
  try {
    const res = await fetch(`${AUTH_URL}/challenges/${id}/invites`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as { invitees?: ChallengeInvitee[] };
    return data.invitees ?? [];
  } catch {
    return [];
  }
}

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

async function fetchChallengeOnce(id: number): Promise<Challenge | null> {
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
}

/// Read one challenge with one retry on transient RPC failure. We used to
/// catch and return null silently, which meant flaky reads (rate limit,
/// momentary disconnect) made the card vanish from the listing without
/// any signal. Now a single retry covers most transient cases; only a
/// genuine "creator is zero" (challenge doesn't exist) returns null.
export async function fetchChallenge(id: number): Promise<Challenge | null> {
  try {
    return await fetchChallengeOnce(id);
  } catch (e1) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      return await fetchChallengeOnce(id);
    } catch (e2) {
      // eslint-disable-next-line no-console
      console.warn(`fetchChallenge(${id}) failed after retry`, e2 ?? e1);
      return null;
    }
  }
}

/// Read every challenge from chain. Used by the challenges grid. The
/// publicClient batches all reads scheduled in the same tick through
/// Multicall3 (see lib/arc.ts), so this Promise.all lands on the RPC as a
/// few aggregate calls instead of ~600 individual reads. The old manual
/// CHUNK=30 loop predates batching and is gone: its sequential awaits
/// blocked the batcher and made the page crawl one chunk at a time.
export async function fetchChallenges(): Promise<Challenge[]> {
  const count = (await nextChallengeId()) - 1;
  if (count <= 0) return [];
  const ids: number[] = Array.from({ length: count }, (_, i) => i + 1);
  const out = await Promise.all(ids.map((id) => fetchChallenge(id)));
  return out.filter((c): c is Challenge => c !== null).reverse();
}

export async function hasJoined(id: number, operator: `0x${string}`): Promise<boolean> {
  try {
    return (await publicClient.readContract({ address: CONTRACTS.ChallengeArena, abi: challengeArenaAbi, functionName: "joined", args: [BigInt(id), operator] })) as boolean;
  } catch {
    return false;
  }
}

/// On-chain check: is this operator in a private challenge's invited set?
/// Always true-effective for public challenges (the join path skips the
/// invited gate), so callers only consult this when isPrivate.
export async function isInvited(id: number, operator: `0x${string}`): Promise<boolean> {
  try {
    return (await publicClient.readContract({ address: CONTRACTS.ChallengeArena, abi: challengeArenaAbi, functionName: "invited", args: [BigInt(id), operator] })) as boolean;
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

/// Cancelled challenges the operator joined that they still have a stake
/// to pull back. Joins the backend's list (which scans the indexer's
/// challenge_entries + challenges) with on-chain refunded() reads so rows
/// already refunded drop out. Cancelled contests the operator entered
/// surface here too as informational rows: entry to a contest is free,
/// so there's no stake to pull back, but the operator should still see
/// "this one was cancelled" instead of it vanishing.
///
/// The backend returns ALL non-settled challenges the operator joined and
/// we read chain truth per row, so two indexer gaps are covered:
///   - ChallengeCancelled hasn't been processed yet (status lag).
///   - Challenge is past joinDeadline / resolveDeadline but nobody has
///     called cancelChallenge() yet. The stake is recoverable but needs
///     a cancel tx first; the row is marked `stale_cancellable` so the
///     dashboard can render a CANCEL + REFUND button instead of REFUND.
export type RefundAction = "refund" | "cancel_then_refund";

export interface PendingRefund {
  id: number;
  stake: bigint;
  action: RefundAction;
}

export interface CancelledContestRef {
  id: number;
}

export interface PendingRefundsBundle {
  challenges: PendingRefund[];
  contests: CancelledContestRef[];
}

// Mirror of the on-chain enum so we can compare cleanly.
const STATUS_OPEN = 0;
const STATUS_LOCKED = 1;
const STATUS_CANCELLED = 3;

interface ChainChallenge {
  status: number;
  joinDeadline: bigint;
  resolveDeadline: bigint;
}

export async function fetchPendingRefunds(operator: `0x${string}`): Promise<PendingRefundsBundle> {
  try {
    const res = await fetch(`${AUTH_URL}/operators/${operator}/refunds-pending`, { cache: "no-store" });
    if (!res.ok) return { challenges: [], contests: [] };
    const data = (await res.json()) as {
      challenges?: Array<{ id: number; stake: string; indexedStatus?: string }>;
      contests?: Array<{ id: number }>;
    };
    const chRows = data.challenges ?? [];
    const ctRows = data.contests ?? [];
    const nowSec = BigInt(Math.floor(Date.now() / 1000));

    // Read chain truth for each row: actual status + deadlines + entrant
    // count + refunded flag for this operator. Multicall on one batch so
    // we make ~4 reads per row in parallel rather than 4 sequential.
    const enriched = await Promise.all(
      chRows.map(async (r) => {
        try {
          const [ch, entrants, refundedFlag] = await Promise.all([
            publicClient.readContract({
              address: CONTRACTS.ChallengeArena,
              abi: challengeArenaAbi,
              functionName: "getChallenge",
              args: [BigInt(r.id)],
            }) as Promise<ChainChallenge>,
            publicClient.readContract({
              address: CONTRACTS.ChallengeArena,
              abi: challengeArenaAbi,
              functionName: "entrantCount",
              args: [BigInt(r.id)],
            }) as Promise<bigint>,
            publicClient.readContract({
              address: CONTRACTS.ChallengeArena,
              abi: challengeArenaAbi,
              functionName: "refunded",
              args: [BigInt(r.id), operator],
            }).catch(() => false) as Promise<boolean>,
          ]);
          return { row: r, ch, entrants, refundedFlag };
        } catch {
          return null;
        }
      }),
    );

    const challenges: PendingRefund[] = [];
    for (const slot of enriched) {
      if (!slot) continue;
      const { row, ch, entrants, refundedFlag } = slot;
      const status = Number(ch.status);

      // Already pulled the stake back.
      if (refundedFlag) continue;

      if (status === STATUS_CANCELLED) {
        challenges.push({ id: row.id, stake: BigInt(row.stake), action: "refund" });
        continue;
      }

      // OPEN past joinDeadline with under 2 entrants: anyone can cancel
      // per the contract's stale-underfilled rule. Stake is recoverable
      // via a cancel tx then a refund tx.
      if (
        status === STATUS_OPEN &&
        nowSec > ch.joinDeadline &&
        entrants < 2n
      ) {
        challenges.push({ id: row.id, stake: BigInt(row.stake), action: "cancel_then_refund" });
        continue;
      }

      // LOCKED past resolveDeadline: coordinator failed to resolve in
      // time, anyone can cancel. Stake is recoverable.
      if (status === STATUS_LOCKED && nowSec > ch.resolveDeadline) {
        challenges.push({ id: row.id, stake: BigInt(row.stake), action: "cancel_then_refund" });
        continue;
      }
      // Otherwise the challenge is still healthy: open with a live join
      // window, or locked but the resolve window hasn't expired. Nothing
      // to do from the dashboard.
    }

    return { challenges, contests: ctRows.map((r) => ({ id: r.id })) };
  } catch {
    return { challenges: [], contests: [] };
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
