import { parseAgentId, parseChain, isCategory } from "../types.ts";
import { agentDetail, catalog, probeAgent } from "./catalog.ts";
import { challenge, currentSession, endSession, requestOrigin, setSessionCookie, verify } from "./auth.ts";
import { database } from "./store.ts";
import { body, HttpError, json } from "./http.ts";
import { commerceReadiness, readCommerceJob, readCommerceReceipt } from "./commerce.ts";
import { checkedClient, networkConfig } from "./network.ts";
import { lpDailyLimit, readLpRun, runLpAgent } from "../providers/lp-runs.ts";
import { LP_AGENT_VERSION } from "../providers/lp-core.ts";
import { lpHiringReadiness, prepareLpHireIntent, readLpHireIntent, reconcileLpHireTransaction } from "./commerce-intents.ts";
import { lpCommerceConfig } from "./commerce-intent-core.ts";
import { readPublicDeliverable } from "./lp-delivery.ts";

export async function handleBnb(request: Request, chain: string, parts: string[]): Promise<Response> {
  try {
    const chainId = parseChain(chain); const path = parts.join("/");
    if (request.method === "GET") {
      if (path === "health") {
        let storage = process.env.BNB_DATABASE_URL ? "unavailable" : "not_configured";
        let rpc = "unavailable";
        await Promise.all([
          process.env.BNB_DATABASE_URL ? database().then((db) => db.query("SELECT 1")).then(() => { storage = "reachable"; }).catch(() => undefined) : Promise.resolve(),
          checkedClient(chainId).then(() => { rpc = "reachable"; }).catch(() => undefined),
        ]);
        let payments = "unavailable";
        if (chainId === 97 && storage === "reachable" && rpc === "reachable") {
          payments = await lpHiringReadiness(chainId).then((value) => value.status === "available" ? "wallet_flow_available" : value.status).catch(() => "unavailable");
        }
        return json({ chainId, catalogSource: "8004scan", rpc, storage,
          login: storage === "reachable" && rpc === "reachable" ? "available" : "unavailable",
          payments, taskExecution: "unavailable", settlementWrites: "unavailable",
          lpAnalysis: chainId === 97 && storage === "reachable" && rpc === "reachable" && lpDailyLimit() > 0 ? "read_only_available" : "unavailable" });
      }
      if (path === "providers/lp-guardian") {
        const readiness = await lpHiringReadiness(chainId);
        return json({ name: "AGON LP Guardian", operator: "AGON", version: LP_AGENT_VERSION,
          chainId, mode: "read_only", supported: chainId === 97, registration: readiness.agentId ? "configured" : "not_configured",
          paidHiring: readiness.enabled, transactions: false, hiring: readiness,
          description: "Checks a PancakeSwap v3 position and proposes a tick-aligned range for review when its price evidence passes." });
      }
      if (path === "providers/lp-guardian/commerce") return json(await lpHiringReadiness(chainId));
      if (path === "providers/lp-guardian/erc8183/status") {
        const readiness = await lpHiringReadiness(chainId);
        const configured = lpCommerceConfig(process.env);
        const contracts = networkConfig(chainId).contracts;
        return json({ status: readiness.enabled ? "ok" : "unavailable", service: "AGON LP Guardian", version: LP_AGENT_VERSION,
          chain_id: chainId, agent_id: readiness.agentId, agent_address: readiness.providerAddress,
          commerce_address: contracts.commerceProxy, router_address: contracts.routerProxy, policy_address: contracts.policy,
          payment_token: readiness.token?.address ?? contracts.paymentToken, service_price: configured.ready ? configured.config.priceRaw : null,
          paid_hiring: readiness.enabled, blockers: readiness.blockers });
      }
      if (parts[0] === "providers" && parts[1] === "lp-guardian" && parts[2] === "runs" && parts.length === 4) return json(await readLpRun(chainId, parts[3]));
      if (parts[0] === "providers" && parts[1] === "lp-guardian" && parts[2] === "deliverables" && parts.length === 4) {
        if (chainId !== 97) throw new HttpError(409, "LP Guardian deliverables are available on BNB Testnet only.");
        return json(await readPublicDeliverable(parts[3]), 200, { "cache-control": "public, max-age=60" });
      }
      if (parts[0] === "providers" && parts[1] === "lp-guardian" && parts[2] === "hire-intents" && parts.length === 4) {
        const session = await currentSession(request, chainId);
        if (!session) throw new HttpError(401, "Sign in with the buyer wallet to inspect this hiring intent.");
        return json(await readLpHireIntent(chainId, session.address, parts[3]));
      }
      if (path === "auth/me") return json({ session: await currentSession(request, chainId) });
      if (parts[0] === "jobs" && parts.length === 2) return json(await readCommerceJob(chainId, parseAgentId(parts[1])));
      if (parts[0] === "receipts" && parts.length === 2) return json(await readCommerceReceipt(chainId, parts[1]));
      if (path === "agents") {
        const offset = Number(new URL(request.url).searchParams.get("offset") ?? 0);
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000) throw new HttpError(400, "Invalid catalog page.");
        return json(await catalog(chainId, offset));
      }
      if (parts[0] === "agents" && parts.length === 2) return json(await agentDetail(chainId, parseAgentId(parts[1])));
      throw new HttpError(404, "This BNB route does not exist.");
    }
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed.");
    const origin = requestOrigin(request);
    if (path === "auth/logout") {
      await endSession(request, chainId);
      return json({ signedOut: true }, 200, { "set-cookie": setSessionCookie(chainId, "", origin.startsWith("https:"), 0) });
    }
    const input = await body(request);
    if (path === "providers/lp-guardian/runs") {
      if (Object.keys(input).some((key) => key !== "runId" && key !== "input")) throw new HttpError(400, "Unsupported analysis request field.");
      const run = await runLpAgent(chainId, input.runId, input.input);
      return json(run, run.status === "running" ? 202 : 200);
    }
    if (path === "providers/lp-guardian/hire-intents") {
      const session = await currentSession(request, chainId);
      if (!session) throw new HttpError(401, "Sign in with the buyer wallet before preparing a protected job.");
      if (Object.keys(input).some((key) => key !== "intentId" && key !== "input")) throw new HttpError(400, "Unsupported hiring request field.");
      return json(await prepareLpHireIntent(chainId, session.address, input.intentId, input.input), 201);
    }
    if (parts[0] === "providers" && parts[1] === "lp-guardian" && parts[2] === "hire-intents" && parts[4] === "receipts" && parts.length === 5) {
      const session = await currentSession(request, chainId);
      if (!session) throw new HttpError(401, "Sign in with the buyer wallet before reconciling a wallet action.");
      if (Object.keys(input).some((key) => key !== "step" && key !== "hash")) throw new HttpError(400, "Unsupported receipt field.");
      return json(await reconcileLpHireTransaction(chainId, session.address, parts[3], input.step, input.hash));
    }
    if (path === "auth/nonce") return json(await challenge(chainId, input.address, origin));
    if (path === "auth/verify") {
      const result = await verify(chainId, origin, input.nonce, input.signature);
      return json({ session: result.session }, 200, { "set-cookie": setSessionCookie(chainId, result.token, origin.startsWith("https:")) });
    }
    if (parts[0] === "agents" && parts[2] === "probe" && parts.length === 3) return json(await probeAgent(chainId, parseAgentId(parts[1])));
    if (parts[0] === "agents" && parts[2] === "commerce" && parts.length === 3) return json(await commerceReadiness(chainId, parseAgentId(parts[1])));
    if (path === "listings") {
      const session = await currentSession(request, chainId);
      if (!session) throw new HttpError(401, "Sign in with the agent owner's wallet to publish.");
      if (!isCategory(input.category)) throw new HttpError(400, "Choose a service category.");
      const detail = await agentDetail(chainId, parseAgentId(input.agentId), true);
      if (detail.owner.toLowerCase() !== session.address.toLowerCase()) throw new HttpError(403, "Only the current onchain owner can publish this agent.");
      if (!detail.versionHash || detail.registrationMatches === false || !detail.services.length) throw new HttpError(409, "Publish a readable agent registration with a public service endpoint first.");
      await (await database()).query(`INSERT INTO bnb_market_listings(chain_id,agent_id,owner_address,category,version_hash)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(chain_id,agent_id) DO UPDATE SET owner_address=EXCLUDED.owner_address,
        category=EXCLUDED.category,version_hash=EXCLUDED.version_hash,published_at=now()`, [chainId, detail.id, session.address.toLowerCase(), input.category, detail.versionHash]);
      return json({ agentId: detail.id, chainId, versionHash: detail.versionHash, status: "provider_listed" }, 201);
    }
    throw new HttpError(404, "This BNB action does not exist.");
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    if (error instanceof Error && (error.message.startsWith("Select BNB") || error.message.startsWith("Enter a valid agent"))) return json({ error: error.message }, 400);
    // RPC and database error objects may contain credential-bearing URLs.
    console.error(JSON.stringify({ event: "bnb_request_failed", chain, path: parts.slice(0, 3).join("/") }));
    return json({ error: "The BNB service could not complete this request. Please try again." }, 503);
  }
}
