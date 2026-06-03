import { parseAbi } from "viem";
import { publicClient, CONTRACTS } from "./arc";
import { fetchAgentNames, fetchAgentSkins, fetchDelistedAgents } from "./profiles";

/// Reads agent state from AgentRegistry on Arc, plus the bits needed to upgrade.

export const agentRegistryAbi = parseAbi([
  "function agentsOf(address owner) view returns (uint256[])",
  "function getAgent(uint256 agentId) view returns ((address owner, uint16 scoutTier, uint16 analystTier, uint16 solverTier, uint128 reputation, uint64 lastActivityAt, uint64 createdAt, uint256 erc8004TokenId))",
  "function upgradePrice(uint8 cType, uint16 fromTier) view returns (uint256)",
  "function upgradeAgent(uint256 agentId, uint8 cType, uint16 newTier)",
  "function createAgent(string metadataURI) returns (uint256)",
]);

export const erc20Abi = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
]);

export const CONTEST_TYPES = ["scout", "analyst", "solver"] as const;
export type ContestTypeName = (typeof CONTEST_TYPES)[number];
export const MAX_TIER = 4; // tiers 0..4, four sequential upgrade steps

/// Abilities at each tier, by contest type. Index = tier. Five entries per
/// type, matching AgentRegistry.MAX_TIER on chain. The strings show in the
/// workshop upgrade flow and in tier hover cards.
export const ABILITIES: Record<ContestTypeName, string[]> = {
  scout: [
    "5 swaps per contest, $10 max each, single dex",
    "20 swaps, $100 max each, two dexs",
    "100 swaps, $250 max each, basic liquidity provisioning",
    "500 swaps, $500 max each, cross-pool routing",
    "2000 swaps, $1000 max, all dexs, cctp bridge",
  ],
  analyst: [
    "base-rate predictions, no info edge",
    "market data feeds and sharper logic",
    "live order-book signals, multi-source feeds",
    "calibrated models, sentiment overlay",
    "near-perfect information edge, model ensemble",
  ],
  solver: [
    "basic puzzle attempts, low compute",
    "more puzzle types, higher compute budget",
    "the full puzzle suite, mid compute",
    "deep search, fast convergence",
    "instant solves, top of curve",
  ],
};

export interface AgentState {
  id: number;
  scoutTier: number;
  analystTier: number;
  solverTier: number;
  reputation: bigint;
  /// ERC-8004 IdentityRegistry token id. Every ArcRun agent IS this NFT.
  erc8004TokenId: bigint;
  /// Operator-set display name. Server-persisted via auth API; absent on agents
  /// that have never been named.
  nickname?: string | null;
  /// Operator-uploaded skin (base64 data URL). When present, render this image
  /// instead of the variant mascot. Server-persisted, owner-only write.
  skin?: string | null;
}

/// Fallback-aware display name for an agent. Always returns something to show.
export function agentDisplayName(a: { id: number; nickname?: string | null }): string {
  const name = (a.nickname ?? "").trim();
  return name || `agent #${a.id}`;
}

export function ctypeIndex(t: ContestTypeName): number {
  return t === "scout" ? 0 : t === "analyst" ? 1 : 2;
}

export function tierOf(a: AgentState, t: ContestTypeName): number {
  return t === "scout" ? a.scoutTier : t === "analyst" ? a.analystTier : a.solverTier;
}

export function usdc(amount6: bigint): string {
  return `${(Number(amount6) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`;
}

/// Session-scoped cache for fetchAgents. Live for 15s per owner address.
/// Halves the perceived load on contest/challenge navigation because the
/// EnterPanel/JoinChallengePanel both hit fetchAgents on mount; with the
/// cache, the second one is instant.
const AGENTS_TTL_MS = 15_000;
const agentsCache = new Map<string, { at: number; value: AgentState[] }>();

function cachedAgents(owner: string): AgentState[] | null {
  const hit = agentsCache.get(owner.toLowerCase());
  if (!hit) return null;
  if (Date.now() - hit.at > AGENTS_TTL_MS) {
    agentsCache.delete(owner.toLowerCase());
    return null;
  }
  return hit.value;
}

function setAgentsCache(owner: string, value: AgentState[]) {
  agentsCache.set(owner.toLowerCase(), { at: Date.now(), value });
}

