import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { serviceTerms } from "../../src/agon/mcp/contract.ts";
import { createPostgresMcpHireStore, reviewedTermsDigest } from "../../src/agon/mcp/hire-store.ts";
import { createAgonTestDatabase } from "./database-test-helper.ts";

const buyer = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const registry = "0x3333333333333333333333333333333333333333";
const reference = `5042002:${registry}:3`;

function reviewedTerms() {
  const reviewed = {
    service: {
      reference,
      source: { id: "arc", name: "AGON Arc" },
      name: "CRM helper",
      logoUrl: "https://provider.example/logo.png",
      provider: "Agent 42",
      outcome: "Enrich a bounded CRM list",
      category: "3",
      priceUSDC: "0.04",
      expectedLatencyMs: 30_000,
      availability: "ready",
      verification: "verified",
      privacy: "Deletes input after delivery",
      accepts: ["records"],
      returns: ["enriched records"],
    },
    input: { records: ["a"] },
    priceUSDC: "0.04",
    paymentMode: "per_call",
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    deliveryDeadlineMs: 30_000,
    privacy: "Deletes input after delivery",
    failurePolicy: "Payment and delivery are reconciled separately.",
  } as const;
  return serviceTerms.parse({ ...reviewed, termsDigest: reviewedTermsDigest(reviewed) });
}

test("MCP reviewed hire terms persist beside the intent and remain buyer-scoped", async () => {
  const database = await createAgonTestDatabase("mcp_hire");
  try {
    const intentId = randomUUID();
    await database.pool.query(
      `insert into agon_x402_call_intents (
         intent_id, actor_address, idempotency_key, listing_reference, chain_id,
         service_registry_address, listing_id, agent_id, listing_version,
         method, input, input_hash, max_amount_usdc
       ) values ($1, $2, $3, $4, 5042002, $5, 3, 42, 1, 'POST', $6::jsonb, $7, '0.04')`,
      [intentId, buyer, "mcp-hire-store-001", reference, registry, JSON.stringify({ records: ["a"] }), `0x${"b".repeat(64)}`],
    );

    const firstProcess = createPostgresMcpHireStore(database.pool);
    const terms = reviewedTerms();
    const saved = await firstProcess.create(buyer, intentId, terms);
    assert.equal(saved.terms.termsDigest, terms.termsDigest);

    const resumedProcess = createPostgresMcpHireStore(database.pool);
    assert.deepEqual((await resumedProcess.get(buyer, intentId))?.terms, terms);
    assert.equal(await resumedProcess.get(other, intentId), null);
    assert.deepEqual((await resumedProcess.create(buyer, intentId, terms)).terms, terms);
    const changed = { ...terms, priceUSDC: "0.05" };
    await assert.rejects(resumedProcess.create(buyer, intentId, changed), /digest does not match/);
    const { termsDigest: _previousDigest, ...changedReview } = changed;
    await assert.rejects(resumedProcess.create(buyer, intentId, { ...changed, termsDigest: reviewedTermsDigest(changedReview) }), /different reviewed terms/);
    await assert.rejects(resumedProcess.create(other, intentId, terms), /another actor|could not be persisted/);
  } finally {
    await database.close();
  }
});
