const signatures = new Map<string, `0x${string}`>();

/** Keep a wallet signature only in the current tab's memory for the verify step. */
export function rememberX402Signature(intentId: string, signature: `0x${string}`): void {
  signatures.set(intentId, signature);
}

export function readX402Signature(intentId: string): `0x${string}` | null {
  return signatures.get(intentId) ?? null;
}

export function forgetX402Signature(intentId: string): void {
  signatures.delete(intentId);
}
