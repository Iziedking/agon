import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { handleBnb } from "./api.ts";
import { closeDatabase, database } from "./store.ts";

// Node 22 HTTP/Fetch bridge. Both the standalone Next app and this VPS service
// call handleBnb; there is no second marketplace implementation to drift.
export function createBnbServer(handler = handleBnb) {
  return createServer({ maxHeaderSize: 16_384, requestTimeout: 15_000, headersTimeout: 10_000 },
    async (incoming: IncomingMessage, outgoing: ServerResponse) => {
      try {
        const url = new URL(incoming.url ?? "/", process.env.BNB_APP_ORIGIN || "http://localhost:8789");
        if (incoming.method === "GET" && url.pathname === "/healthz") {
          outgoing.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
          outgoing.end(JSON.stringify({ service: "agon-bnb", revision: process.env.AGON_RELEASE_SHA || "development" })); return;
        }
        const match = /^\/api\/bnb\/(56|97)\/([a-zA-Z0-9/-]+)$/.exec(url.pathname);
        if (!match) { outgoing.writeHead(404); outgoing.end(); return; }
        if (!["GET", "POST"].includes(incoming.method ?? "")) { outgoing.writeHead(405); outgoing.end(); return; }
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of incoming) {
          size += chunk.length;
          if (size > 16_384) { outgoing.writeHead(413); outgoing.end(); return; }
          chunks.push(Buffer.from(chunk));
        }
        const headers = new Headers();
        for (const name of ["origin", "cookie", "content-type"]) {
          const value = incoming.headers[name]; if (typeof value === "string") headers.set(name, value);
        }
        const request = new Request(url, { method: incoming.method, headers,
          ...(incoming.method === "POST" ? { body: Buffer.concat(chunks) } : {}) });
        const response = await handler(request, match[1], match[2].split("/"));
        response.headers.forEach((value, name) => outgoing.setHeader(name, value));
        outgoing.writeHead(response.status); outgoing.end(Buffer.from(await response.arrayBuffer()));
      } catch {
        console.error(JSON.stringify({ event: "bnb_http_failed" }));
        if (!outgoing.headersSent) outgoing.writeHead(503, { "content-type": "application/json" });
        outgoing.end(JSON.stringify({ error: "BNB service unavailable. Please retry." }));
      }
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Initialize schema before accepting traffic. No secrets appear in failures.
  try { await database(); } catch { console.error("BNB database initialization failed"); process.exit(1); }
  const server = createBnbServer(); server.listen(Number(process.env.PORT || 8789), "0.0.0.0");
  let stopping = false;
  const stop = () => {
    if (stopping) return; stopping = true;
    server.close(() => { void closeDatabase().then(() => process.exit(0)); });
    setTimeout(() => process.exit(1), 55_000).unref();
  };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
}
