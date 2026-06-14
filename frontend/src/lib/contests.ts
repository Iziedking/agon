import { keccak256, parseAbi, toBytes } from "viem";
import { CONTRACTS, publicClient } from "./arc";

/// Reads contest state straight from ContestEngine on Arc. No backend needed:
/// the page talks to the chain directly.

export const contestEngineAbi = parseAbi([
  "function nextContestId() view returns (uint256)",
  "function getContest(uint256 contestId) view returns ((uint8 contestType, uint8 status, uint16 winnerCutBps, uint16 topN, uint16 platformFeeBps, address sponsor, address protocolTarget, bytes32 metric, uint64 startTime, uint64 endTime, uint256 prizePool, bytes32 finalRoot))",
  "function entryCount(uint256 contestId) view returns (uint64)",
  "function agentEntered(uint256 contestId, uint256 agentId) view returns (bool)",
  "function registerEntry(uint256 contestId, uint256 agentId, uint256 syndicateId)",
  "function prizeClaimed(uint256 contestId, address operator) view returns (bool)",
  "function claimPrize(uint256 contestId, uint256 amount, bytes32[] proof)",
  "function listContest(uint8 cType, address protocolTarget, bytes32 metric, uint256 prizePool, uint64 duration, uint16 winnerCutBps, uint16 topN, uint16 minTier, uint16 maxTier) returns (uint256)",
  "function listingFeeBps() view returns (uint16)",
]);

/// The scoring metric each contest family settles on (matches the coordinator).
export const METRIC_FOR_TYPE = ["VOLUME", "BRIER", "PUZZLE"] as const;

export function metricForType(cType: number): `0x${string}` {
  return keccak256(toBytes(METRIC_FOR_TYPE[cType] ?? "VOLUME"));
}

/// Listing fee in bps of the prize pool (0 = free hosting).
export async function fetchListingFeeBps(): Promise<number> {
  try {
    return Number(
      await publicClient.readContract({
        address: CONTRACTS.ContestEngine,
        abi: contestEngineAbi,
        functionName: "listingFeeBps",
      }),
    );
  } catch {
    return 0;
  }
}

/// The USDC listing fee for a given pool, derived from the bps rate.
export async function listingFeeForPool(pool6: bigint): Promise<bigint> {
  const bps = await fetchListingFeeBps();
  return (pool6 * BigInt(bps)) / 10_000n;
}

/// The id the next listed contest will get.
export async function nextContestId(): Promise<number> {
  const n = await publicClient.readContract({
    address: CONTRACTS.ContestEngine,
    abi: contestEngineAbi,
    functionName: "nextContestId",
  });
  return Number(n);
}

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

export interface Contest {
  id: number;
  contestType: number;
  status: number;
  winnerCutBps: number;
  topN: number;
  platformFeeBps: number;
  sponsor: `0x${string}`;
  protocolTarget: `0x${string}`;
  metric: `0x${string}`;
  startTime: bigint;
  endTime: bigint;
  prizePool: bigint;
  finalRoot: `0x${string}`;
  entrants: number;
}

export const CONTEST_TYPE = ["Scout", "Analyst", "Solver"] as const;
export const CONTEST_STATUS = ["Pending", "Open", "Scoring", "Settled", "Cancelled"] as const;

const ZERO = "0x0000000000000000000000000000000000000000";

// On-chain metric names map to readable labels. "brier" is the Brier score
// (forecast accuracy) and reads as jargon, so it shows as "accuracy".
const METRIC_DISPLAY: Record<string, string> = {
  VOLUME: "VOLUME",
  PNL: "PNL",
  BRIER: "ACCURACY",
  PUZZLE: "PUZZLE",
  ACTIVITY: "ACTIVITY",
};
const METRIC_LABELS: Record<string, string> = {};
for (const m of ["VOLUME", "PNL", "BRIER", "PUZZLE", "ACTIVITY"]) {
  METRIC_LABELS[keccak256(toBytes(m))] = METRIC_DISPLAY[m] ?? m;
}

export function metricLabel(hash: string): string {
  return METRIC_LABELS[hash.toLowerCase()] ?? `${hash.slice(0, 10)}…`;
}

export function formatUsdc(amount6: bigint): string {
  return `${(Number(amount6) / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`;
}

export function statusClass(status: number): string {
  if (status === 1) return "pill-open";
  if (status === 3) return "pill-settled";
  if (status === 4) return "pill-cancelled";
  return "";
}

async function fetchContestOnce(id: number): Promise<Contest | null> {
  const [c, entrants] = await Promise.all([
    publicClient.readContract({
      address: CONTRACTS.ContestEngine,
      abi: contestEngineAbi,
      functionName: "getContest",
      args: [BigInt(id)],
    }),
    publicClient.readContract({
      address: CONTRACTS.ContestEngine,
      abi: contestEngineAbi,
      functionName: "entryCount",
      args: [BigInt(id)],
    }),
  ]);
  if (c.sponsor === ZERO) return null;
  return { id, ...c, entrants: Number(entrants) };
}

/// Read one contest with one retry on transient RPC failure. A silent
/// catch-to-null here made throttled reads drop cards from the grid with
/// no signal; only a genuine "sponsor is zero" returns null now.
export async function fetchContest(id: number): Promise<Contest | null> {
  try {
    return await fetchContestOnce(id);
  } catch (e1) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      return await fetchContestOnce(id);
    } catch (e2) {
      // eslint-disable-next-line no-console
      console.warn(`fetchContest(${id}) failed after retry`, e2 ?? e1);
      return null;
    }
  }
}

export async function fetchContests(): Promise<Contest[]> {
  const next = await publicClient.readContract({
    address: CONTRACTS.ContestEngine,
    abi: contestEngineAbi,
    functionName: "nextContestId",
  });
  const count = Number(next) - 1;
  if (count <= 0) return [];
  const ids = Array.from({ length: count }, (_, i) => i + 1);
  const contests = await Promise.all(ids.map((id) => fetchContest(id)));
  return contests.filter((c): c is Contest => c !== null).reverse();
}

/// Has this agent already entered the contest? Reads ContestEngine directly.
export async function hasEntered(contestId: number, agentId: number): Promise<boolean> {
  try {
    return (await publicClient.readContract({
      address: CONTRACTS.ContestEngine,
      abi: contestEngineAbi,
      functionName: "agentEntered",
      args: [BigInt(contestId), BigInt(agentId)],
    })) as boolean;
  } catch {
    return false;
  }
}

/// Has this operator already claimed their prize for the contest?
export async function hasClaimed(contestId: number, operator: `0x${string}`): Promise<boolean> {
  try {
    return (await publicClient.readContract({
      address: CONTRACTS.ContestEngine,
      abi: contestEngineAbi,
      functionName: "prizeClaimed",
      args: [BigInt(contestId), operator],
    })) as boolean;
  } catch {
    return false;
  }
}

/// The operator's payout for a settled contest: the amount and the merkle proof
/// to pass to claimPrize. Null if they did not win. Served by the coordinator.
export async function fetchPayout(
  contestId: number,
  operator: string,
): Promise<{ amount: bigint; proof: `0x${string}`[] } | null> {
  try {
    const res = await fetch(`${AUTH_URL}/contests/${contestId}/payout?operator=${operator}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { amount: string | null; proof?: `0x${string}`[] };
    if (!data || data.amount == null) return null;
    return { amount: BigInt(data.amount), proof: data.proof ?? [] };
  } catch {
    return null;
  }
}
