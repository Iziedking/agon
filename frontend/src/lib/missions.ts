/// Client reads for the mission arena. Mission state lives in the backend DB
/// (not on chain), so this talks to the auth/API service. Contest meta still
/// comes from the chain via lib/contests.

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

export type Choice = "make" | "buy" | "skip";

export interface MissionFragment {
  id: string;
  kind: string;
  ask: string;
}

export interface MissionSpecialist {
  agentId: number;
  fragmentId: string;
  price6: string;
}

export interface MissionDecision {
  fragmentId: string;
  choice: Choice;
  reason: string;
  settled: boolean;
  txHash: string | null;
  spent6: string;
  specialistAgentId: number | null;
}

export interface MissionOperative {
  agentId: number;
  operator: string;
  score: number;
  quality: number | null;
  verdict: string;
  credited: number | null;
  total: number;
  deliverable: string;
  elapsedMs: number;
  decisions: MissionDecision[];
}

export interface TapeRow {
  kind: "a2a" | "x402";
  fromAgentId: number;
  toAgentId: number | null;
  toLabel: string;
  fragmentId: string | null;
  amount6: string;
  txHash: string | null;
  chain: string;
  ts: string;
}

export interface MissionMeta {
  contestId: number;
  domain: string;
  templateId: string;
  title: string;
  brief: string;
  deliverable: string;
  status: string;
}

export interface MissionState {
  mission: MissionMeta | null;
  fragments: MissionFragment[];
  specialists: MissionSpecialist[];
  operatives: MissionOperative[];
  tape: TapeRow[];
}

/// Fetches the full mission state. Returns null on a network error and a state
/// with `mission: null` when the contest is not a mission.
export async function fetchMission(contestId: number): Promise<MissionState | null> {
  try {
    const res = await fetch(`${AUTH_URL}/missions/${contestId}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as MissionState;
  } catch {
    return null;
  }
}

export function formatUsdc6(amount6: string): string {
  return `${(Number(amount6 || "0") / 1e6).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })} USDC`;
}

/// Explorer link for a settlement tx, by the chain it settled on.
export function explorerTx(chain: string, txHash: string): string {
  const c = (chain || "arc").toLowerCase();
  if (c === "base") return `https://basescan.org/tx/${txHash}`;
  if (c === "base-sepolia") return `https://sepolia.basescan.org/tx/${txHash}`;
  if (c === "matic" || c === "polygon") return `https://polygonscan.com/tx/${txHash}`;
  return `https://testnet.arcscan.app/tx/${txHash}`;
}

export function shortAddr(addr: string): string {
  return addr && addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}
