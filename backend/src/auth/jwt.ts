import { SignJWT, jwtVerify } from "jose";
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { config } from "../config/index.js";
import { canUseAgonScope } from "./scope-policy.js";

const secret = new TextEncoder().encode(config.auth.jwtSecret);
const ALG = "HS256";

/// Name of the httpOnly session cookie set on /auth/wallet/verify and cleared on
/// /auth/logout. The session must not live in localStorage where XSS can
/// lift it.
export const SESSION_COOKIE = "arcrun_session";

export type AgonAuthClaims = {
  address: string;
  client: string | null;
  scopes: string[];
};

/// Issues a 7-day session token whose subject is the operator's wallet address.
export async function issueToken(
  address: string,
  claims: { client?: string; scopes?: string[] } = {},
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: ALG })
    .setSubject(address.toLowerCase())
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

export async function verifyToken(token: string): Promise<string | null> {
  const claims = await verifyTokenClaims(token);
  return claims?.address ?? null;
}

export async function verifyTokenClaims(token: string): Promise<AgonAuthClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: [ALG] });
    if (typeof payload.sub !== "string") return null;
    const rawScopes = payload.scopes;
    return {
      address: payload.sub,
      client: typeof payload.client === "string" ? payload.client : null,
      scopes: Array.isArray(rawScopes) ? rawScopes.filter((scope): scope is string => typeof scope === "string") : [],
    };
  } catch {
    return null;
  }
}

function tokenFromRequest(c: Parameters<MiddlewareHandler>[0]): string {
  const cookieToken = getCookie(c, SESSION_COOKIE) ?? "";
  const header = c.req.header("authorization") ?? "";
  const headerToken = header.startsWith("Bearer ") ? header.slice(7) : "";
  return cookieToken || headerToken;
}

/// Hono middleware: requires a valid session. Reads the httpOnly session cookie
/// first (the normal browser flow), then falls back to a Bearer header for any
/// non-browser caller. Exposes the address as `c.get("address")`.
export const requireAuth: MiddlewareHandler<{ Variables: { address: string } }> = async (c, next) => {
  const claims = await verifyTokenClaims(tokenFromRequest(c));
  if (!claims) return c.json({ error: "unauthorized" }, 401);
  c.set("address", claims.address);
  await next();
};

/**
 * Enforces a capability only for CLI device tokens. Browser sessions remain
 * backward-compatible and the admin-token middleware remains an explicit
 * operator bypass. This keeps least privilege local to the token type that
 * needs it instead of turning every existing browser session into a scope
 * migration.
 */
export function requireAgonScope(scope: string): MiddlewareHandler<{ Variables: { address: string } }> {
  return async (c, next) => {
    const claims = await verifyTokenClaims(tokenFromRequest(c));
    if (!claims) return c.json({ error: "unauthorized" }, 401);
    if (!canUseAgonScope(claims, scope)) {
      return c.json({ error: "scope_required", scope }, 403);
    }
    c.set("address", claims.address);
    await next();
  };
}
