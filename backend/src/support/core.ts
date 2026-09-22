export const SUPPORT_SECRET_PATTERNS = [
  /\b(?:seed phrase|private key|admin token|password)\s*[:=]\s*\S+(?:\s+\S+){0,23}/gi,
  /\b0x[a-fA-F0-9]{64}\b/g,
  /\b[A-Za-z0-9_-]{40,}\b/g,
  /\b0x[a-fA-F0-9]{40}\b/g,
];

export function redactSupportMessage(value: string): string {
  return SUPPORT_SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, "[redacted]"), value).slice(0, 4_000);
}

export function needsHumanSupport(value: string): boolean {
  return /\b(human|person|admin|operator|charged|refund|stolen|compromised|private key|seed phrase|security|fraud|unauthorized|legal|verification stuck|stuck for|cannot access|payment failed|paid but)\b/i.test(value);
}
