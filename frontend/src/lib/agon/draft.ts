import { categoryById } from "./catalog.ts";

export type ServiceDraft = {
  agentId: string;
  name: string;
  description: string;
  categoryId: string;
  serviceKey: string;
  endpoint: string;
  tags: string;
  amountUSDC: string;
};

export type DraftIssue = {
  field: keyof ServiceDraft;
  message: string;
};

export function parseTags(value: string): string[] {
  return [...new Set(value.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
}

function isPublicHttps(value: string): boolean {
  try {
    const endpoint = new URL(value);
    if (endpoint.protocol !== "https:") return false;
    const hostname = endpoint.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (hostname === "localhost" || hostname.endsWith(".local") || hostname === "::1") return false;
    if (/^(fc|fd|fe8|fe9|fea|feb)/.test(hostname)) return false;
    const octets = hostname.split(".").map(Number);
    if (octets.length === 4 && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)) {
      const [first = 0, second = 0] = octets;
      if (first === 0 || first === 10 || first === 127 || first >= 224) return false;
      if (first === 169 && second === 254) return false;
      if (first === 172 && second >= 16 && second <= 31) return false;
      if (first === 192 && second === 168) return false;
      if (first === 100 && second >= 64 && second <= 127) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function validateServiceDraft(draft: ServiceDraft): DraftIssue[] {
  const issues: DraftIssue[] = [];
  if (!/^[1-9]\d*$/.test(draft.agentId.trim())) {
    issues.push({ field: "agentId", message: "Enter the ERC-8004 agent you own." });
  }
  if (!draft.name.trim()) issues.push({ field: "name", message: "Give the service a clear name." });
  if (!draft.description.trim()) issues.push({ field: "description", message: "Explain the result a buyer receives." });
  if (categoryById(draft.categoryId).slug === "other") {
    issues.push({ field: "categoryId", message: "Choose one of the marketplace categories." });
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.serviceKey.trim())) {
    issues.push({ field: "serviceKey", message: "Use lowercase words separated by hyphens." });
  }
  if (!isPublicHttps(draft.endpoint.trim())) {
    issues.push({ field: "endpoint", message: "Service endpoint must be a public HTTPS URL." });
  }
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(draft.amountUSDC.trim())) {
    issues.push({ field: "amountUSDC", message: "Enter a USDC amount with up to 6 decimal places." });
  }
  if (parseTags(draft.tags).length > 8) {
    issues.push({ field: "tags", message: "Use no more than 8 search tags." });
  }
  return issues;
}

export function buildServiceManifest(draft: ServiceDraft) {
  const category = categoryById(draft.categoryId);
  if (category.slug === "other") throw new Error("category is outside the marketplace registry");
  return {
    name: draft.name.trim(),
    version: 1,
    description: draft.description.trim(),
    category: category.slug,
    endpoint: draft.endpoint.trim(),
    tags: parseTags(draft.tags),
    pricing: { rail: "x402", amountUSDC: draft.amountUSDC.trim() },
  };
}
