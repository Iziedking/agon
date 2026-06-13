import { parseAbi } from "viem";
import { CONTRACTS, publicClient } from "./arc";

/// ChallengeArena: peer-to-peer USDC-staked challenges. An operator creates one,
/// others join with an agent, the coordinator locks and resolves, winners claim.
/// If a challenge underfills or the coordinator misses the window, it cancels and
/// entrants refund.

export const challengeArenaAbi = parseAbi([
  "function createChallenge(uint8 kind, uint128 stake, uint64 maxEntrants, uint64 joinDeadline, uint64 resolveDeadline, bool isPrivate, uint16 minTier, uint16 maxTier) returns (uint256)",
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

export async function fetchPendingRefunds(operator: `0x${string}`): Promise<PendingRefundsBundle> {
  // Discover refundable challenges from CHAIN truth, not the indexer. We used
  // to read the backend's challenge_entries table here, but that table can
  // miss a join the indexer never caught (node downtime, a join before
  // START_BLOCK, a DB rebuild). When that happened the challenge detail page
  // still showed the REFUND STAKE button (it reads the contract directly via
  // hasJoined) while the dashboard silently dropped the row. Now the
  // dashboard mirrors the detail page exactly: scan every challenge on chain,
  // keep the ones this wallet actually staked into that are cancelled (or
  // stale and cancellable) and not yet refunded. publicClient batches these
  // reads through Multicall3, same as the /challenges grid.
  let challenges: PendingRefund[] = [];
  try {
    const all = await fetchChallenges();
    const nowSec = BigInt(Math.floor(Date.now() / 1000));

    // Narrow to challenges whose stake is recoverable before touching the
    // per-operator joined/refunded reads, so we only do that work for the
    // handful of cancelled/stale challenges rather than every one ever made.
    const candidates = all.filter((ch) => {
      if (ch.status === STATUS_CANCELLED) return true;
      // OPEN past joinDeadline with under 2 entrants: the contract's stale
      // underfilled rule lets anyone cancel, so the stake is recoverable via
      // a cancel tx then a refund tx.
      if (ch.status === STATUS_OPEN && nowSec > ch.joinDeadline && ch.entrants < 2) return true;
      // LOCKED past resolveDeadline: coordinator never resolved, anyone can
      // cancel. Stake is recoverable the same way.
      if (ch.status === STATUS_LOCKED && nowSec > ch.resolveDeadline) return true;
      return false;
    });

    const enriched = await Promise.all(
      candidates.map(async (ch) => {
        const [didJoin, didRefund] = await Promise.all([
          hasJoined(ch.id, operator),
          hasRefunded(ch.id, operator),
        ]);
        return { ch, didJoin, didRefund };
      }),
    );

    challenges = enriched
      .filter((s) => s.didJoin && !s.didRefund)
      .map((s) => ({
        id: s.ch.id,
        stake: s.ch.stake,
        action: s.ch.status === STATUS_CANCELLED ? "refund" : "cancel_then_refund",
      }));
  } catch {
    challenges = [];
  }

  // Cancelled contests the operator entered stay an indexer read: contest
  // entry is free, so these rows are purely informational and there is no
  // chain stake to recover. The endpoint still returns them.
  let contests: CancelledContestRef[] = [];
  try {
    const res = await fetch(`${AUTH_URL}/operators/${operator}/refunds-pending`, { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { contests?: Array<{ id: number }> };
      contests = (data.contests ?? []).map((r) => ({ id: r.id }));
    }
  } catch {
    // contests list is non-critical; leave it empty on failure.
  }

  return { challenges, contests };
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
