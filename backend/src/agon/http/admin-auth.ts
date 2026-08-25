import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

type AuthVariables = { Variables: { address: string } };

function secretMatches(received: string, expected: string): boolean {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/// Allows the isolated operator console to use its in-memory ADMIN_TOKEN while
/// retaining the exact actor wallet on every Agon request. A normal SIWE or
/// bearer session remains the fallback for the public provider workflow.
export function createAgonAuthMiddleware(
  adminToken: string | undefined,
  fallback: MiddlewareHandler<AuthVariables>,
): MiddlewareHandler<AuthVariables> {
  return async (context, next) => {
    const received = context.req.header("x-admin-token") ?? "";
    if (adminToken && received && secretMatches(received, adminToken)) {
      const actor = context.req.header("x-agon-actor") ?? "";
      if (!/^0x[a-fA-F0-9]{40}$/.test(actor)) {
        return context.json({ error: "valid x-agon-actor wallet address required" }, 400);
      }
      context.set("address", actor.toLowerCase());
      await next();
      return;
    }
    return fallback(context, next);
  };
}
