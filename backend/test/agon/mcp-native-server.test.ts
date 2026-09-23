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

test("native MCP enforces CLI capabilities before listing or spend actions", async () => {
  const access = createMcpAccessAdapter({
    async listListings() { return { ok: true as const, value: { items: [], nextCursor: null } }; },
    async getListing() { return { ok: false as const, error: { code: "not_found", message: "not found" } }; },
    async prepareX402Call() { return { ok: false as const, error: { code: "disabled", message: "disabled" } }; },
  });
  const handler = createAgonNativeMcpHandler(access);
  const address = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const authInfo = (scopes: string[]) => ({ token: "verified", clientId: "agon-cli", scopes, extra: { address, client: "agon-cli" } });
  const call = (name: string, args: Record<string, unknown>) => request({
    jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args },
  });

  const deniedListing = await handler.fetch(call("start_listing", {}), { authInfo: authInfo(["agon:read"]) });
  assert.match(await deniedListing.text(), /scope_required/);
  const permittedListing = await handler.fetch(call("start_listing", {}), { authInfo: authInfo(["listing:prepare"]) });
  assert.match(await permittedListing.text(), /invalid_request/);

  const deniedSpend = await handler.fetch(call("authorize_hire", {
    hireId: "hire-1", termsDigest: `0x${"a".repeat(64)}`, approval: "approve", idempotencyKey: "approval-1",
  }), { authInfo: authInfo(["agon:read"]) });
  assert.match(await deniedSpend.text(), /scope_required/);
  const permittedSpend = await handler.fetch(call("authorize_hire", {
    hireId: "hire-1", termsDigest: `0x${"a".repeat(64)}`, approval: "approve", idempotencyKey: "approval-1",
  }), { authInfo: authInfo(["wallet:execute"]) });
  assert.match(await permittedSpend.text(), /hire_not_found/);
});

test("native MCP accepts the per_call payment mode used by hire previews", async () => {
  const address = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const access = createMcpAccessAdapter({
    async listListings() { return { ok: true as const, value: { items: [], nextCursor: null } }; },
    async getListing() { return { ok: true as const, value: listing }; },
    async prepareX402Call(_actor, _reference, input) {
      return { ok: true as const, value: { intentId: "hire-preview", actor: address, idempotencyKey: input.idempotencyKey, listingReference: listing.id, listingVersion: "1", inputHash: `0x${"1".repeat(64)}`, maxAmountUSDC: "0.04", state: "prepared" as const, executionEnabled: false as const, nextAction: "execution_adapter_not_enabled" as const, createdAt: new Date().toISOString() } };
    },
  });
  const handler = createAgonNativeMcpHandler(access);
  const response = await handler.fetch(request({
    jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: "preview_hire", arguments: { serviceReference: listing.id, input: { records: ["a"] }, paymentMode: "per_call" } },
  }), { authInfo: { token: "verified", clientId: "agon-cli", scopes: ["agon:read"], extra: { address, client: "agon-cli" } } });
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /termsDigest/);
  assert.match(body, /per_call/);
  const escrow = await handler.fetch(request({
    jsonrpc: "2.0", id: 2, method: "tools/call",
    params: { name: "preview_hire", arguments: { serviceReference: listing.id, input: { records: ["a"] }, paymentMode: "escrow" } },
  }), { authInfo: { token: "verified", clientId: "agon-cli", scopes: ["agon:read"], extra: { address, client: "agon-cli" } } });
  assert.match(await escrow.text(), /capability_unavailable/);
});
