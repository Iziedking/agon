import test from "node:test";
import assert from "node:assert/strict";
import { authorizeHireInput, mcpOperation, previewHireInput, providerDraftInput, serviceTerms } from "../../src/agon/mcp/contract.ts";

const service = {
  reference: "5042002:registry:3",
  source: { id: "arc", name: "AGON Arc" },
  name: "Lead enrichment",
  logoUrl: "https://provider.example/logo.png",
  provider: "Example provider",
  outcome: "Enrich a bounded CRM list",
  category: "analysis",
  priceUSDC: "0.010000",
  expectedLatencyMs: 15_000,
  availability: "ready",
  verification: "verified",
  privacy: "Deletes input after delivery",
  accepts: ["records"],
  returns: ["enriched records"],
} as const;

test("MCP terms are human-readable and bind an exact digest", () => {
  const parsed = serviceTerms.parse({
    service,
    input: { records: [{ email: "user@example.com" }] },
    priceUSDC: "0.010000",
    paymentMode: "per_call",
    expiresAt: "2026-09-19T18:00:00.000Z",
    deliveryDeadlineMs: 30_000,
    privacy: "Deletes input after delivery",
    failurePolicy: "Retry delivery without another charge when payment is settled",
    termsDigest: `0x${"a".repeat(64)}`,
  });
  assert.equal(parsed.paymentMode, "per_call");
  assert.equal(parsed.termsDigest.length, 66);
});

test("approval requires an exact terms digest and idempotency key", () => {
  assert.throws(() => authorizeHireInput.parse({ approval: "approve", termsDigest: "0x123", idempotencyKey: "short" }));
  assert.equal(authorizeHireInput.parse({ approval: "approve", termsDigest: `0x${"b".repeat(64)}`, idempotencyKey: "hire-2026-001" }).approval, "approve");
});

test("MCP operations reject protocol-shaped unknown fields", () => {
  assert.throws(() => previewHireInput.parse({ serviceReference: "service-1", input: {}, paymentMode: "per_call", x402Header: "secret" }));
  assert.throws(() => mcpOperation.parse({ kind: "authorize_hire", input: { approval: "approve", termsDigest: `0x${"a".repeat(64)}`, idempotencyKey: "hire-2026-001", rawTransaction: "0xdead" } }));
});

test("provider drafts require HTTPS and explicit terms", () => {
  const draft = providerDraftInput.parse({
    name: "CRM helper",
    logoUrl: "https://provider.example/logo.png",
    outcome: "Enrich a bounded CRM list",
    category: "crm",
    inputs: ["records"],
    outputs: ["enriched records"],
    priceUSDC: "0.04",
    expectedLatencyMs: 90_000,
    privacy: "Deletes input after delivery",
    failurePolicy: "Retry delivery without another charge when safe",
    endpoint: "https://provider.example/execute",
  });
  assert.equal(draft.endpoint.startsWith("https://"), true);
  assert.equal(draft.logoUrl, "https://provider.example/logo.png");
  assert.throws(() => providerDraftInput.parse({ ...draft, logoUrl: undefined }));
  assert.throws(() => providerDraftInput.parse({ ...draft, endpoint: "http://provider.example/execute" }));
});
