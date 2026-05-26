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

// --- Agent names: server-persisted ---
//
// Names live on `agents.nickname` so a rename in one place propagates to every
// surface that reads agents. The auth API requires SIWE and verifies ownership
// against the agents table before writing. Telegram/Discord social handles and
// local settings (theme, lang, muted) still live in localStorage below.

/// POST a new nickname for an agent. Returns the trimmed name the server stored
/// or an `error` string the caller can render inline. Empty/whitespace clears
/// the name. Requires an active SIWE session cookie.
export async function saveAgentName(
  agentId: number,
  name: string,
): Promise<{ ok: true; nickname: string | null } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${AUTH_URL}/agents/${agentId}/name`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = (await res.json().catch(() => ({}))) as { nickname?: string | null; error?: string };
    if (!res.ok) return { ok: false, error: data.error ?? "could not save the name" };
    return { ok: true, nickname: data.nickname ?? null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

/// Bulk-fetch nicknames for a list of agent ids. Missing entries are simply
/// absent from the returned map. No auth required: names are public, anyone
/// watching a contest sees them.
export async function fetchAgentNames(ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (ids.length === 0) return out;
  try {
    const qs = ids.join(",");
    const res = await fetch(`${AUTH_URL}/agents/names?ids=${qs}`, { cache: "no-store" });
    if (!res.ok) return out;
    const data = (await res.json()) as { names?: Record<string, string> };
    for (const [k, v] of Object.entries(data.names ?? {})) {
      if (v) out.set(Number(k), v);
    }
  } catch {
    // network blip, return what we have
  }
  return out;
}

// --- Local user preferences (browser-scoped) ---
//
// Social handles and personal settings stay in localStorage; they don't need
// to be visible to other users the way agent names do.

const SOCIAL_KEY = (kind: string) => `arcrun:social:${kind}`;
const SETTING_KEY = (k: string) => `arcrun:setting:${k}`;

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
