export const PARTNER_EVIDENCE_VERSION = 1 as const;

export type PartnerEvidence = {
  version: 1;
  chainId: 97;
  categories: Record<string, {
    agentId: string;
    endpoint: string;
    status: "reachable";
    checkedAt: string;
  }>;
  paidHire: {
    chainId: 97;
    agentId: string;
    intentId: string;
    createTxHash: string;
    registerTxHash: string;
    approveTxHash: string;
    fundTxHash: string;
    deliverableUrl: string;
    receiptUrl: string;
    deliveryStatus: "submitted" | "completed";
  };
  altana: {
    chainId: 97;
    sessionCreateTx: string;
    revokeTx: string;
    allowlist: string[];
    spendCapRaw: string;
    expiresAt: string;
  };
  termix: {
    pairedTasks: Array<{
      id: string;
      track: "trading" | "equity" | "security" | "other";
      outputA: string;
      outputB: string;
      durationMs: number;
      costRaw: string;
      qualityScore: number;
    }>;
  };
  pancakeSwap: {
    chainId: 97;
    positionId: string;
    metric: string;
    reportUrl: string;
    before: number;
    after: number;
    observedAt: string;
  };
};

export type PartnerEvidenceResult = {
  ok: boolean;
  issues: string[];
};

const REQUIRED_CATEGORIES = [
  "rebalancing",
  "grid-trading",
  "yield-optimisation",
  "health-factor",
] as const;

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHttpsUrl(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("https://") && value.length > 12;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveBigintString(value: unknown): value is string {
  return typeof value === "string" && /^\d+$/.test(value) && BigInt(value) > 0n;
}

export function validatePartnerEvidence(value: unknown): PartnerEvidenceResult {
  const issues: string[] = [];
  if (!isRecord(value)) return { ok: false, issues: ["evidence must be a JSON object"] };

  if (value.version !== PARTNER_EVIDENCE_VERSION) issues.push("version must be 1");
  if (value.chainId !== 97) issues.push("chainId must be BNB Testnet 97");

  const categories = value.categories;
  if (!isRecord(categories)) {
    issues.push("categories must be an object");
  } else {
    for (const category of REQUIRED_CATEGORIES) {
      const entry = categories[category];
      if (!isRecord(entry)) {
        issues.push(`categories.${category} is missing`);
        continue;
      }
      if (typeof entry.agentId !== "string" || entry.agentId.length === 0) issues.push(`categories.${category}.agentId is required`);
      if (!isHttpsUrl(entry.endpoint)) issues.push(`categories.${category}.endpoint must be HTTPS`);
      if (entry.status !== "reachable") issues.push(`categories.${category}.status must be reachable`);
      if (!isIsoDate(entry.checkedAt)) issues.push(`categories.${category}.checkedAt must be an ISO timestamp`);
    }
  }

  const paidHire = value.paidHire;
  if (!isRecord(paidHire)) {
    issues.push("paidHire is required");
  } else {
    if (paidHire.chainId !== 97) issues.push("paidHire.chainId must be 97");
    if (typeof paidHire.agentId !== "string" || paidHire.agentId.length === 0) issues.push("paidHire.agentId is required");
    if (typeof paidHire.intentId !== "string" || paidHire.intentId.length === 0) issues.push("paidHire.intentId is required");
    for (const field of ["createTxHash", "registerTxHash", "approveTxHash", "fundTxHash"] as const) {
      if (!isHash(paidHire[field])) issues.push(`paidHire.${field} must be a transaction hash`);
    }
    if (!isHttpsUrl(paidHire.deliverableUrl)) issues.push("paidHire.deliverableUrl must be HTTPS");
    if (!isHttpsUrl(paidHire.receiptUrl)) issues.push("paidHire.receiptUrl must be HTTPS");
    if (paidHire.deliveryStatus !== "submitted" && paidHire.deliveryStatus !== "completed") issues.push("paidHire.deliveryStatus is invalid");
  }

  const altana = value.altana;
  if (!isRecord(altana)) {
    issues.push("altana is required");
  } else {
    if (altana.chainId !== 97) issues.push("altana.chainId must be 97");
    if (!isHash(altana.sessionCreateTx)) issues.push("altana.sessionCreateTx must be a transaction hash");
    if (!isHash(altana.revokeTx)) issues.push("altana.revokeTx must be a transaction hash");
    if (!Array.isArray(altana.allowlist) || altana.allowlist.length === 0 || altana.allowlist.some((item) => typeof item !== "string" || !ADDRESS_PATTERN.test(item))) issues.push("altana.allowlist must contain at least one EVM address");
    if (!isPositiveBigintString(altana.spendCapRaw)) issues.push("altana.spendCapRaw must be a positive integer string");
    if (!isIsoDate(altana.expiresAt) || Date.parse(altana.expiresAt) <= Date.now()) issues.push("altana.expiresAt must be a future ISO timestamp");
  }

  const termix = value.termix;
  if (!isRecord(termix) || !Array.isArray(termix.pairedTasks) || termix.pairedTasks.length !== 3) {
    issues.push("termix.pairedTasks must contain exactly three tasks");
  } else {
    const tracks = new Set<string>();
    termix.pairedTasks.forEach((task, index) => {
      if (!isRecord(task)) {
        issues.push(`termix.pairedTasks.${index} must be an object`);
        return;
      }
      if (typeof task.id !== "string" || task.id.length === 0) issues.push(`termix.pairedTasks.${index}.id is required`);
      if (typeof task.track !== "string") issues.push(`termix.pairedTasks.${index}.track is required`);
      else tracks.add(task.track);
      if (typeof task.outputA !== "string" || task.outputA.length === 0) issues.push(`termix.pairedTasks.${index}.outputA is required`);
      if (typeof task.outputB !== "string" || task.outputB.length === 0) issues.push(`termix.pairedTasks.${index}.outputB is required`);
      if (!isPositiveInteger(task.durationMs)) issues.push(`termix.pairedTasks.${index}.durationMs must be positive`);
      if (!isNonNegativeInteger(task.costRaw) && !(typeof task.costRaw === "string" && /^\d+$/.test(task.costRaw))) issues.push(`termix.pairedTasks.${index}.costRaw must be a non-negative integer string`);
      if (typeof task.qualityScore !== "number" || !Number.isFinite(task.qualityScore) || task.qualityScore <= 0) issues.push(`termix.pairedTasks.${index}.qualityScore must be positive`);
    });
    if (!["trading", "equity", "security"].some((track) => tracks.has(track))) issues.push("termix must include a trading, equity, or security task");
  }

  const pancakeSwap = value.pancakeSwap;
  if (!isRecord(pancakeSwap)) {
    issues.push("pancakeSwap is required");
  } else {
    if (pancakeSwap.chainId !== 97) issues.push("pancakeSwap.chainId must be 97");
    if (typeof pancakeSwap.positionId !== "string" || pancakeSwap.positionId.length === 0) issues.push("pancakeSwap.positionId is required");
    if (typeof pancakeSwap.metric !== "string" || pancakeSwap.metric.length === 0) issues.push("pancakeSwap.metric is required");
    if (!isHttpsUrl(pancakeSwap.reportUrl)) issues.push("pancakeSwap.reportUrl must be HTTPS");
    if (typeof pancakeSwap.before !== "number" || !Number.isFinite(pancakeSwap.before)) issues.push("pancakeSwap.before must be finite");
    if (typeof pancakeSwap.after !== "number" || !Number.isFinite(pancakeSwap.after)) issues.push("pancakeSwap.after must be finite");
    if (!isIsoDate(pancakeSwap.observedAt)) issues.push("pancakeSwap.observedAt must be an ISO timestamp");
  }

  return { ok: issues.length === 0, issues };
}
