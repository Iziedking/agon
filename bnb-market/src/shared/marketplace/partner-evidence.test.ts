import assert from "node:assert/strict";
import test from "node:test";
import { validatePartnerEvidence } from "./partner-evidence.ts";

const hash = (digit: string) => `0x${digit.repeat(64)}`;
const digest = (digit: string) => digit.repeat(64);
const artifact = (name: string, digit: string) => ({ url: `https://evidence.example/${name}.json`, sha256: digest(digit) });

function validEvidence(): Record<string, unknown> {
  const observedAt = "2026-09-08T12:00:00.000Z";
  const categories = Object.fromEntries([
    ["rebalancing", "2177"], ["grid-trading", "2231"], ["yield-optimisation", "2237"], ["health-factor", "2238"],
  ].map(([category, agentId], index) => [category, { agentId, versionHash: `sha256:${digest(String(index + 1))}`,
    endpoint: `https://agents.example/${category}`, status: "completed", checkedAt: observedAt, durationMs: 1200,
    result: artifact(category, String(index + 1)) }]));
  const run = (name: string, digit: string, durationMs: number) => ({ durationMs, costRaw: "100000000000000000", qualityScore: 90, output: artifact(name, digit) });
  return {
    version: 2, chainId: 97, categories,
    paidHire: { chainId: 97, agentId: "2177", intentId: "intent-1", createTxHash: hash("1"), registerTxHash: hash("2"),
      approveTxHash: hash("3"), fundTxHash: hash("4"), deliverable: artifact("paid-deliverable", "5"),
      receiptUrl: "https://testnet.bscscan.com/tx/0x1", deliveryTxHash: hash("8"), deliveryStatus: "submitted", deliveredAt: observedAt },
    altana: { chainId: 97, walletAddress: `0x${"1".repeat(40)}`, sessionPublicKey: `0x04${"2".repeat(128)}`,
      sessionCreateTx: hash("5"), sessionExecutionTx: hash("6"), revokeTx: hash("7"),
      explorerUrls: { create: "https://explorer.altana.example/create", execution: "https://explorer.altana.example/execution", revoke: "https://explorer.altana.example/revoke" },
      allowlist: [`0x${"2".repeat(40)}`], spendCapRaw: "100000000000000000", expiresAt: "2026-09-09T12:00:00.000Z",
      revokedAt: "2026-09-08T13:00:00.000Z", status: "revoked" },
    termix: { pairedTasks: [
      { id: "task-1", track: "trading", prompt: "Compare a live grid trading decision.", agent: run("agent-1", "8", 900), baseline: run("baseline-1", "9", 1800) },
      { id: "task-2", track: "other", prompt: "Compare a live yield routing decision.", agent: run("agent-2", "a", 800), baseline: run("baseline-2", "b", 1700) },
      { id: "task-3", track: "security", prompt: "Compare a live health factor assessment.", agent: run("agent-3", "c", 700), baseline: run("baseline-3", "d", 1600) },
    ] },
    pancakeSwap: { chainId: 97, agentId: "2177", positionId: "37235", service: "liquidity", metric: "decision time", unit: "seconds",
      before: 120, after: 20, improvementDirection: "decrease", report: artifact("pancake-report", "e"), observedAt },
  };
}

test("accepts complete, independently inspectable market evidence", () => {
  assert.deepEqual(validatePartnerEvidence(validEvidence()), { ok: true, issues: [] });
});

test("rejects discovery-only categories and incomplete paired comparisons", () => {
  const evidence = validEvidence();
  const categories = evidence.categories as Record<string, Record<string, unknown>>;
  categories["grid-trading"].status = "reachable";
  const termix = evidence.termix as { pairedTasks: Array<Record<string, unknown>> };
  delete termix.pairedTasks[0].baseline;
  const result = validatePartnerEvidence(evidence);
  assert.equal(result.ok, false);
  assert.ok(result.issues.includes("categories.grid-trading.status must be completed"));
  assert.ok(result.issues.includes("termix.pairedTasks.0.baseline is required"));
});

test("rejects an Altana revoke after expiry and an unimproved PancakeSwap result", () => {
  const evidence = validEvidence();
  (evidence.altana as Record<string, unknown>).revokedAt = "2026-09-10T12:00:00.000Z";
  (evidence.pancakeSwap as Record<string, unknown>).after = 130;
  const result = validatePartnerEvidence(evidence);
  assert.equal(result.ok, false);
  assert.ok(result.issues.includes("altana.revokedAt must be before session expiry"));
  assert.ok(result.issues.includes("pancakeSwap.after must improve on before"));
});
