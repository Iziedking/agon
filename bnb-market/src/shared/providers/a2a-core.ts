// Pure A2A parsing. No network, no clock, no environment, so every refusal
// below is testable. Shapes were read from live agent cards on 2026-09-09:
// https://marque.trade/agents/keel/.well-known/agent-card.json (protocolVersion
// 0.3.0) and https://agent-forge-atdz.onrender.com/.well-known/agent-card.json.
// A response is provider output. It is never an AGON verification.

export type A2ASkill = { id: string; name: string; description: string; tags: string[] };
export type A2ACard = {
  name: string;
  description: string;
  endpoint: string;
  protocolVersion: string | null;
  skills: A2ASkill[];
  streaming: boolean;
};
export type A2AState = "completed" | "input_required" | "failed" | "unknown";
export type A2AOutcome = {
  state: A2AState;
  /** Provider text, in order. Kept verbatim; never merged into a claim. */
  artifacts: string[];
  /** Present when the provider stated a chain height for its read. */
  blockNumber: string | null;
  message: string;
};

function str(value: unknown, max = 2000): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export function parseA2ACard(value: unknown, cardUrl: string): A2ACard {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The agent card is not a JSON object.");
  const row = value as Record<string, unknown>;
  const name = str(row.name, 180);
  if (!name) throw new Error("The agent card does not name the service.");
  if (!Array.isArray(row.skills) || !row.skills.length) throw new Error("The agent card declares no skills, so there is nothing to run.");
  // A2A allows a card to be served from a different path than its RPC url.
  // Trust the card's own url, but require it to be HTTPS and same-origin as
  // the endpoint the registry advertised, so a card cannot redirect a buyer
  // to an unrelated host.
  const declared = str(row.url, 500);
  const target = declared || cardUrl;
  let endpoint: URL;
  let origin: URL;
  try { endpoint = new URL(target); origin = new URL(cardUrl); }
  catch { throw new Error("The agent card does not state a usable endpoint."); }
  if (endpoint.protocol !== "https:") throw new Error("The agent endpoint must use HTTPS.");
  if (endpoint.origin !== origin.origin) throw new Error("The agent card points at a different host than its registered endpoint.");
  const skills: A2ASkill[] = [];
  for (const entry of row.skills.slice(0, 20)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const skill = entry as Record<string, unknown>;
    const id = str(skill.id, 120);
    if (!id) continue;
    skills.push({ id, name: str(skill.name, 180) || id, description: str(skill.description, 600),
      tags: (Array.isArray(skill.tags) ? skill.tags : []).map((tag) => str(tag, 60)).filter(Boolean).slice(0, 12) });
  }
  if (!skills.length) throw new Error("The agent card declares no identifiable skill.");
  const capabilities = row.capabilities && typeof row.capabilities === "object" && !Array.isArray(row.capabilities)
    ? row.capabilities as Record<string, unknown> : {};
  return { name, description: str(row.description, 1200), endpoint: endpoint.toString(),
    protocolVersion: str(row.protocolVersion, 40) || null, skills, streaming: capabilities.streaming === true };
}

export function buildTaskRequest(runId: string, text: string) {
  return {
    jsonrpc: "2.0", id: runId, method: "message/send",
    params: { message: { role: "user", messageId: `agon-${runId}`, parts: [{ kind: "text", text }] } },
  };
}

/** Read a provider's own words out of an A2A envelope without interpreting
 * them. An agent that asks for more input, or declines, is a real result and
 * must not be shown as a failure of the marketplace. */
