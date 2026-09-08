export const PARTNER_EVIDENCE_VERSION = 2 as const;

export type EvidenceArtifact = { url: string; sha256: string };
export type ComparisonRun = { durationMs: number; costRaw: string; qualityScore: number; output: EvidenceArtifact };

export type PartnerEvidence = {
  version: 2;
  chainId: 97;
  categories: Record<string, {
    agentId: string; versionHash: string; endpoint: string; status: "completed";
    checkedAt: string; durationMs: number; result: EvidenceArtifact;
  }>;
  paidHire: {
    chainId: 97; agentId: string; intentId: string;
    createTxHash: string; registerTxHash: string; approveTxHash: string; fundTxHash: string;
    deliverable: EvidenceArtifact; receiptUrl: string; deliveryTxHash: string;
    deliveryStatus: "submitted" | "completed"; deliveredAt: string;
  };
  altana: {
    chainId: 97; walletAddress: string; sessionPublicKey: string;
    sessionCreateTx: string; sessionExecutionTx: string; revokeTx: string;
    explorerUrls: { create: string; execution: string; revoke: string };
    allowlist: string[]; spendCapRaw: string; expiresAt: string; revokedAt: string; status: "revoked";
  };
  termix: {
    pairedTasks: Array<{
      id: string; track: "trading" | "equity" | "security" | "other"; prompt: string;
      agent: ComparisonRun; baseline: ComparisonRun;
    }>;
  };
  pancakeSwap: {
    chainId: 97; agentId: string; positionId: string; service: "liquidity" | "trading";
    metric: string; unit: string; before: number; after: number;
    improvementDirection: "increase" | "decrease"; report: EvidenceArtifact; observedAt: string;
  };
};

export type PartnerEvidenceResult = { ok: boolean; issues: string[] };

const REQUIRED_CATEGORIES = ["rebalancing", "grid-trading", "yield-optimisation", "health-factor"] as const;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const SHA_PATTERN = /^(?:sha256:)?[0-9a-fA-F]{64}$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const PUBLIC_KEY_PATTERN = /^0x[0-9a-fA-F]{66,130}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length <= 12) return false;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

const isHash = (value: unknown): value is string => typeof value === "string" && HASH_PATTERN.test(value);
const isSha = (value: unknown): value is string => typeof value === "string" && SHA_PATTERN.test(value);
const isPositiveInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0;
const isNonNegativeBigintString = (value: unknown): value is string => typeof value === "string" && /^\d+$/.test(value);
const isPositiveBigintString = (value: unknown): value is string => isNonNegativeBigintString(value) && BigInt(value) > 0n;

function validateArtifact(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) { issues.push(`${path} is required`); return; }
  if (!isHttpsUrl(value.url)) issues.push(`${path}.url must be HTTPS`);
  if (!isSha(value.sha256)) issues.push(`${path}.sha256 must be a SHA-256 digest`);
}

function validateRun(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) { issues.push(`${path} is required`); return; }
  if (!isPositiveInteger(value.durationMs)) issues.push(`${path}.durationMs must be positive`);
  if (!isNonNegativeBigintString(value.costRaw)) issues.push(`${path}.costRaw must be a non-negative integer string`);
  if (typeof value.qualityScore !== "number" || !Number.isFinite(value.qualityScore) || value.qualityScore < 0 || value.qualityScore > 100) {
    issues.push(`${path}.qualityScore must be between 0 and 100`);
  }
  validateArtifact(value.output, `${path}.output`, issues);
}

