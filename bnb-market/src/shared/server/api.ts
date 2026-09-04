import { parseAgentId, parseChain, isCategory } from "../types.ts";
import { agentDetail, catalog, probeAgent } from "./catalog.ts";
import { challenge, currentSession, endSession, requestOrigin, setSessionCookie, verify } from "./auth.ts";
import { database } from "./store.ts";
import { body, HttpError, json } from "./http.ts";

export async function handleBnb(request: Request, chain: string, parts: string[]): Promise<Response> {
  try {
    const chainId = parseChain(chain); const path = parts.join("/");
    if (request.method === "GET") {
      if (path === "health") return json({ chainId, catalog: "8004scan", identity: "rpc", login: process.env.BNB_DATABASE_URL ? "configured" : "unavailable", payments: "unavailable" });
      if (path === "auth/me") return json({ session: await currentSession(request, chainId) });
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
    if (path === "auth/nonce") return json(await challenge(chainId, input.address, origin));
    if (path === "auth/verify") {
      const result = await verify(chainId, origin, input.nonce, input.signature);
      return json({ session: result.session }, 200, { "set-cookie": setSessionCookie(chainId, result.token, origin.startsWith("https:")) });
    }
    if (parts[0] === "agents" && parts[2] === "probe" && parts.length === 3) return json(await probeAgent(chainId, parseAgentId(parts[1])));
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
