import { keccak256, parseAbi, toBytes } from "viem";
import { CONTRACTS, publicClient } from "./arc";

/// Reads contest state straight from ContestEngine on Arc. No backend needed:
/// the page talks to the chain directly.

export const contestEngineAbi = parseAbi([
  "function nextContestId() view returns (uint256)",
  "function getContest(uint256 contestId) view returns ((uint8 contestType, uint8 status, uint16 winnerCutBps, uint16 topN, uint16 platformFeeBps, address sponsor, address protocolTarget, bytes32 metric, uint64 startTime, uint64 endTime, uint256 prizePool, bytes32 finalRoot))",
  "function entryCount(uint256 contestId) view returns (uint64)",
]);

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

const METRIC_LABELS: Record<string, string> = {};
for (const m of ["VOLUME", "PNL", "BRIER", "PUZZLE", "ACTIVITY"]) {
  METRIC_LABELS[keccak256(toBytes(m))] = m;
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

export async function fetchContest(id: number): Promise<Contest | null> {
  try {
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
  } catch {
    return null;
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
