import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validatePartnerEvidence, type PartnerEvidence } from "../src/shared/marketplace/partner-evidence.ts";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run report:service-comparison -- <path-to-market-evidence.json>");
  process.exit(2);
}

const resolved = resolve(process.cwd(), file);
let parsed: unknown;
try {
  parsed = JSON.parse(readFileSync(resolved, "utf8"));
} catch (error) {
  console.error(`Cannot read evidence: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exit(1);
}

const validation = validatePartnerEvidence(parsed);
if (!validation.ok) {
  console.error(["The evidence record is incomplete:", ...validation.issues.map((issue) => `- ${issue}`)].join("\n"));
  process.exit(1);
}

const evidence = parsed as PartnerEvidence;
const lines = [
  "# AGON Service Comparison Report",
  "",
  `Generated from the validated BNB Testnet evidence record. Chain ID: ${evidence.chainId}.`,
  "",
  "| Task | Category | Agent time | Baseline time | Agent cost | Baseline cost | Agent quality | Baseline quality |",
  "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
];
for (const task of evidence.termix.pairedTasks) {
  lines.push(`| ${task.id} | ${task.track} | ${task.agent.durationMs} ms | ${task.baseline.durationMs} ms | ${task.agent.costRaw} | ${task.baseline.costRaw} | ${task.agent.qualityScore} | ${task.baseline.qualityScore} |`);
}
lines.push("", "## Attached outputs", "");
for (const task of evidence.termix.pairedTasks) {
  lines.push(`- ${task.id}: [agent output](${task.agent.output.url}) (SHA-256 \`${task.agent.output.sha256}\`) · [baseline output](${task.baseline.output.url}) (SHA-256 \`${task.baseline.output.sha256}\`)`);
}
lines.push(
  "",
  "## Paid service record",
  "",
  `Agent ${evidence.paidHire.agentId}, request ${evidence.paidHire.intentId}: [receipt](${evidence.paidHire.receiptUrl}) · [deliverable](${evidence.paidHire.deliverable.url}).`,
  "",
  "## PancakeSwap value observation",
  "",
  `${evidence.pancakeSwap.metric}: ${evidence.pancakeSwap.before} to ${evidence.pancakeSwap.after} ${evidence.pancakeSwap.unit}. [Open report](${evidence.pancakeSwap.report.url}).`,
  "",
);
console.log(lines.join("\n"));
