import type { MiddlewareHandler } from "hono";

type AgonPrincipalVariables = { Variables: { address: string } };

export type AgonPrincipalResolver = (
  operatorAddress: string,
  requestedAddress: string,
) => Promise<boolean>;

/**
 * Selects the exact wallet that will sign an Agon write, but only after the
 * authenticated operator proves that wallet is one of its active principals.
 * No header can impersonate an arbitrary wallet because the resolver remains
 * authoritative and fails closed.
 */
export function createAgonPrincipalMiddleware(
  resolvePrincipal: AgonPrincipalResolver,
): MiddlewareHandler<AgonPrincipalVariables> {
  return async (context, next) => {
    const requested = context.req.header("x-agon-principal")?.trim().toLowerCase();
    if (!requested) {
      await next();
      return;
    }
    if (!/^0x[0-9a-f]{40}$/.test(requested)) {
      return context.json({ error: "valid x-agon-principal wallet address required" }, 400);
    }
    const operator = context.get("address").toLowerCase();
    if (requested !== operator) {
      try {
        if (!(await resolvePrincipal(operator, requested))) {
          return context.json({ error: "wallet principal is not linked to this operator" }, 403);
        }
      } catch {
        return context.json({ error: "wallet principal could not be verified" }, 503);
      }
    }
    context.set("address", requested);
    await next();
  };
}
