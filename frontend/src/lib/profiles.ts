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
  /// The operator's first non-delisted agent id, or null if they have
  /// none. Used to render the agent's skin or fall back to a Robot
  /// variant on the leaderboard row.
  primaryAgentId?: number | null;
  /// Data URL of the agent's uploaded skin, or null if they haven't
  /// uploaded one. The Robot mascot is the fallback.
  primarySkin?: string | null;
  /// The operator's resolved display name for the row: @handle, discord
  /// username, or a custom nickname, per their identity mode. Null when none
  /// is set, in which case the row shows the masked wallet.
  primaryName?: string | null;
  /// Raw identity handles, independent of which one is pinned as primary, so
  /// the leaderboard search can match any of them. Null when not linked.
  xHandle?: string | null;
  discordUsername?: string | null;
  customName?: string | null;
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
  telegramId: string | null;
  telegramUsername: string | null;
  telegramAvatar: string | null;
  discordId: string | null;
  discordUsername: string | null;
  discordAvatar: string | null;
  /// Operator-level identity shown on the leaderboard row and profile header.
  /// 'auto' (X, then Discord, then wallet) by default; pinnable to 'x',
  /// 'discord', 'custom', or 'wallet'.
  identityMode: "auto" | "x" | "discord" | "custom" | "wallet";
  syndicateId: string | null;
  cycles: number;
  reputation: string; // raw, scaled 1e6, as a string
  /// Totals (contests + challenges, matching the leaderboard) plus the
  /// per-source breakdown so the dashboard can show how the total splits.
  stats: {
    entered: number;
    wins: number;
    earned: string;
    contests?: { entered: number; wins: number; earned: string };
    challenges?: { entered: number; wins: number; earned: string };
  };
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

/// One resolved invite recipient. `address` is null when no ArcRun operator
/// matches the handle (they have not signed in yet), so the UI can list who
/// could not be invited. `via` records how it matched.
export interface ResolvedRecipient {
  input: string;
  address: string | null;
  via: "wallet" | "x" | "discord" | null;
}

/// Resolve a mixed list of wallet addresses, @X handles, and Discord usernames
/// to operator wallet addresses for the private-challenge invite flow. Order
/// is preserved 1:1 with the input. Network failure degrades to "all
/// unresolved" so the caller surfaces a clear error instead of inviting wrong
/// addresses.
export async function resolveRecipients(recipients: string[]): Promise<ResolvedRecipient[]> {
  try {
    const res = await fetch(`${AUTH_URL}/operators/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipients }),
    });
    if (!res.ok) return recipients.map((r) => ({ input: r, address: null, via: null }));
    const data = (await res.json()) as { resolved?: ResolvedRecipient[] };
    return data.resolved ?? recipients.map((r) => ({ input: r, address: null, via: null }));
  } catch {
    return recipients.map((r) => ({ input: r, address: null, via: null }));
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
    if (!res.ok) {
      if (res.status === 401) return { ok: false, error: "sign in first. open the login modal" };
      return { ok: false, error: data.error ?? "could not save the name" };
    }
    return { ok: true, nickname: data.nickname ?? null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

/// Save a custom skin (base64 data URL) for an agent. The client should
/// downscale to <=256x256 PNG before calling so the payload stays well under
/// the server's 256KB encoded cap. Empty / null clears the skin.
export async function saveAgentSkin(
  agentId: number,
  dataUrl: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${AUTH_URL}/agents/${agentId}/skin`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: dataUrl }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      if (res.status === 401) return { ok: false, error: "sign in first. open the login modal" };
      return { ok: false, error: data.error ?? "could not save the skin" };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

/// Switch an agent's display identity: 'default' (robot), 'x' (X handle +
/// avatar), or 'custom' (uploaded skin + nickname). Requires a SIWE session.
export async function saveAgentDisplayMode(
  agentId: number,
  mode: "default" | "x" | "discord" | "custom",
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${AUTH_URL}/agents/${agentId}/display-mode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ mode }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 401) return { ok: false, error: "sign in first. open the login modal" };
      return { ok: false, error: data.error ?? "could not switch the display" };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

/// Set the operator-level identity shown on the leaderboard and profile
/// header. 'auto' resolves X then Discord then the masked wallet. Requires a
/// SIWE session; writes to the caller's own operator row.
export async function saveIdentityMode(
  mode: "auto" | "x" | "discord" | "custom" | "wallet",
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${AUTH_URL}/operators/identity-mode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ mode }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 401) return { ok: false, error: "sign in first. open the login modal" };
      return { ok: false, error: data.error ?? "could not save the identity" };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

