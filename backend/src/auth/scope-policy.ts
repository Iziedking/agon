export type ScopeClaims = {
  client: string | null;
  scopes: string[];
};

/** Browser sessions remain compatible; only explicitly scoped CLI tokens are restricted. */
export function canUseAgonScope(claims: ScopeClaims, requiredScope: string): boolean {
  return claims.client !== "agon-cli" || claims.scopes.includes(requiredScope);
}
