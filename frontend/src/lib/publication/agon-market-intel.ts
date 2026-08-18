import { canonicalManifestHash } from "../agon/canonical.ts";

export const ARC_TESTNET_IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
export const ARC_TESTNET_AGENT_REGISTRY = `eip155:5042002:${ARC_TESTNET_IDENTITY_REGISTRY}`;
export const AGON_MARKET_INTEL_URL = "https://api.agon.surf/x402/market-intel";
export const AGON_MARKET_INTEL_MANIFEST_URL = "https://agon.surf/.well-known/agon/market-intel/manifest-v1.json";
export const AGON_MARKET_INTEL_OPENAPI_URL = "https://agon.surf/.well-known/agon/market-intel/openapi.json";

export const AGON_MARKET_INTEL_MANIFEST = {
  name: "Agon Market Intel",
  version: 1,
  description: "Returns up to eight open Polymarket crypto markets ordered by 24-hour volume, including implied yes prices and end dates.",
  category: "prediction",
  endpoint: AGON_MARKET_INTEL_URL,
  tags: ["arc", "circle-gateway", "market-data", "polymarket", "prediction-markets", "x402"],
  pricing: { rail: "x402", amountUSDC: "0.001" },
} as const;

export const AGON_MARKET_INTEL_MANIFEST_HASH = canonicalManifestHash(AGON_MARKET_INTEL_MANIFEST);

export const AGON_MARKET_INTEL_OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "Agon Market Intel",
    version: "1.0.0",
    description: "An x402-paid Arc Testnet service returning current Polymarket crypto-market odds.",
  },
  servers: [{ url: "https://api.agon.surf" }],
  paths: {
    "/x402/market-intel": {
      get: {
        operationId: "getMarketIntel",
        summary: "Get current prediction-market odds",
        description: "Returns up to eight open Polymarket crypto markets after a 0.001 USDC Circle Gateway x402 payment on Arc Testnet.",
        parameters: [{
          name: "topic",
          in: "query",
          required: false,
          description: "A label echoed in the response. The current data source uses Polymarket's Crypto tag.",
          schema: { type: "string", default: "crypto", maxLength: 100 },
        }],
        responses: {
          "200": {
            description: "Paid market-intel response",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["topic", "source", "fetchedAt", "markets", "payment"],
                  properties: {
                    topic: { type: "string" },
                    source: { type: "string", const: "polymarket" },
                    fetchedAt: { type: "string", format: "date-time" },
                    markets: {
                      type: "array",
                      maxItems: 8,
                      items: {
                        type: "object",
                        required: ["question", "impliedYes", "volume24hr", "endDate"],
                        properties: {
                          question: { type: "string" },
                          impliedYes: { type: ["number", "null"] },
                          volume24hr: { type: "number" },
                          endDate: { type: "string" },
                        },
                      },
                    },
                    payment: {
                      type: "object",
                      description: "Verified x402 payment details supplied by Circle's Gateway middleware.",
                    },
                  },
                },
              },
            },
          },
          "402": { description: "Payment required; payment options are returned by the x402 middleware." },
          "502": { description: "The upstream market-data source was unavailable after payment." },
        },
      },
    },
  },
} as const;

export function buildAgonAgentRegistration(agentIdInput: string) {
  if (!/^(0|[1-9]\d*)$/.test(agentIdInput)) {
    throw new Error("agent ID must be a canonical decimal integer");
  }
  const agentId = Number(agentIdInput);
  if (!Number.isSafeInteger(agentId)) {
    throw new Error("agent ID must fit in a JSON safe integer");
  }

  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "Agon Market Intel",
    description: "An Agon service that sells current Polymarket crypto-market odds to agents for 0.001 USDC per request over Circle Gateway x402 on Arc Testnet.",
    image: "https://agon.surf/logos/arc.png",
    services: [
      { name: "web", endpoint: "https://agon.surf/market" },
      { name: "x402", endpoint: AGON_MARKET_INTEL_URL, version: "2" },
      { name: "OpenAPI", endpoint: AGON_MARKET_INTEL_OPENAPI_URL, version: "3.1.0" },
      { name: "Agon", endpoint: AGON_MARKET_INTEL_MANIFEST_URL, version: "1" },
    ],
    x402Support: true,
    active: true,
    registrations: [{ agentId, agentRegistry: ARC_TESTNET_AGENT_REGISTRY }],
  } as const;
}
