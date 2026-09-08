import { createHash } from "node:crypto";
import { isAddress } from "viem";
import { parseAgentId, isCategory, type BnbChain, type AgentSummary, type AgentDetail, type CatalogPage, type EndpointProof } from "../types.ts";
import { deriveMarketCapabilities, inferOutcomeMatches, normalizeMarketProtocol, protocolsFromValues, providerOutcomeMatch } from "../marketplace/capabilities.ts";
import { BNB_REGISTRIES, checkedClient, IDENTITY_ABI, networkConfig } from "./network.ts";
import { HttpError, object, publicJson, text, httpsUrl } from "./http.ts";
import { database } from "./store.ts";

// @bnbagent/sdk 0.5.5 ERC8004Agent.getAllAgents, dist/chunk-TKWQT3DN.js.
// Real response inspected 2026-09-04: {items, total, limit, offset}; www host
// returned a 308 to 8004scan.io. Index scores never become AGON verification.
const SCAN = "https://api.8004scan.io/api/v1";
export function parseIndexedAgent(value: unknown, chainId: BnbChain): AgentSummary {
  const row = object(value);
  const id = parseAgentId(row.token_id);
  if (row.chain_id !== chainId || text(row.contract_address).toLowerCase() !== BNB_REGISTRIES[chainId].toLowerCase() || !isAddress(text(row.owner_address))) {
    throw new HttpError(502, "The catalog returned an agent from a different registry or network.");
  }
  const advertised = [row.supported_protocols, row.protocols, row.services].flatMap((value) => Array.isArray(value) ? value : []);
  const name = text(row.name, 180) || `Agent ${id}`;
  const description = text(row.description);
  const category = isCategory(row.category) ? row.category : null;
  return { id, chainId, name, description,
    owner: text(row.owner_address), registry: BNB_REGISTRIES[chainId], category, categorySource: category ? "provider" : "unclassified",
    protocols: protocolsFromValues(advertised),
    outcomeMatches: category ? [providerOutcomeMatch(category)] : inferOutcomeMatches(name, description),
    indexedAt: typeof row.updated_at === "string" ? row.updated_at : null, source: "8004scan" };
}

const cache = new Map<string, { expires: number; value: Promise<unknown> }>();
function cached<T>(key: string, read: () => Promise<T>): Promise<T> {
  const current = cache.get(key); if (current && current.expires > Date.now()) return current.value as Promise<T>;
  if (cache.size >= 128) cache.delete(cache.keys().next().value!);
  const value = read().catch((error: unknown) => { cache.delete(key); throw error; });
  cache.set(key, { expires: Date.now() + 60_000, value }); return value;
}

// Public index outages must not make registered services disappear. These are
// discovery seeds only: every entry is resolved again from the BNB Testnet
// registry and its current metadata before it is shown.
const BNB_TESTNET_DISCOVERY_SEEDS = ["2177", "2230", "2231", "2232", "2233", "2237", "2238"] as const;
async function directRegistryCatalog(chainId: BnbChain, offset: number, liveError: unknown): Promise<CatalogPage> {
  if (chainId !== 97 || offset !== 0) throw liveError;
  const settled = await Promise.allSettled(BNB_TESTNET_DISCOVERY_SEEDS.map((id) => agentDetail(chainId, id, true)));
  const items = settled.flatMap((entry) => entry.status === "fulfilled" && entry.value.metadataStatus === "available"
    && entry.value.active !== false && entry.value.services.length ? [entry.value] : []);
  if (!items.length) throw liveError;
  return {
    items, total: items.length, nextOffset: null, checkedAt: new Date().toISOString(), source: "direct_registry",
    warnings: ["The public agent index is temporarily unavailable. Showing registered services resolved directly from BNB Testnet."],
  };
}