export function parseA2AOutcome(value: unknown): A2AOutcome {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The agent returned an invalid response.");
  const row = value as Record<string, unknown>;
  if (row.error && typeof row.error === "object" && !Array.isArray(row.error)) {
    const error = row.error as Record<string, unknown>;
    return { state: "failed", artifacts: [], blockNumber: null,
      message: str(error.message, 400) || "The agent refused the request." };
  }
  const result = row.result && typeof row.result === "object" && !Array.isArray(row.result) ? row.result as Record<string, unknown> : null;
  if (!result) throw new Error("The agent response carried no result.");
  const status = result.status && typeof result.status === "object" && !Array.isArray(result.status) ? result.status as Record<string, unknown> : {};
  const declared = str(status.state, 40);
  const state: A2AState = declared === "completed" ? "completed"
    : declared === "input-required" || declared === "input_required" ? "input_required"
    : declared === "failed" || declared === "canceled" || declared === "rejected" ? "failed"
    : "unknown";
  const artifacts: string[] = [];
  for (const artifact of (Array.isArray(result.artifacts) ? result.artifacts : []).slice(0, 10)) {
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) continue;
    const parts = (artifact as Record<string, unknown>).parts;
    for (const part of (Array.isArray(parts) ? parts : []).slice(0, 20)) {
      if (!part || typeof part !== "object" || Array.isArray(part)) continue;
      const value = str((part as Record<string, unknown>).text, 20_000);
      if (value) artifacts.push(value);
    }
  }
  // Several agents answer with a JSON document inside a text part. Surface a
  // stated block height when present, because a read without a height is not
  // anchored to anything, but never invent one.
  let blockNumber: string | null = null;
  for (const artifact of artifacts) {
    try {
      const parsed: unknown = JSON.parse(artifact);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const candidate = (parsed as Record<string, unknown>).blockNumber ?? (parsed as Record<string, unknown>).block;
        if (typeof candidate === "string" && /^[0-9]{1,20}$/.test(candidate)) { blockNumber = candidate; break; }
        if (typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate > 0) { blockNumber = String(candidate); break; }
      }
    } catch { /* a plain-text artifact is normal, not an error */ }
  }
  const message = state === "completed" ? "The agent completed this task and returned the result below."
    : state === "input_required" ? "The agent needs more detail before it will answer. Its exact request is below."
    : state === "failed" ? "The agent declined this task. Its stated reason is below."
    : "The agent responded, but did not state a recognised task state.";
  if (state !== "input_required" && !artifacts.length) {
    return { state, artifacts, blockNumber, message: "The agent responded without any readable output." };
  }
  return { state, artifacts, blockNumber, message };
}

/** Wire contract for the A2A capability and run routes. Declared here because
 * this module is browser-safe, so the client and the server share one shape. */
export type A2ACapability = {
  chainId: 56 | 97; agentId: string; agentName: string; versionHash: string;
  cardUrl: string; endpoint: string; protocolVersion: string | null;
  skills: A2ASkill[]; checkedAt: string;
};
export type A2ARun = A2AOutcome & {
  chainId: 56 | 97; agentId: string; agentName: string; endpoint: string;
  protocolVersion: string | null; request: string; requestedAt: string; durationMs: number;
  paid: false; agonVerified: false; provenance: BlockProvenance;
};

/** An agent registered on one chain may read another. Keel is registered on
 * chain 97 but answered with BSC Mainnet heights on 2026-09-09, so a stated
 * block must be checked against the chain the buyer selected instead of being
 * displayed as if it came from it. Tolerances: a small forward drift covers
 * head races, and a wide backward window covers a legitimately stale read. */
export type BlockProvenance = {
  verdict: "matches_selected" | "matches_other_chain" | "outside_both" | "not_stated";
  statedBlock: string | null;
  selectedChainHead: string | null;
  otherChainHead: string | null;
  message: string;
};

const FORWARD_DRIFT = 200n;
const STALE_WINDOW = 500_000n;

function consistent(stated: bigint, head: bigint | null): boolean {
  if (head === null) return false;
  return stated <= head + FORWARD_DRIFT && head - stated <= STALE_WINDOW;
}

export function blockProvenance(
  statedBlock: string | null,
  selectedChainId: 56 | 97,
  selectedChainHead: string | null,
  otherChainHead: string | null,
): BlockProvenance {
  const selectedLabel = selectedChainId === 97 ? "BSC Testnet" : "BSC Mainnet";
  const otherLabel = selectedChainId === 97 ? "BSC Mainnet" : "BSC Testnet";
  const base = { statedBlock, selectedChainHead, otherChainHead };
  if (!statedBlock) {
    return { ...base, verdict: "not_stated",
      message: "The agent did not state the block it read, so its answer cannot be anchored to a chain height." };
  }
  const stated = BigInt(statedBlock);
  const selected = selectedChainHead === null ? null : BigInt(selectedChainHead);
  const other = otherChainHead === null ? null : BigInt(otherChainHead);
  if (consistent(stated, selected)) {
    return { ...base, verdict: "matches_selected",
      message: `The agent read block ${statedBlock}, which is consistent with ${selectedLabel}.` };
  }
  if (consistent(stated, other)) {
    return { ...base, verdict: "matches_other_chain",
      message: `The agent stated block ${statedBlock}, which matches ${otherLabel}, not the ${selectedLabel} listing you are viewing. Its data source is a different chain from its registration.` };
  }
  return { ...base, verdict: "outside_both",
    message: `The agent stated block ${statedBlock}, which does not match the current height of ${selectedLabel} or ${otherLabel}. Treat its data source as unconfirmed.` };
}
