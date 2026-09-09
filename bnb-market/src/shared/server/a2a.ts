import type { BnbChain } from "../types.ts";
import { normalizeMarketProtocol } from "../marketplace/capabilities.ts";
import { agentDetail } from "./catalog.ts";
import { HttpError, publicJson, publicJsonPost } from "./http.ts";
import { blockProvenance, buildTaskRequest, parseA2ACard, parseA2AOutcome, type A2ACapability, type A2ACard, type A2AOutcome, type A2ARun } from "../providers/a2a-core.ts";
import { checkedClient } from "./network.ts";

const MAX_PER_MINUTE_GLOBAL = 12;
const MAX_PER_MINUTE_AGENT = 4;
const MAX_ACTIVE = 3;
const DEDUPE_MS = 60_000;

const heads = new Map<number, { expires: number; value: Promise<string | null> }>();
/** Chain heights only qualify a stated block, so a head that cannot be read
 * degrades to "unconfirmed" rather than failing the run. */
function chainHead(chainId: 56 | 97): Promise<string | null> {
  const current = heads.get(chainId);
  if (current && current.expires > Date.now()) return current.value;
  const value = checkedClient(chainId).then((client) => client.getBlockNumber()).then((height) => height.toString()).catch(() => null);
  heads.set(chainId, { expires: Date.now() + 60_000, value });
  return value;
}

const recent: number[] = [];
const recentByAgent = new Map<string, number[]>();
const inFlight = new Map<string, Promise<A2ARun>>();
const results = new Map<string, { expires: number; run: A2ARun }>();

function prune(list: number[], now: number) {
  while (list.length && now - list[0] > 60_000) list.shift();
  return list;
}

/** Per-instance limits. These protect small third-party endpoints from this
 * marketplace, so they are deliberately tight. They are not shared across
 * instances, unlike the LP allowance, because a run here costs no wallet
 * spend and holds no lock. */
function admit(key: string) {
  const now = Date.now();
  prune(recent, now);
  const perAgent = prune(recentByAgent.get(key) ?? [], now);
  if (inFlight.size >= MAX_ACTIVE) throw new HttpError(429, "Too many agent runs are in progress. Wait a moment and try again.");
  if (recent.length >= MAX_PER_MINUTE_GLOBAL) throw new HttpError(429, "The free run allowance is busy. Wait a minute and try again.");
  if (perAgent.length >= MAX_PER_MINUTE_AGENT) throw new HttpError(429, "This agent has answered several free runs in the last minute. Wait a moment and try again.");
  recent.push(now); perAgent.push(now); recentByAgent.set(key, perAgent);
}

export function parseTaskText(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new HttpError(400, "Describe the task in your own words before running the agent.");
  if (text.length > 1200) throw new HttpError(400, "Keep the task under 1,200 characters.");
  return text;
}

/** The endpoint always comes from the onchain registration, never from the
 * caller, so a request cannot aim AGON's server at an arbitrary host. */
async function resolveCard(chainId: BnbChain, id: string): Promise<A2ACapability> {
  const agent = await agentDetail(chainId, id);
  if (!agent.versionHash || agent.registrationMatches === false) throw new HttpError(409, "This agent's registration must be readable and match this network before it can run.");
  const service = agent.services.find((entry) => normalizeMarketProtocol(entry.name) === "A2A");
  if (!service) throw new HttpError(409, "This agent does not advertise an A2A endpoint, so AGON cannot run it here.");
  let card: A2ACard;
  try { card = parseA2ACard(await publicJson(service.endpoint), service.endpoint); }
  catch (error) { throw new HttpError(502, error instanceof Error ? error.message : "The agent card could not be read."); }
  return { chainId, agentId: id, agentName: agent.name, versionHash: agent.versionHash, cardUrl: service.endpoint,
    endpoint: card.endpoint, protocolVersion: card.protocolVersion, skills: card.skills, checkedAt: new Date().toISOString() };
}

export async function readA2ACapability(chainId: BnbChain, id: string): Promise<A2ACapability> {
  return resolveCard(chainId, id);
}

export async function runA2ATask(chainId: BnbChain, id: string, rawText: unknown): Promise<A2ARun> {
  const request = parseTaskText(rawText);
  const key = `${chainId}:${id}`;
  const dedupeKey = `${key}:${request.toLowerCase().replace(/\s+/g, " ")}`;
  const now = Date.now();
  const cached = results.get(dedupeKey);
  // An identical request inside the window returns the same answer instead of
  // asking a third-party service the same question again.
  if (cached && cached.expires > now) return cached.run;
  const pending = inFlight.get(dedupeKey);
  if (pending) return pending;

  admit(key);
  const task = (async (): Promise<A2ARun> => {
    const capability = await resolveCard(chainId, id);
    const runId = crypto.randomUUID();
    const startedAt = Date.now();
    let outcome: A2AOutcome;
    try {
      outcome = parseA2AOutcome(await publicJsonPost(capability.endpoint, buildTaskRequest(runId, request)));
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, error instanceof Error ? error.message : "The agent did not return a usable response.");
    }
    const other: 56 | 97 = chainId === 97 ? 56 : 97;
    const [selectedHead, otherHead] = await Promise.all([chainHead(chainId), chainHead(other)]);
    return { ...outcome, chainId, agentId: id, agentName: capability.agentName, endpoint: capability.endpoint,
      protocolVersion: capability.protocolVersion, request, requestedAt: new Date(startedAt).toISOString(),
      durationMs: Date.now() - startedAt, paid: false, agonVerified: false,
      provenance: blockProvenance(outcome.blockNumber, chainId, selectedHead, otherHead) };
  })();

  inFlight.set(dedupeKey, task);
  try {
    const run = await task;
    if (results.size >= 200) results.delete(results.keys().next().value!);
    results.set(dedupeKey, { expires: Date.now() + DEDUPE_MS, run });
    return run;
  } finally {
    inFlight.delete(dedupeKey);
  }
}
