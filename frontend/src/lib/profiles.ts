/// Reads the leaderboard and operator profiles from the auth service read API
/// (backed by the indexer tables). These run in the browser, where AUTH_URL is
/// reachable; the chain-only contest reads stay in contests.ts.

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

export interface LeaderRow {
  operator: string;
  entered: number;
  wins: number;
  earned: string; // USDC, 6 decimals, as a string
  cycles: number; // PointsLedger balance (whole Cycles)
  reputation: string; // raw, scaled 1e6, as a string
}

export interface OperatorAgent {
  id: number;
  scoutTier: number;
  analystTier: number;
  solverTier: number;
  reputation: string;
}

export interface OperatorContest {
  contestId: number;
  contestType: number | null;
  status: string | null;
  won: string | null; // payout amount if they placed, else null
  claimed: boolean;
}

export interface OperatorProfile {
  operator: string;
  xHandle: string | null;
  syndicateId: string | null;
  cycles: number;
  reputation: string; // raw, scaled 1e6, as a string
  stats: { entered: number; wins: number; earned: string };
  agents: OperatorAgent[];
  contests: OperatorContest[];
}

export async function fetchLeaderboard(limit = 50): Promise<LeaderRow[]> {
  try {
    const res = await fetch(`${AUTH_URL}/leaderboard?limit=${limit}`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as { leaders?: LeaderRow[] };
    return data.leaders ?? [];
  } catch {
    return [];
  }
}

export async function fetchOperator(address: string): Promise<OperatorProfile | null> {
  try {
    const res = await fetch(`${AUTH_URL}/operators/${address}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as OperatorProfile;
  } catch {
    return null;
  }
}

/// Format a 6-decimal USDC string (e.g. "14000000") as "14.00 USDC".
export function formatUsdcString(amount6: string | null): string {
  const n = Number(amount6 ?? "0") / 1e6;
  return `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`;
}

/// Reputation is stored raw at 1e6 precision on-chain. Show it as whole points.
export function formatReputation(raw: string | null): number {
  return Math.round(Number(raw ?? "0") / 1e6);
}

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/// A deterministic, unique-per-address color for an operator's mascot avatar, so
/// every profile reads as its own. Hue derived from the address, vivid but soft.
export function operatorColor(address: string): string {
  const hex = address.replace(/^0x/, "").slice(0, 6) || "7c4dff";
  const hue = parseInt(hex, 16) % 360;
  return `hsl(${hue}, 70%, 62%)`;
}

/// Per-agent mascot color so two agents owned by the same operator are visually
/// distinct. The multiplier spreads ids across the wheel so neighboring ids
/// don't pick neighboring hues.
export function agentColorById(id: number): string {
  const hue = (id * 137) % 360;
  return `hsl(${hue}, 70%, 62%)`;
}

// --- Local user preferences (browser-scoped) ---
//
// Nicknames for agents and the operator's telegram/discord handles live in
// localStorage for now. They're shown to the owner on their own profile so the
// page reads as personal even before we wire a shared backend store. X is
// already persisted server-side via OAuth, so that stays on the wallet's row
// in the operators table.

const NICK_KEY = (agentId: number) => `arcrun:agentName:${agentId}`;
const SOCIAL_KEY = (kind: string) => `arcrun:social:${kind}`;
const SETTING_KEY = (k: string) => `arcrun:setting:${k}`;

export function getAgentNickname(agentId: number): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(NICK_KEY(agentId)) ?? "";
}
export function setAgentNickname(agentId: number, name: string): void {
  if (typeof window === "undefined") return;
  const trimmed = name.trim();
  if (trimmed) window.localStorage.setItem(NICK_KEY(agentId), trimmed);
  else window.localStorage.removeItem(NICK_KEY(agentId));
}

export type SocialKind = "telegram" | "discord";

export function getSocial(kind: SocialKind): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(SOCIAL_KEY(kind)) ?? "";
}
export function setSocial(kind: SocialKind, value: string): void {
  if (typeof window === "undefined") return;
  const trimmed = value.trim();
  if (trimmed) window.localStorage.setItem(SOCIAL_KEY(kind), trimmed);
  else window.localStorage.removeItem(SOCIAL_KEY(kind));
}

export type SettingKey = "theme" | "lang" | "muted";

export function getSetting(key: SettingKey, fallback: string = ""): string {
  if (typeof window === "undefined") return fallback;
  return window.localStorage.getItem(SETTING_KEY(key)) ?? fallback;
}
export function setSetting(key: SettingKey, value: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SETTING_KEY(key), value);
}
