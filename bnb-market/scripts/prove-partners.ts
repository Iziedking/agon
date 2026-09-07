import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validatePartnerEvidence } from "../src/shared/marketplace/partner-evidence.ts";

const file = process.argv[2];

if (!file) {
  console.error("Usage: npm run prove:partners -- <path-to-evidence.json>");
  process.exit(2);
}

const resolved = resolve(process.cwd(), file);
let parsed: unknown;

try {
  parsed = JSON.parse(readFileSync(resolved, "utf8"));
} catch (error) {
  console.error(JSON.stringify({ status: "invalid", file: resolved, issues: [`cannot read or parse evidence: ${error instanceof Error ? error.message : "unknown error"}`] }, null, 2));
  process.exit(1);
}

const result = validatePartnerEvidence(parsed);
console.log(JSON.stringify({ status: result.ok ? "ready" : "incomplete", file: resolved, issues: result.issues }, null, 2));
process.exit(result.ok ? 0 : 1);
