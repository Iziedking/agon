import { agentDetail, catalog, probeAgent } from "../src/shared/server/catalog.ts";
import { categoryCoverage, categoryCoverageGaps } from "../src/shared/marketplace/category-coverage.ts";
import type { AgentSummary, Category } from "../src/shared/types.ts";

type ProofRow = {
  category: Category;
  agentId: string | null;
  name: string | null;
  matchSource: "provider" | "description" | null;
  registration: "available" | "unavailable" | "not_checked";
  endpoint: "reachable" | "unavailable" | "not_checked";
  endpointMessage: string | null;
  attempts: Array<{
    agentId: string;
    name: string;
    registration: ProofRow["registration"];
    endpoint: ProofRow["endpoint"];
    message: string | null;
  }>;
};

function safeError(value: unknown): string {
  return value instanceof Error ? value.message.replace(/\S+:\/\/\S+/g, "<redacted>").split("\n")[0].slice(0, 240) : "Read failed.";
}

const API_ORIGIN = process.env.BNB_PROOF_API_ORIGIN ?? "https://api.agon.surf";
const MARKET_ORIGIN = process.env.BNB_PROOF_MARKET_ORIGIN ?? "https://agon.surf";

async function publicJson(origin: string, path: string): Promise<Record<string, unknown>> {
  const response = await fetch(new URL(path, origin).href, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} returned invalid JSON`);
  return value as Record<string, unknown>;
}

async function readAllAgents() {
  const pages: Awaited<ReturnType<typeof catalog>>[] = [];
  let offset = 0;
  for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
    const page = await catalog(97, offset);
    pages.push(page);
    if (page.nextOffset === null) break;
    offset = page.nextOffset;
  }
  return [...new Map(pages.flatMap((page) => page.items).map((agent) => [agent.id, agent])).values()];
}

function candidateAgents(agents: readonly AgentSummary[], category: Category): AgentSummary[] {
  return agents
    .filter((agent) => agent.outcomeMatches.some((match) => match.category === category))
    .sort((a, b) => {
      const aProvider = a.outcomeMatches.some((match) => match.category === category && match.source === "provider");
      const bProvider = b.outcomeMatches.some((match) => match.category === category && match.source === "provider");
      return Number(bProvider) - Number(aProvider);
    })
    .slice(0, 5);
}

const checkedAt = new Date().toISOString();
try {
  const agents = await readAllAgents();
  const coverage = categoryCoverage(agents);
  const gaps = categoryCoverageGaps(coverage);
  const rows: ProofRow[] = [];

  for (const entry of coverage) {
    const candidates = candidateAgents(agents, entry.id);
    const attempts: ProofRow["attempts"] = [];
    let selectedRow: ProofRow | null = null;
    for (const selected of candidates) {
      let registration: ProofRow["registration"] = "unavailable";
      try {
        const detail = await agentDetail(97, selected.id, true);
        registration = detail.metadataStatus === "available" && detail.registrationMatches !== false ? "available" : "unavailable";
      } catch { /* The attempt remains an honest failed proof. */ }
      let endpoint: ProofRow["endpoint"] = "not_checked";
      let endpointMessage: string | null = null;
      if (registration !== "available") {
        endpointMessage = "Registration was not available; endpoint was not probed.";
      } else {
        endpoint = "unavailable";
        try {
          const result = await probeAgent(97, selected.id);
          endpoint = result.status;
          endpointMessage = result.message;
        } catch (error) {
          endpointMessage = safeError(error);
        }
      }
      attempts.push({ agentId: selected.id, name: selected.name, registration, endpoint, message: endpointMessage });
      if (registration === "available" && endpoint === "reachable") {
        selectedRow = {
          category: entry.id,
          agentId: selected.id,
          name: selected.name,
          matchSource: selected.outcomeMatches.find((match) => match.category === entry.id)?.source ?? null,
          registration,
          endpoint,
          endpointMessage,
          attempts,
        };
        break;
      }
    }
    rows.push(selectedRow ?? {
      category: entry.id,
      agentId: candidates[0]?.id ?? null,
      name: candidates[0]?.name ?? null,
      matchSource: candidates[0]?.outcomeMatches.find((match) => match.category === entry.id)?.source ?? null,
      registration: attempts[0]?.registration ?? "not_checked",
      endpoint: attempts[0]?.endpoint ?? "not_checked",
      endpointMessage: attempts[0]?.message ?? "No catalog candidate matched this outcome.",
      attempts,
    });
  }

  let publicHealth: unknown = { status: "not_checked" };
  let publicHealthError: string | null = null;
  let publicStatus: unknown = { status: "not_checked" };
  let publicStatusError: string | null = null;
  try { publicHealth = await publicJson(API_ORIGIN, "/api/bnb/97/health"); } catch (error) { publicHealthError = safeError(error); }
  try { publicStatus = await publicJson(MARKET_ORIGIN, "/api/bnb/97/providers/lp-guardian/erc8183/status"); } catch (error) { publicStatusError = safeError(error); }

  const health = publicHealth as Record<string, unknown>;
  const worker = health.worker && typeof health.worker === "object" ? health.worker as Record<string, unknown> : null;
  const status = publicStatus as Record<string, unknown>;
  const blockers = Array.isArray(status.blockers) ? status.blockers : null;
  const runtimeReady = !publicHealthError && !publicStatusError
    && health.chainId === 97
    && health.rpc === "reachable"
    && health.storage === "reachable"
    && health.taskExecution === "available"
    && health.settlementWrites === "available"
    && worker?.healthy === true
    && status.status === "ok"
    && status.chain_id === 97
    && String(status.agent_id) === "2177"
    && status.paid_hiring === true
    && blockers?.length === 0;

  const endpointFailures = rows.filter((row) => row.endpoint !== "reachable");
  const registrationFailures = rows.filter((row) => row.registration !== "available");
  const proof = {
    checkedAt,
    chainId: 97,
    catalogSource: "8004scan",
    indexedProfiles: agents.length,
    coverage,
    gaps,
    requiredOutcomes: rows,
    lpGuardian: {
      agentId: "2177",
      publicHealth,
      publicHealthError,
      publicStatus,
      publicStatusError,
      runtimeReady,
      sources: { health: `${API_ORIGIN}/api/bnb/97/health`, status: `${MARKET_ORIGIN}/api/bnb/97/providers/lp-guardian/erc8183/status` },
    },
    status: gaps.length || endpointFailures.length || registrationFailures.length || !runtimeReady ? "incomplete_live_proof" : "live_marketplace_proof_passed",
    sendsTransactions: false,
    runsProviderTasks: false,
    walletsLoaded: false,
  };
  console.log(JSON.stringify(proof, null, 2));
  if (proof.status !== "live_marketplace_proof_passed") process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ checkedAt, chainId: 97, status: "unavailable", error: safeError(error), sendsTransactions: false, runsProviderTasks: false, walletsLoaded: false }, null, 2));
  process.exitCode = 1;
}
