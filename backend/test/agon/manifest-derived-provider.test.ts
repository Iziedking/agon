import assert from "node:assert/strict";
import test from "node:test";

import { canonicalManifestHash } from "../../src/agon/core/manifest.ts";
import {
  createManifestDerivedAgonEndpointQaRunner,
  createManifestDerivedPlaygroundProviderRunner,
} from "../../src/agon/manifest-derived-provider.ts";

const manifestUrl = "https://provider.example/agon-service.json";
const endpointUrl = "https://provider.example/x402/analyze";
const baseProvider = {
  agentId: "886270",
  serviceKey: `0x${"11".repeat(32)}`,
  listingReference: `5042002:0x${"22".repeat(20)}:2`,
  listingVersion: "3",
};
const manifest = {
  protocol: "agon-service/1",
  endpoint: endpointUrl,
  tags: ["analysis"],
  pricing: { rail: "x402", amountUSDC: "0.01" },
};

function provider() {
  return { ...baseProvider, manifestUri: manifestUrl, manifestHash: canonicalManifestHash(manifest) };
}

function fetchForManifest() {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.method === "GET") {
      return new Response(JSON.stringify(manifest), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (request.url === endpointUrl) {
      return new Response(JSON.stringify({
        protocol: "agon-playground/1",
        agent: { name: "Provider", version: "1.0.0", capabilities: ["analysis"] },
        output: { writesPerformed: false, ignoredInstructions: true, decision: "review", observations: ["ok"], untrustedClaims: [] },
        externalWrites: false,
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("missing", { status: 404 });
  };
}

test("automatic provider runner fetches and hash-checks the listing manifest", async () => {
  const runner = createManifestDerivedPlaygroundProviderRunner({
    fetch: fetchForManifest(),
    resolve: async () => ["93.184.216.34"],
  });
  assert.equal(runner.supports(provider()), true);
  const result = await runner.run({
    provider: provider(),
    task: { id: "evidence-under-pressure", category: "analysis", title: "test", adversarialPrompt: "test", capability: "analysis" },
    taskInput: { evidence: "test" },
  });
  assert.equal(result.passed, true);
  assert.equal(result.providerHost, "provider.example");
});

test("automatic provider runner fails closed on a manifest hash mismatch", async () => {
  const runner = createManifestDerivedPlaygroundProviderRunner({
    fetch: fetchForManifest(),
    resolve: async () => ["93.184.216.34"],
  });
  await assert.rejects(
    runner.run({
      provider: { ...provider(), manifestHash: `0x${"aa".repeat(32)}` },
      task: { id: "evidence-under-pressure", category: "analysis", title: "test", adversarialPrompt: "test", capability: "analysis" },
      taskInput: {},
    }),
    /manifest hash does not match/,
  );
});

test("automatic endpoint QA uses the manifest payment endpoint and records 402", async () => {
  const qa = createManifestDerivedAgonEndpointQaRunner({
    fetch: async (input, init) => {
      const request = new Request(input, init);
      if (request.method === "GET") return new Response(JSON.stringify(manifest), { status: 200, headers: { "content-type": "application/json" } });
      return new Response("payment required", {
        status: 402,
        headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify({ accepts: [{ scheme: "exact" }] })).toString("base64url") },
      });
    },
    resolve: async () => ["93.184.216.34"],
  });
  const result = await qa.run({ provider: provider() });
  assert.equal(result.passed, true);
  assert.equal(result.evidence.endpointStatus, 402);
});

