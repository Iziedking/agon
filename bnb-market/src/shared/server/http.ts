import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request } from "node:https";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || b === 2)) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0));
  }
  // Permit global unicast only; exclude transition, documentation and special ranges.
  return isIP(address) === 6 && /^[23]/i.test(address) &&
    !/^(2001:|2002:|3fff:)/i.test(address);
}
export function httpsUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || url.hash) {
    throw new HttpError(400, "The agent must use a public HTTPS endpoint.");
  }
  return url;
}

/** DNS is resolved once and pinned into the TLS request, preventing DNS rebinding.
 * No redirects, ambient credentials, proxy environment, or cookies are forwarded.
 * Used by catalog metadata checks and the Playground endpoint probe. */
export async function publicJson(value: string): Promise<unknown> {
  const url = httpsUrl(value);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const records = isIP(host) ? [{ address: host, family: isIP(host) }] :
    await Promise.race([lookup(host, { all: true }), new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new HttpError(504, "Agent DNS lookup timed out.")), 5000); timer.unref();
    })]);
  if (!records.length || records.some((record) => !publicAddress(record.address))) throw new HttpError(400, "Private network endpoints are not permitted.");
  const resolved = records[0];
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "GET", family: resolved.family, headers: { accept: "application/json", "user-agent": "AGON/1.0" },
      lookup: (_hostname, _options, callback) => callback(null, resolved.address, resolved.family),
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new HttpError(502, `Agent endpoint returned HTTP ${res.statusCode}.`)); return; }
      let size = 0; const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 524_288) req.destroy(new HttpError(502, "Agent response is too large.")); else chunks.push(chunk); });
      res.on("error", reject);
      res.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(new HttpError(502, "Agent endpoint did not return JSON.")); } });
    });
    const deadline = setTimeout(() => req.destroy(new HttpError(504, "Agent endpoint timed out.")), 8000);
    req.on("close", () => clearTimeout(deadline)); req.on("error", reject); req.end();
  });
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(502, "The data source returned an invalid record.");
  return value as Record<string, unknown>;
}
export function text(value: unknown, max = 2000): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}
export function json(value: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(value, { status, headers: { "cache-control": "no-store", ...headers } });
}
export async function body(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Request body is required.");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length;
    if (size > 16_384) { await reader.cancel(); throw new HttpError(413, "Request is too large."); } chunks.push(part.value); }
  try { return object(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
  catch { throw new HttpError(400, "Send a valid JSON object."); }
}