export function validatePartnerEvidence(value: unknown): PartnerEvidenceResult {
  const issues: string[] = [];
  if (!isRecord(value)) return { ok: false, issues: ["evidence must be a JSON object"] };
  if (value.version !== PARTNER_EVIDENCE_VERSION) issues.push("version must be 2");
  if (value.chainId !== 97) issues.push("chainId must be BNB Testnet 97");

  const categories = value.categories;
  if (!isRecord(categories)) issues.push("categories must be an object");
  else for (const category of REQUIRED_CATEGORIES) {
    const entry = categories[category];
    if (!isRecord(entry)) { issues.push(`categories.${category} is missing`); continue; }
    if (typeof entry.agentId !== "string" || !/^\d+$/.test(entry.agentId)) issues.push(`categories.${category}.agentId must be an onchain agent ID`);
    if (!isSha(entry.versionHash)) issues.push(`categories.${category}.versionHash must be a version digest`);
    if (!isHttpsUrl(entry.endpoint)) issues.push(`categories.${category}.endpoint must be HTTPS`);
    if (entry.status !== "completed") issues.push(`categories.${category}.status must be completed`);
    if (!isIsoDate(entry.checkedAt)) issues.push(`categories.${category}.checkedAt must be an ISO timestamp`);
    if (!isPositiveInteger(entry.durationMs)) issues.push(`categories.${category}.durationMs must be positive`);
    validateArtifact(entry.result, `categories.${category}.result`, issues);
  }

  const paidHire = value.paidHire;
  if (!isRecord(paidHire)) issues.push("paidHire is required");
  else {
    if (paidHire.chainId !== 97) issues.push("paidHire.chainId must be 97");
    if (typeof paidHire.agentId !== "string" || !/^\d+$/.test(paidHire.agentId)) issues.push("paidHire.agentId must be an onchain agent ID");
    if (typeof paidHire.intentId !== "string" || paidHire.intentId.length === 0) issues.push("paidHire.intentId is required");
    for (const field of ["createTxHash", "registerTxHash", "approveTxHash", "fundTxHash"] as const) {
      if (!isHash(paidHire[field])) issues.push(`paidHire.${field} must be a transaction hash`);
    }
    validateArtifact(paidHire.deliverable, "paidHire.deliverable", issues);
    if (!isHttpsUrl(paidHire.receiptUrl)) issues.push("paidHire.receiptUrl must be HTTPS");
    if (!isHash(paidHire.deliveryTxHash)) issues.push("paidHire.deliveryTxHash must be a transaction hash");
    if (paidHire.deliveryStatus !== "submitted" && paidHire.deliveryStatus !== "completed") issues.push("paidHire.deliveryStatus is invalid");
    if (!isIsoDate(paidHire.deliveredAt)) issues.push("paidHire.deliveredAt must be an ISO timestamp");
  }

  const altana = value.altana;
  if (!isRecord(altana)) issues.push("altana is required");
  else {
    if (altana.chainId !== 97) issues.push("altana.chainId must be 97");
    if (typeof altana.walletAddress !== "string" || !ADDRESS_PATTERN.test(altana.walletAddress)) issues.push("altana.walletAddress must be an EVM address");
    if (typeof altana.sessionPublicKey !== "string" || !PUBLIC_KEY_PATTERN.test(altana.sessionPublicKey)) issues.push("altana.sessionPublicKey must be a public session key");
    for (const field of ["sessionCreateTx", "sessionExecutionTx", "revokeTx"] as const) {
      if (!isHash(altana[field])) issues.push(`altana.${field} must be a transaction hash`);
    }
    if (!isRecord(altana.explorerUrls)) issues.push("altana.explorerUrls is required");
    else for (const field of ["create", "execution", "revoke"] as const) {
      if (!isHttpsUrl(altana.explorerUrls[field])) issues.push(`altana.explorerUrls.${field} must be HTTPS`);
    }
    if (!Array.isArray(altana.allowlist) || altana.allowlist.length === 0 || altana.allowlist.some((item) => typeof item !== "string" || !ADDRESS_PATTERN.test(item))) {
      issues.push("altana.allowlist must contain at least one EVM address");
    }
    if (!isPositiveBigintString(altana.spendCapRaw)) issues.push("altana.spendCapRaw must be a positive integer string");
    if (!isIsoDate(altana.expiresAt)) issues.push("altana.expiresAt must be an ISO timestamp");
    if (!isIsoDate(altana.revokedAt)) issues.push("altana.revokedAt must be an ISO timestamp");
    if (isIsoDate(altana.expiresAt) && isIsoDate(altana.revokedAt) && Date.parse(altana.revokedAt) >= Date.parse(altana.expiresAt)) {
      issues.push("altana.revokedAt must be before session expiry");
    }
    if (altana.status !== "revoked") issues.push("altana.status must be revoked");
  }

  const termix = value.termix;
  if (!isRecord(termix) || !Array.isArray(termix.pairedTasks) || termix.pairedTasks.length !== 3) {
    issues.push("termix.pairedTasks must contain exactly three tasks");
  } else {
    const tracks = new Set<string>();
    const ids = new Set<string>();
    termix.pairedTasks.forEach((task, index) => {
      const path = `termix.pairedTasks.${index}`;
      if (!isRecord(task)) { issues.push(`${path} must be an object`); return; }
      if (typeof task.id !== "string" || task.id.length === 0) issues.push(`${path}.id is required`);
      else if (ids.has(task.id)) issues.push(`${path}.id must be unique`); else ids.add(task.id);
      if (!["trading", "equity", "security", "other"].includes(String(task.track))) issues.push(`${path}.track is invalid`);
      else tracks.add(String(task.track));
      if (typeof task.prompt !== "string" || task.prompt.trim().length < 10) issues.push(`${path}.prompt must describe the shared task`);
      validateRun(task.agent, `${path}.agent`, issues);
      validateRun(task.baseline, `${path}.baseline`, issues);
    });
    if (!["trading", "equity", "security"].some((track) => tracks.has(track))) issues.push("termix must include a trading, equity, or security task");
  }

  const pancakeSwap = value.pancakeSwap;
  if (!isRecord(pancakeSwap)) issues.push("pancakeSwap is required");
  else {
    if (pancakeSwap.chainId !== 97) issues.push("pancakeSwap.chainId must be 97");
    if (typeof pancakeSwap.agentId !== "string" || !/^\d+$/.test(pancakeSwap.agentId)) issues.push("pancakeSwap.agentId must be an onchain agent ID");
    if (typeof pancakeSwap.positionId !== "string" || pancakeSwap.positionId.length === 0) issues.push("pancakeSwap.positionId is required");
    if (pancakeSwap.service !== "liquidity" && pancakeSwap.service !== "trading") issues.push("pancakeSwap.service must be liquidity or trading");
    if (typeof pancakeSwap.metric !== "string" || pancakeSwap.metric.trim().length < 3) issues.push("pancakeSwap.metric is required");
    if (typeof pancakeSwap.unit !== "string" || pancakeSwap.unit.trim().length === 0) issues.push("pancakeSwap.unit is required");
    if (typeof pancakeSwap.before !== "number" || !Number.isFinite(pancakeSwap.before)) issues.push("pancakeSwap.before must be finite");
    if (typeof pancakeSwap.after !== "number" || !Number.isFinite(pancakeSwap.after)) issues.push("pancakeSwap.after must be finite");
    if (pancakeSwap.improvementDirection !== "increase" && pancakeSwap.improvementDirection !== "decrease") issues.push("pancakeSwap.improvementDirection is invalid");
    if (typeof pancakeSwap.before === "number" && typeof pancakeSwap.after === "number" && Number.isFinite(pancakeSwap.before) && Number.isFinite(pancakeSwap.after)) {
      if (pancakeSwap.improvementDirection === "increase" && pancakeSwap.after <= pancakeSwap.before) issues.push("pancakeSwap.after must improve on before");
      if (pancakeSwap.improvementDirection === "decrease" && pancakeSwap.after >= pancakeSwap.before) issues.push("pancakeSwap.after must improve on before");
    }
    validateArtifact(pancakeSwap.report, "pancakeSwap.report", issues);
    if (!isIsoDate(pancakeSwap.observedAt)) issues.push("pancakeSwap.observedAt must be an ISO timestamp");
  }
  return { ok: issues.length === 0, issues };
}