export async function catalog(chainId: BnbChain, offset = 0): Promise<CatalogPage> {
  const page = await cached<CatalogPage>(`catalog:${chainId}:${offset}`, async () => {
    try {
      const data = object(await publicJson(`${SCAN}/agents?chain_id=${chainId}&limit=20&offset=${offset}`));
      if (!Array.isArray(data.items) || data.items.length > 20 || !Number.isSafeInteger(data.total) || Number(data.total) < 0) {
        throw new HttpError(502, "The agent index returned an invalid catalog.");
      }
      const items: AgentSummary[] = []; const warnings: string[] = [];
      for (const row of data.items) { try { items.push(parseIndexedAgent(row, chainId)); } catch { warnings.push("An invalid or cross-network index record was excluded."); } }
      const livePage: CatalogPage = { items, total: Number(data.total), nextOffset: offset + data.items.length < Number(data.total) ? offset + data.items.length : null,
        checkedAt: new Date().toISOString(), source: "8004scan", warnings };
      if (process.env.BNB_DATABASE_URL) {
        try {
          await (await database()).query(`INSERT INTO bnb_catalog_snapshots(chain_id,page_offset,page_json,checked_at)
            VALUES($1,$2,$3,now()) ON CONFLICT(chain_id,page_offset) DO UPDATE SET page_json=EXCLUDED.page_json,checked_at=now()`,
          [chainId, offset, JSON.stringify(livePage)]);
        } catch { warnings.push("The live catalog loaded, but its recovery snapshot could not be refreshed."); }
      }
      return livePage;
    } catch (liveError) {
      if (!process.env.BNB_DATABASE_URL) return directRegistryCatalog(chainId, offset, liveError);
      try {
        const saved = await (await database()).query<{ page_json: string; checked_at: Date }>(`SELECT page_json,checked_at
          FROM bnb_catalog_snapshots WHERE chain_id=$1 AND page_offset=$2 AND checked_at>now()-interval '72 hours'`, [chainId, offset]);
        if (!saved.rows[0]) throw liveError;
        const snapshot = JSON.parse(saved.rows[0].page_json) as CatalogPage;
        if (!Array.isArray(snapshot.items) || snapshot.source !== "8004scan") throw liveError;
        return { ...snapshot, warnings: [...snapshot.warnings,
          `The live agent index is unavailable. Showing the last successful catalog snapshot from ${saved.rows[0].checked_at.toISOString()}.`] };
      } catch { return directRegistryCatalog(chainId, offset, liveError); }
    }
  });
  if (!process.env.BNB_DATABASE_URL) return page;
  const warnings = [...page.warnings]; const items = [...page.items];
  try {
    // Provider listings are qualified against the current owner/version, not
    // merely replayed from an index. No ownership means no curated listing.
    const rows = await (await database()).query<{agent_id: string; owner_address: string; category: string; version_hash: string}>(
      "SELECT agent_id,owner_address,category,version_hash FROM bnb_market_listings WHERE chain_id=$1 ORDER BY published_at DESC LIMIT 20", [chainId]);
    for (const row of rows.rows) {
      const existing = items.findIndex((a) => a.id === row.agent_id);
      if (offset !== 0 && existing < 0) continue;
      try {
        const detail = await agentDetail(chainId, row.agent_id);
        if (!isCategory(row.category) || detail.owner.toLowerCase() !== row.owner_address || detail.versionHash !== row.version_hash || detail.registrationMatches === false || detail.active === false) continue;
        const listed: AgentSummary = { ...detail, category: row.category, categorySource: "provider", source: "agon" };
        if (existing >= 0) items[existing] = listed; else items.unshift(listed);
      } catch { warnings.push("A provider listing could not be rechecked and was not promoted."); }
    }
  } catch { warnings.push("Provider listings could not be loaded. Registry discovery is still available."); }
  return { ...page, items, warnings };
}

export async function registration(uri: string): Promise<Record<string, unknown>> {
  if (uri.startsWith("data:application/json;base64,")) {
    const encoded = uri.slice("data:application/json;base64,".length);
    if (encoded.length > 699052 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new HttpError(502, "Registration data is too large or malformed.");
    return object(JSON.parse(Buffer.from(encoded, "base64").toString("utf8")));
  }
  if (uri.startsWith("ipfs://")) {
    const path = uri.slice(7); if (!/^[a-zA-Z0-9]+(?:\/[a-zA-Z0-9._-]+)*$/.test(path)) throw new HttpError(502, "Unsupported IPFS registration path.");
    return object(await publicJson(`https://ipfs.io/ipfs/${path}`));
  }
  return object(await publicJson(uri));
}

export async function agentDetail(chainId: BnbChain, id: string, fresh = false): Promise<AgentDetail> {
  parseAgentId(id);
  const read = async (): Promise<AgentDetail> => {
    const client = await checkedClient(chainId);
    const block = await client.getBlockNumber();
    const address = BNB_REGISTRIES[chainId];
    const [owner, wallet, uri] = await Promise.all([
      client.readContract({ address, abi: IDENTITY_ABI, functionName: "ownerOf", args: [BigInt(id)], blockNumber: block }),
      client.readContract({ address, abi: IDENTITY_ABI, functionName: "getAgentWallet", args: [BigInt(id)], blockNumber: block }),
      client.readContract({ address, abi: IDENTITY_ABI, functionName: "tokenURI", args: [BigInt(id)], blockNumber: block }),
    ]);
    let metadata: Record<string, unknown> | null = null;
    try { metadata = await registration(uri); } catch { /* Identity remains readable even when the provider metadata is offline. */ }
    const services: AgentDetail["services"] = [];
    if (Array.isArray(metadata?.services)) for (const item of metadata.services.slice(0, 12)) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const row = item as Record<string, unknown>;
      try { const endpoint = httpsUrl(text(row.endpoint)).href; services.push({ name: text(row.name, 40), endpoint, version: text(row.version, 40) || null }); } catch { /* Unsafe advertised endpoints are never probed. */ }
    }
    let registrationMatches: boolean | null = null;
    if (Array.isArray(metadata?.registrations) && metadata.registrations.length) {
      registrationMatches = metadata.registrations.some((entry: unknown) => {
        if (!entry || typeof entry !== "object") return false;
        const row = entry as Record<string, unknown>;
        return String(row.agentId) === id && text(row.agentRegistry).toLowerCase() === `eip155:${chainId}:${address}`.toLowerCase();
      });
    }
    const extension = metadata?.agon && typeof metadata.agon === "object" ? metadata.agon as Record<string, unknown> : null;
    const category = isCategory(extension?.category) ? extension.category : null;
    const outcomeMatches = category ? [providerOutcomeMatch(category)] : inferOutcomeMatches(text(metadata?.name), text(metadata?.description));
    const capabilities = deriveMarketCapabilities(services);
    return { id, chainId, name: text(metadata?.name, 180) || `Agent ${id}`, description: text(metadata?.description),
      owner, wallet, registry: address, category, categorySource: category ? "provider" : "unclassified", outcomeMatches, indexedAt: null, source: "agon",
      protocols: capabilities.map((capability) => capability.protocol),
      blockNumber: block.toString(), checkedAt: new Date().toISOString(), ownerMatchesIndex: null,
      uri, versionHash: metadata ? `sha256:${createHash("sha256").update(JSON.stringify(metadata)).digest("hex")}` : null,
      metadataStatus: metadata ? "available" : "unavailable", active: typeof metadata?.active === "boolean" ? metadata.active : null,
      services, capabilities, registrationMatches };
  };
  return fresh ? read() : cached(`identity:${chainId}:${id}`, read);
}

