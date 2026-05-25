import { createSiweMessage } from "viem/siwe";
import { arcTestnet } from "./arc";

/// Client for the ArcRun auth service. Runs the SIWE flow (shared by both the
/// web3 wallet and the Circle Modular passkey login) and stores the session JWT.

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";
const TOKEN_KEY = "arcrun_jwt";

export async function fetchNonce(address: string): Promise<string> {
  const res = await fetch(`${AUTH_URL}/auth/wallet/nonce`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address }),
  });
  if (!res.ok) throw new Error("could not get a login nonce");
  return (await res.json()).nonce as string;
}

export function buildSiweMessage(address: `0x${string}`, nonce: string): string {
  return createSiweMessage({
    domain: window.location.host,
    address,
    statement: "Sign in to ArcRun",
    uri: window.location.origin,
    version: "1",
    chainId: arcTestnet.id,
    nonce,
  });
}

export async function verifySiwe(
  message: string,
  signature: `0x${string}`,
): Promise<{ token: string; address: string }> {
  const res = await fetch(`${AUTH_URL}/auth/wallet/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, signature }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "signature verification failed");
  }
  return res.json();
}

export interface Me {
  address: string;
  x_handle: string | null;
  current_syndicate_id: string | null;
  canEnterContests: boolean;
}

export async function fetchMe(token: string): Promise<Me> {
  const res = await fetch(`${AUTH_URL}/auth/me`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("unauthorized");
  return res.json();
}

export const tokenStore = {
  get: () => (typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

/// Runs the full SIWE login with any signer (a web3 wallet or a Circle smart
/// account) and stores the session token. The signer just needs to turn the
/// SIWE message into a signature.
export async function loginWithSigner(
  address: `0x${string}`,
  signMessage: (message: string) => Promise<`0x${string}`>,
): Promise<void> {
  const nonce = await fetchNonce(address);
  const message = buildSiweMessage(address, nonce);
  const signature = await signMessage(message);
  const { token } = await verifySiwe(message, signature);
  tokenStore.set(token);
}