/// Public hook so claim / upgrade flows can wipe the cache and force a
/// fresh read without waiting for the TTL.
export function invalidateAgentsCache(owner?: `0x${string}`) {
  if (owner) agentsCache.delete(owner.toLowerCase());
  else agentsCache.clear();
}

/// All agents owned by this wallet, in creation order. Retries the chain reads
/// up to three times with exponential backoff so a transient RPC blip on the
/// first hit doesn't collapse to an empty list (which used to falsely flip the
/// UI into "claim your agent" for wallets that already had one).
export async function fetchAgents(owner: `0x${string}`): Promise<AgentState[]> {
  const cached = cachedAgents(owner);
  if (cached) return cached;

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const rawIds = (await publicClient.readContract({
        address: CONTRACTS.AgentRegistry,
        abi: agentRegistryAbi,
        functionName: "agentsOf",
        args: [owner],
      })) as readonly bigint[];
      if (rawIds.length === 0) {
        setAgentsCache(owner, []);
        return [];
      }

      // Filter out admin-delisted ids before doing any per-id chain reads.
      // The agent NFT still exists on Arc; ArcRun just doesn't render it.
      const delisted = await fetchDelistedAgents();
      const ids = rawIds.filter((id) => !delisted.has(Number(id)));
      if (ids.length === 0) {
        setAgentsCache(owner, []);
        return [];
      }

      // Parallel per-id chain reads. Was sequential; with 5 agents this
      // collapses ~5 round-trips into one wall-clock RPC tier. Names and
      // skins also fire in the same parallel batch.
      const [chainResults, names, skins] = await Promise.all([
        Promise.all(
          ids.map((id) =>
            publicClient.readContract({
              address: CONTRACTS.AgentRegistry,
              abi: agentRegistryAbi,
              functionName: "getAgent",
              args: [id],
            }),
          ),
        ),
        fetchAgentNames(ids.map((id) => Number(id))),
        fetchAgentSkins(ids.map((id) => Number(id))),
      ]);

      const agents: AgentState[] = ids.map((id, i) => {
        const a = chainResults[i]!;
        const out: AgentState = {
          id: Number(id),
          scoutTier: Number(a.scoutTier),
          analystTier: Number(a.analystTier),
          solverTier: Number(a.solverTier),
          reputation: a.reputation,
          erc8004TokenId: a.erc8004TokenId,
        };
        const n = names.get(out.id);
        const s = skins.get(out.id);
        if (n) out.nickname = n;
        if (s) out.skin = s;
        return out;
      });
      setAgentsCache(owner, agents);
      return agents;
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 400 * Math.pow(2, attempt)));
    }
  }
  throw lastError;
}

/// The operator's first agent, kept for callers that still want a single-agent
/// shape. Prefer `fetchAgents` and the active-agent helpers below.
export async function fetchFirstAgent(owner: `0x${string}`): Promise<AgentState | null> {
  const list = await fetchAgents(owner);
  return list[0] ?? null;
}

/// Active-agent selection lives in localStorage, keyed by lowercased owner. The
/// chain allows multiple agents per wallet, so the UI lets the operator pick
/// which one enters or joins. The choice is read by EnterPanel and
/// JoinChallengePanel via `resolveActiveAgent`.
const ACTIVE_KEY = (owner: string) => `arcrun:activeAgent:${owner.toLowerCase()}`;

export function getActiveAgentId(owner: string): number | null {
  if (typeof window === "undefined" || !owner) return null;
  const v = window.localStorage.getItem(ACTIVE_KEY(owner));
  return v ? Number(v) : null;
}

export function setActiveAgentId(owner: string, id: number): void {
  if (typeof window === "undefined" || !owner) return;
  window.localStorage.setItem(ACTIVE_KEY(owner), String(id));
}

/// Resolve which of an owner's agents is active. Falls back to the first agent
/// if there is no stored choice or the stored id is no longer in the list.
export function resolveActiveAgent(agents: AgentState[], owner: string): AgentState | null {
  if (agents.length === 0) return null;
  const stored = getActiveAgentId(owner);
  if (stored != null) {
    const hit = agents.find((a) => a.id === stored);
    if (hit) return hit;
  }
  return agents[0]!;
}

export async function fetchPrice(t: ContestTypeName, fromTier: number): Promise<bigint> {
  return (await publicClient.readContract({
    address: CONTRACTS.AgentRegistry,
    abi: agentRegistryAbi,
    functionName: "upgradePrice",
    args: [ctypeIndex(t), fromTier],
  })) as bigint;
}
