// Pure refusal rules shared by API reads and the offline verification suite.
export function exactTokenAmount(value: unknown): string | null {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(value)) return null;
  return BigInt(value) < 2n ** 256n ? value : null;
}
export type ContractHealth = {
  codePresent: boolean; bindingsMatch: boolean; whitelisted: boolean;
  paused: boolean; tokenMatches: boolean; disputeWindow: string; quorum: number; voters: number;
};
export function contractBlockers(health: ContractHealth): string[] {
  const reasons: string[] = [];
  if (!health.codePresent) reasons.push("deployment_code_missing");
  if (!health.bindingsMatch) reasons.push("deployment_binding_mismatch");
  if (!health.whitelisted) reasons.push("policy_not_whitelisted");
  if (health.paused) reasons.push("commerce_paused");
  if (!health.tokenMatches) reasons.push("payment_token_mismatch");
  if (!exactTokenAmount(health.disputeWindow) || BigInt(health.disputeWindow) === 0n) reasons.push("invalid_dispute_window");
  if (!Number.isSafeInteger(health.quorum) || health.quorum < 1 || !Number.isSafeInteger(health.voters) || health.voters < health.quorum) reasons.push("policy_quorum_unavailable");
  return reasons;
}
export const sameAddress = (value: unknown, expected: string) => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value) && value.toLowerCase() === expected.toLowerCase();
export function providerBlockers(card: Record<string, unknown>, expected: { commerce: string; router: string; policy: string; token: string; wallet: string }, whitelisted: boolean): string[] {
  const reasons: string[] = [];
  if (card.status !== "ok") reasons.push("provider_unavailable");
  if (!sameAddress(card.agent_address, expected.wallet)) reasons.push("provider_wallet_mismatch");
  if (!sameAddress(card.commerce_address, expected.commerce)) reasons.push("provider_commerce_mismatch");
  if (!sameAddress(card.router_address, expected.router)) reasons.push("provider_router_mismatch");
  if (!sameAddress(card.policy_address, expected.policy)) reasons.push("provider_policy_mismatch");
  if (!sameAddress(card.payment_token, expected.token)) reasons.push("provider_token_mismatch");
  if (!whitelisted) reasons.push("provider_policy_not_whitelisted");
  return reasons;
}
export function jobState(status: number) {
  switch (status) {
    case 0: return "open";
    case 1: return "funded";
    case 2: return "submitted";
    case 3: return "completed";
    case 4: return "rejected";
    case 5: return "expired";
    default: throw new Error("Unknown commerce job state.");
  }
}
export function receiptJobId(events: { address: string; jobId: bigint }[], commerce: string): string {
  const ids = new Set(events.filter((event) => sameAddress(event.address, commerce)).map((event) => event.jobId.toString()));
  if (ids.size !== 1) throw new Error("Receipt must identify exactly one job from the selected commerce contract.");
  return [...ids][0];
}
