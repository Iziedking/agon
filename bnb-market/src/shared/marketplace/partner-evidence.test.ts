import assert from "node:assert/strict";
import test from "node:test";
import { validatePartnerEvidence } from "./partner-evidence.ts";

function validEvidence(): Record<string, unknown> {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  return {
    version: 1,
    chainId: 97,
    categories: {
      rebalancing: { agentId: "2177", endpoint: "https://example.com/rebalancing", status: "reachable", checkedAt: future },
      "grid-trading": { agentId: "2202", endpoint: "https://example.com/grid", status: "reachable", checkedAt: future },
      "yield-optimisation": { agentId: "2175", endpoint: "https://example.com/yield", status: "reachable", checkedAt: future },
      "health-factor": { agentId: "2203", endpoint: "https://example.com/health", status: "reachable", checkedAt: future },
    },
    paidHire: {
      chainId: 97,
      agentId: "2177",
      intentId: "intent-1",
      createTxHash: `0x${"1".repeat(64)}`,
      registerTxHash: `0x${"2".repeat(64)}`,
      approveTxHash: `0x${"3".repeat(64)}`,
      fundTxHash: `0x${"4".repeat(64)}`,
      deliverableUrl: "https://example.com/deliverable.json",
      receiptUrl: "https://example.com/receipt.json",
      deliveryStatus: "completed",
    },
    altana: {
      chainId: 97,
      sessionCreateTx: `0x${"5".repeat(64)}`,
      revokeTx: `0x${"6".repeat(64)}`,
      allowlist: ["0x0000000000000000000000000000000000000001"],
      spendCapRaw: "100000000000000000",
      expiresAt: future,
    },
    termix: {
      pairedTasks: [
        { id: "task-1", track: "trading", outputA: "a", outputB: "b", durationMs: 1000, costRaw: "1", qualityScore: 0.9 },
        { id: "task-2", track: "equity", outputA: "a", outputB: "b", durationMs: 1200, costRaw: "2", qualityScore: 0.8 },
        { id: "task-3", track: "security", outputA: "a", outputB: "b", durationMs: 900, costRaw: "0", qualityScore: 0.95 },
      ],
    },
    pancakeSwap: {
      chainId: 97,
      positionId: "37235",
      metric: "in-range duration",
      reportUrl: "https://example.com/pancake-report.json",
      before: 0.42,
      after: 0.77,
      observedAt: future,
    },
  };
}

test("accepts a complete evidence bundle", () => {
  assert.deepEqual(validatePartnerEvidence(validEvidence()), { ok: true, issues: [] });
});

test("rejects missing category proof and non-testnet chain claims", () => {
  const evidence = validEvidence();
  const categories = evidence.categories as Record<string, unknown>;
  delete categories["grid-trading"];
  evidence.chainId = 56;
  const result = validatePartnerEvidence(evidence);
  assert.equal(result.ok, false);
  assert.ok(result.issues.includes("chainId must be BNB Testnet 97"));
  assert.ok(result.issues.includes("categories.grid-trading is missing"));
});
