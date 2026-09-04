import { parseChain } from "../types.ts";
import { body, HttpError, json } from "./http.ts";

// Canonical AGON keeps browser cookies same-origin while the VPS owns storage.
// The upstream is operator configuration, never a query/body/header parameter.
export async function proxyBnb(request: Request, chain: string, parts: string[], origin: string, send = fetch) {
  try {
    const chainId = parseChain(chain);
    if (!parts.length || parts.some((part) => !/^[a-zA-Z0-9-]+$/.test(part))) return json({ error: "Invalid BNB route." }, 400);
    const upstream = new URL(origin);
    if (upstream.protocol !== "https:" || upstream.username || upstream.password || upstream.pathname !== "/" || upstream.search || upstream.hash) throw new Error("Invalid upstream");
    const target = new URL(`/api/bnb/${chainId}/${parts.join("/")}`, upstream);
    target.search = new URL(request.url).search;
    const headers = new Headers({ accept: "application/json" });
    for (const name of ["origin", "content-type"]) { const value = request.headers.get(name); if (value) headers.set(name, value); }
    const cookie = request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`agon_bnb_${chainId}=`));
    if (cookie) headers.set("cookie", cookie);
    const input = request.method === "POST" ? JSON.stringify(await body(request)) : undefined;
    const response = await send(target, { method: request.method, headers, body: input, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(55_000) });
    const returned = new Headers({ "cache-control": "no-store", "content-type": "application/json" });
    const session = response.headers.get("set-cookie");
    if (session?.startsWith(`agon_bnb_${chainId}=`)) returned.set("set-cookie", session);
    return new Response(response.body, { status: response.status, headers: returned });
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    return json({ error: "BNB service is temporarily unavailable. Please retry." }, 503);
  }
}
