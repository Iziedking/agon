import assert from "node:assert/strict";
import test from "node:test";

import { canonicalManifestHash } from "../agon/canonical.ts";
import {
  AGON_MARKET_INTEL_MANIFEST,
  AGON_MARKET_INTEL_MANIFEST_HASH,
  AGON_MARKET_INTEL_OPENAPI,
  AGON_MARKET_INTEL_URL,
  buildAgonAgentRegistration,
} from "./agon-market-intel.ts";

test("builds an ERC-8004 registration-v1 document for the requested agent", () => {
  const registration = buildAgonAgentRegistration("42");

  assert.equal(registration.type, "https://eips.ethereum.org/EIPS/eip-8004#registration-v1");
  assert.equal(registration.name, "Agon Market Intel");
  assert.equal(registration.x402Support, true);
  assert.equal(registration.active, true);
  assert.deepEqual(registration.registrations, [{
    agentId: 42,
    agentRegistry: "eip155:5042002:0x8004A818BFB912233c491871b3d84c89A494BD9e",
  }]);
  assert.ok(registration.services.some((service) => (
    service.name === "x402" && service.endpoint === AGON_MARKET_INTEL_URL
  )));
  assert.throws(() => buildAgonAgentRegistration("0042"), /canonical decimal/i);
  assert.throws(() => buildAgonAgentRegistration("9007199254740992"), /safe integer/i);
});

test("pins the immutable Agon market-intel manifest and canonical hash", () => {
  assert.deepEqual(AGON_MARKET_INTEL_MANIFEST, {
    name: "Agon Market Intel",
    version: 1,
    description: "Returns up to eight open Polymarket crypto markets ordered by 24-hour volume, including implied yes prices and end dates.",
    category: "prediction",
    endpoint: "https://api.agon.surf/x402/market-intel",
    tags: ["arc", "circle-gateway", "market-data", "polymarket", "prediction-markets", "x402"],
    pricing: { rail: "x402", amountUSDC: "0.001" },
  });
  assert.equal(
    canonicalManifestHash(AGON_MARKET_INTEL_MANIFEST),
    "0xe75be3da603ea9a7839ca1c4e9ae8bf1936a818fb1d64069f1e5dda12a01e8ed",
  );
  assert.equal(
    AGON_MARKET_INTEL_MANIFEST_HASH,
    "0xe75be3da603ea9a7839ca1c4e9ae8bf1936a818fb1d64069f1e5dda12a01e8ed",
  );
});

test("publishes an OpenAPI 3.1 contract for the exact paid GET resource", () => {
  assert.equal(AGON_MARKET_INTEL_OPENAPI.openapi, "3.1.0");
  assert.deepEqual(AGON_MARKET_INTEL_OPENAPI.servers, [{ url: "https://api.agon.surf" }]);

  const operation = AGON_MARKET_INTEL_OPENAPI.paths["/x402/market-intel"].get;
  assert.equal(operation.operationId, "getMarketIntel");
  assert.ok(operation.responses["200"]);
  assert.ok(operation.responses["402"]);
  assert.ok(operation.responses["502"]);
});
