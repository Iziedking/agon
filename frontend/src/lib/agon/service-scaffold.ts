import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { keccak256, stringToHex } from "viem";

export type ServiceScaffoldInput = {
  serviceKey: string;
  name: string;
  category: string;
  description?: string;
};

export type ServiceScaffoldFile = {
  path: string;
  content: string;
};

export type ServiceScaffold = {
  serviceKey: string;
  files: ServiceScaffoldFile[];
};

function slug(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)) {
    throw new Error(`${field} must be a lowercase slug`);
  }
  return normalized;
}

function text(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized || fallback;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function scaffoldServiceProject(input: ServiceScaffoldInput): ServiceScaffold {
  const serviceKey = slug(input.serviceKey, "serviceKey");
  const category = slug(input.category, "category");
  const name = input.name.trim();
  if (!name || name.length > 80) throw new Error("name must be 1-80 characters");
  const description = text(input.description, `A ${category} service delivered by an Agon provider.`);
  if (description.length > 500) throw new Error("description must be 1-500 characters");
  const serviceKeyHash = keccak256(stringToHex(serviceKey));

  const config = {
    // Keep the flat fields for the ASP CLI contract. The nested identity block
    // is the canonical manifest shape consumed by the marketplace.
    serviceKey,
    chainId: "5042002",
    agentId: "REPLACE_WITH_ERC8004_AGENT_ID",
    protocol: "agon-service/2",
    identity: { chainId: 5042002, agentId: "REPLACE_WITH_ERC8004_AGENT_ID", serviceKey: serviceKeyHash },
    service: {
      name,
      version: "1",
      description,
      category,
      tags: [category, "agon", "x402"],
      capabilities: [category, "x402"],
    },
    invocation: {
      endpoint: "https://REPLACE_WITH_PUBLIC_HOST/execute",
      method: "POST",
      requestSchema: { type: "object", properties: {}, required: [], additionalProperties: true },
      responseSchema: { type: "object", properties: {}, required: [], additionalProperties: true },
      timeoutMs: 15000,
      maxResponseBytes: 65536,
      idempotency: "supported",
      sideEffects: "none",
      privacy: { retention: "none", sendsToThirdParties: false, description: "The provider does not retain request or response data beyond delivery." },
    },
    pricing: { rail: "x402", amountUSDC: "0.001000", network: "eip155:5042002", asset: "0x3600000000000000000000000000000000000000" },
    certification: { adapter: "agon-http", adapterVersion: "1" },
  };

  const runtime = `import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { createGatewayMiddleware, type PaymentRequest, type PaymentResponse } from "@circle-fin/x402-batching/server";

const serviceKey = ${JSON.stringify(serviceKey)};
const version = "0.1.0";
const port = Number(process.env.PORT || 8789);
const network = "eip155:5042002";
const requestLimit = 65536;
const responseLimit = 524288;
const timeoutMs = Math.max(250, Math.min(Number(process.env.PROVIDER_TIMEOUT_MS || 15000), 30000));
const price = process.env.PRICE_USDC || "0.001";
const sellerAddress = process.env.PAY_TO || "";
const gateway = sellerAddress ? createGatewayMiddleware({
  sellerAddress,
  networks: [network],
  facilitatorUrl: process.env.CIRCLE_GATEWAY_FACILITATOR_URL || "https://gateway-api-testnet.circle.com",
  description: process.env.SERVICE_DESCRIPTION || ${JSON.stringify(description)},
}) : null;

export type CategoryHandlerContext = {
  serviceKey: string;
  version: string;
  payer: string;
  network: string;
  paymentTransaction?: string;
  idempotencyKey: string;
  signal: AbortSignal;
};
export type CategoryHandler = (input: unknown, context: CategoryHandlerContext) => Promise<unknown>;

const categoryHandler: CategoryHandler = async () => {
  throw new Error("handler_not_configured");
};
const completed = new Map<string, { inputHash: string; result: unknown }>();

function send(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const encoded = JSON.stringify(body);
  if (Buffer.byteLength(encoded, "utf8") > responseLimit) {
    response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "response_too_large" }));
    return;
  }
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  response.end(encoded);
}

function readBody(request: IncomingMessage, limit = requestLimit): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    let rejected = false;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (rejected) return;
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > limit) {
        rejected = true;
        reject(new Error("request_too_large"));
      }
    });
    request.on("end", () => { if (!rejected) resolve(body); });
    request.on("error", (error) => { if (!rejected) reject(error); });
  });
}

function inputHash(body: string): string { return createHash("sha256").update(body).digest("hex"); }

async function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await Promise.race([work(controller.signal), new Promise<T>((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("handler_timeout")), { once: true }))]); }
  finally { clearTimeout(timer); }
}

function paymentMiddleware(request: PaymentRequest, response: PaymentResponse, next: (error?: unknown) => void) {
  if (!gateway) { send(response, 503, { error: "provider_not_configured", message: "PAY_TO is required before accepting paid work." }); return; }
  void gateway.require(price)(request, response, next);
}

createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    send(response, 200, { ok: true, service: "agon-provider", serviceKey, version, status: sellerAddress ? "ready" : "misconfigured", runtime: "node", network });
    return;
  }
  if (request.method === "POST" && request.url === "/execute") {
    paymentMiddleware(request as PaymentRequest, response as PaymentResponse, async (error) => {
      if (error) { send(response, 500, { error: "payment_middleware_failed" }); return; }
      const idempotencyKey = String(request.headers["idempotency-key"] || "").trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(idempotencyKey)) { send(response, 400, { error: "idempotency_key_required" }); return; }
      let body: string;
      try { body = await readBody(request); } catch (error) { send(response, error.message === "request_too_large" ? 413 : 400, { error: error.message === "request_too_large" ? "request_too_large" : "invalid_request" }); return; }
      let input: unknown;
      try { input = body ? JSON.parse(body) : null; } catch { send(response, 400, { error: "invalid_json" }); return; }
      const payment = (request as PaymentRequest).payment;
      if (!payment?.verified || payment.network !== network) { send(response, 402, { error: "payment_not_verified" }); return; }
      const key = payment.payer + ":" + idempotencyKey;
      const hash = inputHash(body);
      const previous = completed.get(key);
      if (previous) {
        if (previous.inputHash !== hash) { send(response, 409, { error: "idempotency_conflict" }); return; }
        send(response, 200, { ok: true, serviceKey, version, result: previous.result });
        return;
      }
      try {
        const result = await withTimeout((signal) => categoryHandler(input, { serviceKey, version, payer: payment.payer, network, paymentTransaction: payment.transaction, idempotencyKey, signal }));
        const encoded = JSON.stringify({ ok: true, serviceKey, version, result });
        if (Buffer.byteLength(encoded, "utf8") > responseLimit) { send(response, 500, { error: "response_too_large" }); return; }
        completed.set(key, { inputHash: hash, result });
        send(response, 200, { ok: true, serviceKey, version, result });
      } catch (error) {
        const message = error instanceof Error ? error.message : "handler_failed";
        send(response, message === "handler_timeout" ? 504 : message === "handler_not_configured" ? 501 : 500, { error: message === "handler_timeout" ? "handler_timeout" : message === "handler_not_configured" ? "handler_not_configured" : "handler_failed" });
      }
    });
    return;
  }
  send(response, 404, { error: "not_found" });
}).listen(port, "0.0.0.0", () => console.log(JSON.stringify({ serviceKey, port, status: sellerAddress ? "ready" : "misconfigured" })));
`;

  const packageJson = json({ name: `${serviceKey}-agon-provider`, private: true, type: "module", engines: { node: ">=22" }, dependencies: { "@circle-fin/x402-batching": "3.0.4" } });
  const dockerfile = `FROM node:22-alpine\nWORKDIR /app\nCOPY package.json ./package.json\nRUN npm install --omit=dev --ignore-scripts\nCOPY service.ts ./service.ts\nCOPY agon.service.json ./agon.service.json\nEXPOSE 8789\nCMD ["node", "--experimental-strip-types", "service.ts"]\n`;
  const readme = [
    `# ${name}`,
    "",
    `Agon provider scaffold for the **${serviceKey}** service.`,
    "",
    "1. Replace the ERC-8004 agent ID and public URLs in agon.service.json.",
    "2. Replace the default result handler in service.ts with your category-specific logic.",
    "3. Configure PAY_TO, PRICE_USDC, and CIRCLE_GATEWAY_FACILITATOR_URL (the Arc Testnet default is already selected).",
    "4. Run agon deploy --directory . --target docker --run.",
    "",
    "The default runtime is deliberately fail-closed: health is public, unpaid execution returns HTTP 402, and a signed request cannot be treated as settled without facilitator evidence.",
  ].join("\\n") + "\\n";

  return {
    serviceKey,
    files: [
      { path: "agon.service.json", content: json(config) },
      { path: "service.ts", content: runtime },
      { path: "Dockerfile", content: dockerfile },
      { path: "package.json", content: packageJson },
      { path: "README.md", content: readme },
    ],
  };
}

export function writeServiceScaffold(directory: string, scaffold: ServiceScaffold, force = false): string[] {
  mkdirSync(directory, { recursive: true });
  const written: string[] = [];
  for (const file of scaffold.files) {
    const target = join(directory, file.path);
    if (!force) {
      try {
        writeFileSync(target, file.content, { encoding: "utf8", flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Refusing to replace ${target}; add --force after reviewing it`);
        throw error;
      }
    } else {
      writeFileSync(target, file.content, "utf8");
    }
    written.push(target);
  }
  return written;
}