export async function probeAgent(chainId: BnbChain, id: string): Promise<EndpointProof> {
  return cached(`probe:${chainId}:${id}`, async () => {
    const agent = await agentDetail(chainId, id);
    if (!agent.versionHash || agent.registrationMatches === false) throw new HttpError(409, "Agent registration must be readable and match this network before testing.");
    const service = agent.services.find((s) => normalizeMarketProtocol(s.name) === "A2A") ??
      agent.services.find((s) => normalizeMarketProtocol(s.name) === "ERC8183" && new URL(s.endpoint).pathname.endsWith("/status"));
    if (!service) throw new HttpError(409, "This agent does not advertise a supported read-only discovery endpoint.");
    const base = { chainId, agentId: id, versionHash: agent.versionHash, checkedAt: new Date().toISOString(), protocol: service.name,
      endpoint: service.endpoint, checkLevel: "discovery" as const };
    try {
      const card = object(await publicJson(service.endpoint));
      if (normalizeMarketProtocol(service.name) === "A2A") {
        if (!text(card.name) || !Array.isArray(card.skills)) throw new Error("Invalid A2A card");
        const skillText = card.skills.slice(0, 30).map((skill) => {
          if (!skill || typeof skill !== "object" || Array.isArray(skill)) return "";
          const row = skill as Record<string, unknown>;
          return [row.id, row.name, row.description, ...(Array.isArray(row.tags) ? row.tags : [])]
            .map((value) => text(value)).join(" ");
        }).join(" ");
        const advertised = inferOutcomeMatches(text(card.name), `${text(card.description)} ${skillText}`)
          .map((match) => match.category);
        const supportedCategories = [...new Set(advertised.filter((category) =>
          agent.outcomeMatches.some((match) => match.category === category)))];
        return { ...base, status: "reachable", supportedCategories,
          message: "The service returned current discovery details for this category. No task ran and no payment was sent." };
      }
      // Exact response inspected from registered BNB agent 2114 on 2026-09-04.
      // A status payload is provider evidence only, never authorization to pay.
      const config = networkConfig(chainId).contracts;
      if (card.status !== "ok" || ![agent.wallet, agent.owner].some((a) => a.toLowerCase() === text(card.agent_address).toLowerCase())) throw new Error("Status identity mismatch");
      const matches = text(card.commerce_address).toLowerCase() === config.commerceProxy.toLowerCase() && text(card.router_address).toLowerCase() === config.routerProxy.toLowerCase() && text(card.policy_address).toLowerCase() === config.policy.toLowerCase();
      const supportedCategories = matches ? agent.outcomeMatches.map((match) => match.category) : [];
      return { ...base, status: "reachable", supportedCategories,
        message: matches ? "The payment service returned current details that match this agent and network. No task ran and no payment was sent." : "The provider is reachable, but its payment setup differs from the supported network. Hiring remains unavailable. No task ran and no payment was sent." };
    } catch { return { ...base, status: "unavailable", supportedCategories: [], message: "The agent did not return a valid discovery response for this identity. Try again later or choose another agent." }; }
  });
}
