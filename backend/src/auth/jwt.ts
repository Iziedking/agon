import { SignJWT, jwtVerify } from "jose";
import type { MiddlewareHandler } from "hono";
import { config } from "../config/index.js";

const secret = new TextEncoder().encode(config.auth.jwtSecret);
const ALG = "HS256";

/// Issues a 7-day session token whose subject is the operator's wallet address.
export async function issueToken(address: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: ALG })
    .setSubject(address.toLowerCase())
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

export async function verifyToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: [ALG] });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/// Hono middleware: requires a valid bearer token and exposes the address as
/// `c.get("address")`.
export const requireAuth: MiddlewareHandler<{ Variables: { address: string } }> = async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const address = token ? await verifyToken(token) : null;
  if (!address) return c.json({ error: "unauthorized" }, 401);
  c.set("address", address);
  await next();
};
