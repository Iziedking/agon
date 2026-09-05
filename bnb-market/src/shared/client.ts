import type { BnbChain, BnbSession, AgentDetail, CatalogPage, EndpointProof, Category, CommerceIntent, CommerceReadiness, CommerceStep, LpHiringReadiness } from "./types.ts";
import type { LpInput } from "./providers/lp-core.ts";
import type { LpRun } from "./providers/lp-runs.ts";
async function call<T>(chainId: BnbChain, path: string, payload?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/bnb/${chainId}/${path}`, { credentials: "same-origin", signal,
    ...(payload === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }) });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "The BNB request failed. Try again.");
  return data as T;
}
export const readCatalog = (chainId: BnbChain, offset = 0, signal?: AbortSignal) => call<CatalogPage>(chainId, `agents?offset=${offset}`, undefined, signal);
export const readAgent = (chainId: BnbChain, id: string, signal?: AbortSignal) => call<AgentDetail>(chainId, `agents/${encodeURIComponent(id)}`, undefined, signal);
export const checkAgentEndpoint = (chainId: BnbChain, id: string) => call<EndpointProof>(chainId, `agents/${encodeURIComponent(id)}/probe`, {});
export const checkCommerce = (chainId: BnbChain, id: string, signal?: AbortSignal) => call<CommerceReadiness>(chainId, `agents/${encodeURIComponent(id)}/commerce`, {}, signal);
export const publishAgent = (chainId: BnbChain, agentId: string, category: Category) => call<{ status: string }>(chainId, "listings", { agentId, category });
export const bnbMe = (chainId: BnbChain) => call<{ session: BnbSession | null }>(chainId, "auth/me");
export const startLpAnalysis = (chainId: BnbChain, runId: string, input: LpInput, signal?: AbortSignal) => call<LpRun>(chainId, "providers/lp-guardian/runs", { runId, input }, signal);
export const readLpAnalysis = (chainId: BnbChain, runId: string, signal?: AbortSignal) => call<LpRun>(chainId, `providers/lp-guardian/runs/${encodeURIComponent(runId)}`, undefined, signal);
export const checkLpHiring = (chainId: BnbChain, signal?: AbortSignal) => call<LpHiringReadiness>(chainId, "providers/lp-guardian/commerce", undefined, signal);
export const prepareLpHire = (chainId: BnbChain, intentId: string, input: LpInput) => call<CommerceIntent>(chainId, "providers/lp-guardian/hire-intents", { intentId, input });
export const readLpHire = (chainId: BnbChain, intentId: string, signal?: AbortSignal) => call<CommerceIntent>(chainId, `providers/lp-guardian/hire-intents/${encodeURIComponent(intentId)}`, undefined, signal);
export const reconcileLpHire = (chainId: BnbChain, intentId: string, step: CommerceStep, hash: `0x${string}`) => call<CommerceIntent>(chainId, `providers/lp-guardian/hire-intents/${encodeURIComponent(intentId)}/receipts`, { step, hash });
export const bnbLogout = (chainId: BnbChain) => call(chainId, "auth/logout", {});
export async function bnbLogin(chainId: BnbChain, address: `0x${string}`, sign: (message: string) => Promise<`0x${string}`>) {
  const challenge = await call<{ nonce: string; message: string; chainId: number }>(chainId, "auth/nonce", { address });
  if (challenge.chainId !== chainId) throw new Error("The sign-in request returned a different network.");
  const signature = await sign(challenge.message);
  return call<{ session: BnbSession }>(chainId, "auth/verify", { nonce: challenge.nonce, signature });
}
