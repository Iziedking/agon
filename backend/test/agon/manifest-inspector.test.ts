import assert from "node:assert/strict";
import test from "node:test";

import { inspectManifest, ManifestInspectionError } from "../../src/agon/manifest-inspector.ts";

const manifest = {
  name: "Analysis service",
  version: 1,
  description: "Returns a bounded analysis result.",
  category: "analysis",
  endpoint: "https://agent.example.com/analyze",
  tags: ["analysis"],
  logoUrl: "https://agent.example.com/logo.png",
  pricing: { rail: "x402", amountUSDC: "0.01" },
};

const publicResolver = async () => ["93.184.216.34"];

test("inspects a bounded public manifest and returns its canonical hash", async () => {
  const result = await inspectManifest("https://agent.example.com/manifest.json", {
    resolve: publicResolver,
    fetch: async () => new Response(JSON.stringify(manifest), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });

  assert.equal(result.validation.ok, true);
  assert.deepEqual(result.body, manifest);
  assert.match(result.manifestHash, /^0x[0-9a-f]{64}$/);
  assert.equal(result.contentType, "application/json");
});

test("blocks private addresses before making the provider request", async () => {
  await assert.rejects(
    inspectManifest("https://agent.example.com/manifest.json", {
      resolve: async () => ["192.168.1.10"],
      fetch: async () => { throw new Error("fetch must not run"); },
    }),
    (error: unknown) => error instanceof ManifestInspectionError && error.code === "manifest_uri_blocked",
  );
});

test("rejects malformed provider JSON", async () => {
  await assert.rejects(
    inspectManifest("https://agent.example.com/manifest.json", {
      resolve: publicResolver,
      fetch: async () => new Response("not-json", { status: 200 }),
    }),
    (error: unknown) => error instanceof ManifestInspectionError && error.code === "manifest_invalid_json",
  );
});
