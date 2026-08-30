export const AGON_AUTHORITIES = ["user_wallet", "agent_wallet", "certifier_wallet", "resolver", "treasury"] as const;
export type AgonAuthority = typeof AGON_AUTHORITIES[number];

export const AGON_AUTHORITY_ACTIONS = ["bind_identity", "publish_listing", "invoke_service", "certify_listing", "resolve_dispute", "receive_fee"] as const;
export type AgonAuthorityAction = typeof AGON_AUTHORITY_ACTIONS[number];

const AUTHORITY_MATRIX: Record<AgonAuthority, readonly AgonAuthorityAction[]> = {
  user_wallet: ["bind_identity", "publish_listing", "invoke_service"],
  agent_wallet: ["invoke_service"],
  certifier_wallet: ["certify_listing"],
  resolver: ["resolve_dispute"],
  treasury: ["receive_fee"],
};

export function authorityCanPerform(authority: AgonAuthority, action: AgonAuthorityAction): boolean {
  return AUTHORITY_MATRIX[authority].includes(action);
}

export function authoritiesFor(action: AgonAuthorityAction): AgonAuthority[] {
  return AGON_AUTHORITIES.filter((authority) => authorityCanPerform(authority, action));
}
