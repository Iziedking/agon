import { createSiweMessage } from "viem/siwe";
import { arcTestnet } from "./arc";

/// Client for the ArcRun auth service. Runs the SIWE flow (shared by the web3
/// wallet and the Circle Modular passkey login) and lets the backend persist
/// the session in an httpOnly cookie. The frontend never reads the token, so
/// XSS cannot lift it. Per the `circle:use-modular-wallets` skill, the session
/// must not live in localStorage.

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";
const LEGACY_TOKEN_KEY = "arcrun_jwt"; // pre-cookie storage, cleaned up on first read

export async function fetchNonce(address: string): Promise<string> {
  const res = await fetch(`${AUTH_URL}/auth/wallet/nonce`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
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

/// Verify the SIWE signature with the auth service. On success the backend
/// sets the httpOnly session cookie; the response body is ignored.
export async function verifySiwe(message: string, signature: `0x${string}`): Promise<void> {
  const res = await fetch(`${AUTH_URL}/auth/wallet/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ message, signature }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "signature verification failed");
  }
}

export interface Me {
  address: string;
  x_handle: string | null;
  current_syndicate_id: string | null;
  email?: string | null;
  /// "circle" for email-login users whose writes go through POST /wallet/execute,
  /// "wagmi" for users who connected an injected wallet and sign client-side.
  walletKind?: "circle" | "wagmi";
  /// True when this operator has at least one WebAuthn credential enrolled.
  /// Drives the "ADD A PASSKEY" vs "PASSKEY ENABLED" affordance in settings.
  hasPasskey?: boolean;
  canEnterContests: boolean;
}

/// Reads the current session from the auth service via the httpOnly cookie.
/// Returns null when there is no valid session (logged out or expired).
export async function fetchMe(): Promise<Me | null> {
  try {
    const res = await fetch(`${AUTH_URL}/auth/me`, { credentials: "include" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/// Email + passkey sign-in. The backend decides whether the email needs a
/// fresh passkey ("register") or can authenticate with an existing one
/// ("login") and returns the matching WebAuthn challenge. The browser runs
/// the ceremony with the user's authenticator (Touch ID, Windows Hello,
/// security key, etc.) and POSTs the result back. On success the backend
/// either mints + seeds a fresh Circle Developer-Controlled wallet or
/// resumes the existing one, then sets the session cookie. No password,
/// no emailed code, no seed phrase. The wallet is custodial (Circle signs
/// every tx) but the auth is non-custodial (passkey can't be lifted from
/// the user's device).
export interface EmailLoginResult {
  address: `0x${string}`;
  walletId: string | null;
  seeded: boolean;
  isNew: boolean;
}

export async function signInWithEmail(email: string): Promise<EmailLoginResult> {
  const { startRegistration, startAuthentication } = await import("@simplewebauthn/browser");

  const beginRes = await fetch(`${AUTH_URL}/auth/email/begin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email }),
  });
  const begin = (await beginRes.json().catch(() => ({}))) as {
    mode?: "register" | "login";
    options?: unknown;
    error?: string;
  };
  if (!beginRes.ok || !begin.mode || !begin.options) {
    throw new Error(begin.error ?? "could not start sign-in");
  }

  let webauthnResponse: unknown;
  if (begin.mode === "register") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    webauthnResponse = await startRegistration({ optionsJSON: begin.options as any });
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    webauthnResponse = await startAuthentication({ optionsJSON: begin.options as any });
  }

  const finishRes = await fetch(`${AUTH_URL}/auth/email/finish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, mode: begin.mode, response: webauthnResponse }),
  });
  const finish = (await finishRes.json().catch(() => ({}))) as Partial<EmailLoginResult> & {
    error?: string;
  };
  if (!finishRes.ok) {
    throw new Error(finish.error ?? "passkey verification failed");
  }
  if (!finish.address) throw new Error("server returned no address");
  return {
    address: finish.address as `0x${string}`,
    walletId: finish.walletId ?? null,
    seeded: Boolean(finish.seeded),
    isNew: Boolean(finish.isNew),
  };
}

/// Enroll a passkey on the current live session. Runs the WebAuthn
/// registration ceremony against the email tied to this session and stores
/// the credential so the user's next login requires this passkey. Throws on
/// cancellation, mismatched origin, or any verification failure.
export async function enrollPasskey(): Promise<void> {
  const { startRegistration } = await import("@simplewebauthn/browser");

  const beginRes = await fetch(`${AUTH_URL}/auth/passkey/enroll/begin`, {
    method: "POST",
    credentials: "include",
  });
  const begin = (await beginRes.json().catch(() => ({}))) as { options?: unknown; error?: string };
  if (!beginRes.ok || !begin.options) {
    throw new Error(begin.error ?? "could not start passkey enrollment");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await startRegistration({ optionsJSON: begin.options as any });

  const finishRes = await fetch(`${AUTH_URL}/auth/passkey/enroll/finish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ response }),
  });
  const finish = (await finishRes.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!finishRes.ok || !finish.ok) {
    throw new Error(finish.error ?? "passkey enrollment failed");
  }
}

/// Clears the server-side session cookie. The frontend has no token to clear.
export async function logout(): Promise<void> {
  try {
    await fetch(`${AUTH_URL}/auth/logout`, { method: "POST", credentials: "include" });
  } catch {
    // A network failure should not block UI sign-out; the cookie will expire on
    // its own and the next /auth/me will return 401.
  }
}

/// One-time cleanup of the pre-cookie token left in localStorage by older
/// versions of the app. Safe no-op otherwise. Called from useAuth on mount.
export function purgeLegacyToken(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    /* ignore quota or disabled storage errors */
  }
}

/// Runs the full SIWE login with any signer (a web3 wallet or a Circle smart
/// account). The backend sets the session cookie on success; the caller is
/// expected to refresh useAuth afterwards.
export async function loginWithSigner(
  address: `0x${string}`,
  signMessage: (message: string) => Promise<`0x${string}`>,
): Promise<void> {
  const nonce = await fetchNonce(address);
  const message = buildSiweMessage(address, nonce);
  const signature = await signMessage(message);
  await verifySiwe(message, signature);
}
