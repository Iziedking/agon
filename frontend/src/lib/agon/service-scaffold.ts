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

  const runtime = `import { createServer } from "node:http";

const serviceKey = ${JSON.stringify(serviceKey)};
const version = "0.1.0";
const port = Number(process.env.PORT || 8789);
const paymentRequired = Buffer.from(JSON.stringify({
  x402Version: 2,
  resource: { url: process.env.PUBLIC_ENDPOINT || "http://localhost:" + port + "/execute" },
  accepts: [{
    scheme: "exact",
    network: "eip155:5042002",
    asset: process.env.USDC_ASSET || "0x3600000000000000000000000000000000000000",
    amount: process.env.AMOUNT_BASE_UNITS || "1000",
    payTo: process.env.PAY_TO || "0x0000000000000000000000000000000000000001",
    maxTimeoutSeconds: 60,
    extra: { name: "GatewayWalletBatched", version: "1", serviceKey, serviceVersion: version, verifyingContract: process.env.GATEWAY_VERIFYING_CONTRACT || "0x0000000000000000000000000000000000000001" }
  }]
})).toString("base64");

function send(response, status, body, headers = {}) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(body));
}

createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    send(response, 200, { ok: true, service: "agon-provider", serviceKey, version, status: "ready", runtime: "node" });
    return;
  }
  if (request.method === "POST" && request.url === "/execute") {
    if (!request.headers["payment-signature"]) {
      send(response, 402, { error: "payment_required", serviceKey, version }, { "payment-required": paymentRequired });
      return;
    }
    if (!process.env.AGON_PAYMENT_RESPONSE) {
      send(response, 503, { error: "facilitator_not_configured", message: "Payment verification is disabled until a trusted facilitator is configured." });
      return;
    }
    send(response, 501, { error: "handler_not_configured", message: "Implement the service handler before accepting paid work." });
    return;
  }
  send(response, 404, { error: "not_found" });
}).listen(port, "0.0.0.0", () => console.log(JSON.stringify({ serviceKey, port, status: "ready" })));
`;

  const dockerfile = `FROM node:22-alpine\nWORKDIR /app\nCOPY service.ts ./service.ts\nCOPY agon.service.json ./agon.service.json\nEXPOSE 8789\nCMD ["node", "--experimental-strip-types", "service.ts"]\n`;
  const readme = [
    `# ${name}`,
    "",
    `Agon provider scaffold for the **${serviceKey}** service.`,
    "",
    "1. Replace the ERC-8004 agent ID and public URLs in agon.service.json.",
    "2. Implement the paid handler in service.ts.",
    "3. Configure a trusted x402 facilitator before accepting paid work.",
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