export async function clearAgentSkin(agentId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${AUTH_URL}/agents/${agentId}/skin`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 401) return { ok: false, error: "sign in first. open the login modal" };
      return { ok: false, error: data.error ?? "could not clear the skin" };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

/// Resolved display identity for an agent: which name + avatar to show, based
/// on its display_mode and the owner's X / skin data. `avatar` is an image URL
/// (X) or data URL (custom), or null to render the robot mascot. `name` is null
/// to use the caller's default (`agent #id`).
export interface AgentIdentity {
  kind: "default" | "x" | "discord" | "custom";
  name: string | null;
  avatar: string | null;
}

// Short-lived in-flight dedupe so the names and skins hooks asking for the same
// id set in the same tick share a single /agents/identities request. Cleared
// shortly after so a mode switch is picked up on the next mount.
const identityInflight = new Map<string, Promise<Record<string, AgentIdentity>>>();

export async function fetchAgentIdentities(ids: number[]): Promise<Map<number, AgentIdentity>> {
  const out = new Map<number, AgentIdentity>();
  if (ids.length === 0) return out;
  const qs = ids.join(",");
  let p = identityInflight.get(qs);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(`${AUTH_URL}/agents/identities?ids=${qs}`, { cache: "no-store" });
        if (!res.ok) return {};
        const data = (await res.json()) as { identities?: Record<string, AgentIdentity> };
        return data.identities ?? {};
      } catch {
        return {};
      }
    })();
    identityInflight.set(qs, p);
    void p.finally(() => setTimeout(() => identityInflight.delete(qs), 1500));
  }
  for (const [k, v] of Object.entries(await p)) out.set(Number(k), v);
  return out;
}

/// Bulk-fetch agent avatars. Derived from the identity resolver, so this now
/// returns the X avatar or custom skin per the agent's display mode (absent =
/// render the robot). Render sites do `skin ? <img> : <Robot>` unchanged.
export async function fetchAgentSkins(ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const identities = await fetchAgentIdentities(ids);
  for (const [id, ident] of identities) {
    if (ident.avatar) out.set(id, ident.avatar);
  }
  return out;
}

/// Admin-delisted agent ids. The frontend filters fetchAgents through this
/// set before returning. Failures fall through to an empty set so a backend
/// blip never causes the operator's agent list to inflate. Cached for the
/// current page life via the module-level promise.
let delistedPromise: Promise<Set<number>> | null = null;
export function fetchDelistedAgents(): Promise<Set<number>> {
  if (!delistedPromise) {
    delistedPromise = (async () => {
      try {
        const res = await fetch(`${AUTH_URL}/agents/delisted`, { cache: "no-store" });
        if (!res.ok) return new Set<number>();
        const data = (await res.json()) as { ids?: number[] };
        return new Set(data.ids ?? []);
      } catch {
        return new Set<number>();
      }
    })();
  }
  return delistedPromise;
}

/// Reset the cached delist set. Called by the workshop after a successful
/// admin write so the next fetchAgents picks up the change. No-op in
/// production paths where the admin endpoint is not exercised.
export function invalidateDelistedAgents() {
  delistedPromise = null;
}

/// Bulk-fetch nicknames for a list of agent ids. Missing entries are simply
/// absent from the returned map. No auth required: names are public, anyone
/// watching a contest sees them.
export async function fetchAgentNames(ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const identities = await fetchAgentIdentities(ids);
  for (const [id, ident] of identities) {
    if (ident.name) out.set(id, ident.name);
  }
  return out;
}

// ---- Raw (unresolved) lookups for the owner's management card. These return
// the actual uploaded skin / custom nickname / chosen mode so editing shows
// real values, not the resolved display identity. ----

export async function fetchAgentSkinsRaw(ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (ids.length === 0) return out;
  try {
    const res = await fetch(`${AUTH_URL}/agents/skins?ids=${ids.join(",")}`, { cache: "no-store" });
    if (!res.ok) return out;
    const data = (await res.json()) as { skins?: Record<string, string> };
    for (const [k, v] of Object.entries(data.skins ?? {})) if (v) out.set(Number(k), v);
  } catch { /* blip */ }
  return out;
}

export async function fetchAgentNamesRaw(ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (ids.length === 0) return out;
  try {
    const res = await fetch(`${AUTH_URL}/agents/names?ids=${ids.join(",")}`, { cache: "no-store" });
    if (!res.ok) return out;
    const data = (await res.json()) as { names?: Record<string, string> };
    for (const [k, v] of Object.entries(data.names ?? {})) if (v) out.set(Number(k), v);
  } catch { /* blip */ }
  return out;
}

export async function fetchAgentModes(ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (ids.length === 0) return out;
  try {
    const res = await fetch(`${AUTH_URL}/agents/modes?ids=${ids.join(",")}`, { cache: "no-store" });
    if (!res.ok) return out;
    const data = (await res.json()) as { modes?: Record<string, string> };
    for (const [k, v] of Object.entries(data.modes ?? {})) if (v) out.set(Number(k), v);
  } catch { /* blip */ }
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
  // Theme changes apply to the document immediately so the page flips live.
  if (key === "theme") applyTheme(value);
}

/// Apply or remove the `html.dark` class. Called on every theme change and on
/// page load so the active theme matches localStorage without a flash.
export function applyTheme(value: string | null): void {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  if (value === "dark") html.classList.add("dark");
  else html.classList.remove("dark");
}
