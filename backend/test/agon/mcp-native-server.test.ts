import assert from "node:assert/strict";
import test from "node:test";

import { createMcpAccessAdapter } from "../../src/agon/mcp/adapter.ts";
import { createAgonNativeMcpHandler } from "../../src/agon/mcp/native-server.ts";

const listing = {
  id: "5042002:0x1111111111111111111111111111111111111111:3",
  chainId: "5042002", serviceRegistry: "0x1111111111111111111111111111111111111111", listingId: "3", agentId: "42", serviceKey: `0x${"a".repeat(64)}`, category: "3", version: "1",
  manifest: { hash: `0x${"b".repeat(64)}`, uri: "https://provider.example/manifest.json", body: { service: { name: "CRM helper", description: "Enrich a bounded CRM list", logoUrl: "https://provider.example/logo.png", tags: ["crm"] }, invocation: { endpoint: "https://provider.example/execute", timeoutMs: 30_000, privacy: { description: "Deletes input after delivery" } }, pricing: { amountUSDC: "0.04" } } },
  providerSnapshot: `0x${"c".repeat(64)}`, status: "Listed", verification: { status: "Verified", scope: { agentId: "42", listingId: "3", version: "1", category: "3" } }, risk: { unverified: false, warning: null, quarantineReason: null }, endpointQa: { status: "passed", checkedAt: new Date().toISOString(), endpointStatus: 200, evidenceHash: `0x${"d".repeat(64)}`, reason: "ok", attempts: 1, passedAttempts: 1, successRate: 100, endpointUrl: "https://provider.example/execute" }, payment: { rail: "X402", directX402: true, escrowEligible: false }, provenance: { sourceBlockNumber: "1", sourceTxHash: `0x${"e".repeat(64)}`, sourceLogIndex: 1 },
} as const;

function request(body: unknown) {
  return new Request("https://api.agon.surf/agon/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify(body),
  });
}

test("native MCP exposes standard tool discovery and public search", async () => {
  const access = createMcpAccessAdapter({
    async listListings() { return { ok: true as const, value: { items: [listing], nextCursor: null } }; },
    async getListing() { return { ok: true as const, value: listing }; },
    async prepareX402Call() { return { ok: false as const, error: { code: "disabled", message: "disabled" } }; },
  });
  const handler = createAgonNativeMcpHandler(access);

  const initialized = await handler.fetch(request({
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } },
  }));
  assert.equal(initialized.status, 200);
  assert.match(await initialized.text(), /AGON/);

  const tools = await handler.fetch(request({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));
  assert.equal(tools.status, 200);
  assert.match(await tools.text(), /search_services/);

  const searched = await handler.fetch(request({
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "search_services", arguments: { query: "crm" } },
  }));
  assert.equal(searched.status, 200);
  assert.match(await searched.text(), /CRM helper/);
});

test("native MCP refuses provider mutations without an authenticated AGON actor", async () => {
  const access = createMcpAccessAdapter({
    async listListings() { return { ok: true as const, value: { items: [], nextCursor: null } }; },
    async getListing() { return { ok: false as const, error: { code: "not_found", message: "not found" } }; },
    async prepareX402Call() { return { ok: false as const, error: { code: "disabled", message: "disabled" } }; },
  });
  const handler = createAgonNativeMcpHandler(access);
  const response = await handler.fetch(request({
    jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: "start_listing", arguments: { name: "No actor" } },
  }));
  assert.equal(response.status, 200);
  assert.match(await response.text(), /authentication_required/);
});
