import { createHash } from "node:crypto";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from "@simplewebauthn/server";
import { config } from "../config/index.js";
import { query } from "../db/pool.js";
import { redis } from "../redis.js";

/// WebAuthn passkey ceremonies layered in front of Circle Developer-Controlled
/// wallets. The passkey is the auth (proves the user owns the email's
/// registered device); the wallet is custodial (Circle signs ArcRun txs for
/// the user). The two never share a key.

const CHALLENGE_TTL_S = 300;

type StoredCredential = {
  credential_id: string;
  operator_address: string;
  public_key: Buffer;
  counter: string;
  transports: string[] | null;
};

function challengeKey(kind: "reg" | "auth", email: string): string {
  return `webauthn:${kind}:${email.toLowerCase()}`;
}

/// Stable per-email user handle for WebAuthn. RPs need a non-PII identifier
/// the authenticator stores under; the email's SHA-256 (first 16 bytes) works
/// and is stable across re-registrations. Authenticator binds the passkey to
/// (rpId, userId), so a stable userId means a second register for the same
/// email creates a different passkey instead of clobbering the first.
function userHandle(email: string): Uint8Array<ArrayBuffer> {
  const digest = createHash("sha256").update(email.toLowerCase()).digest();
  // SimpleWebAuthn's types require Uint8Array backed by a pure ArrayBuffer
  // (not the SharedArrayBuffer-compatible default). Build a fresh
  // ArrayBuffer and copy 16 bytes of the digest into it.
  const buf = new ArrayBuffer(16);
  const out = new Uint8Array(buf);
  for (let i = 0; i < 16; i++) out[i] = digest[i]!;
  return out;
}

export async function listCredentialsForEmail(email: string): Promise<StoredCredential[]> {
  const { rows } = await query<StoredCredential>(
    `select c.credential_id, c.operator_address, c.public_key, c.counter::text as counter, c.transports
       from webauthn_credentials c
       join operators o on o.address = c.operator_address
      where o.email = $1`,
    [email.toLowerCase()],
  );
  return rows;
}

/// Build the WebAuthn registration challenge for `email`. The challenge is
/// stored in Redis under the email so /finish can verify it. Already-
/// registered credentials are passed as `excludeCredentials` so the same
/// device can't enroll the same email twice (the authenticator refuses).
/// Different devices have different authenticators and won't collide, so
/// this supports multi-device enrollment cleanly: device A's cred won't
/// stop device B from registering its own.
export async function beginRegistration(email: string): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const existing = await listCredentialsForEmail(email);
  const options = await generateRegistrationOptions({
    rpName: config.webauthn.rpName,
    rpID: config.webauthn.rpId,
    userName: email,
    userID: userHandle(email),
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({
      id: c.credential_id,
      transports: (c.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });
  await redis.set(challengeKey("reg", email), options.challenge, "EX", CHALLENGE_TTL_S);
  return options;
}

/// Verify the registration attestation from the browser and persist the
/// credential. The caller passes in the operator's resolved wallet address
/// (created lazily before this call) so the credential row links to the
/// existing operators row.
export async function finishRegistration(
  email: string,
  operatorAddress: string,
  response: RegistrationResponseJSON,
): Promise<{ verified: boolean }> {
  const expectedChallenge = await redis.getdel(challengeKey("reg", email));
  if (!expectedChallenge) {
    throw new Error("registration challenge expired or unknown");
  }

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: config.webauthn.origin,
    expectedRPID: config.webauthn.rpId,
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("attestation verification failed");
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  await query(
    `insert into webauthn_credentials
       (credential_id, operator_address, public_key, counter, transports, device_type, backed_up)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (credential_id) do nothing`,
    [
      credential.id,
      operatorAddress.toLowerCase(),
      Buffer.from(credential.publicKey),
      String(credential.counter),
      credential.transports ?? null,
      credentialDeviceType,
      credentialBackedUp,
    ],
  );
  return { verified: true };
}

/// Build the WebAuthn authentication challenge for `email`. `allowCredentials`
/// is populated from the row(s) in webauthn_credentials so the browser only
/// surfaces the right passkey.
export async function beginAuthentication(email: string): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const credentials = await listCredentialsForEmail(email);
  if (credentials.length === 0) {
    throw new Error("no credentials registered for this email");
  }
  const options = await generateAuthenticationOptions({
    rpID: config.webauthn.rpId,
    allowCredentials: credentials.map((c) => ({
      id: c.credential_id,
      transports: (c.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
    })),
    userVerification: "preferred",
  });
  await redis.set(challengeKey("auth", email), options.challenge, "EX", CHALLENGE_TTL_S);
  return options;
}

/// Verify the authentication assertion. Returns the wallet address bound to
/// the credential that signed the challenge, so the caller can issue the
/// session for that address.
export async function finishAuthentication(
  email: string,
  response: AuthenticationResponseJSON,
): Promise<{ verified: boolean; operatorAddress: string }> {
  const expectedChallenge = await redis.getdel(challengeKey("auth", email));
  if (!expectedChallenge) {
    throw new Error("authentication challenge expired or unknown");
  }

  const credentials = await listCredentialsForEmail(email);
  const credential = credentials.find((c) => c.credential_id === response.id);
  if (!credential) {
    throw new Error("unknown credential for this email");
  }

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: config.webauthn.origin,
    expectedRPID: config.webauthn.rpId,
    credential: {
      id: credential.credential_id,
      publicKey: new Uint8Array(credential.public_key),
      counter: Number(credential.counter),
      transports: (credential.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
    },
  });
  if (!verification.verified) {
    throw new Error("assertion verification failed");
  }

  // Bump the counter so replayed assertions are rejected.
  await query(
    "update webauthn_credentials set counter = $2 where credential_id = $1",
    [credential.credential_id, String(verification.authenticationInfo.newCounter)],
  );

  return { verified: true, operatorAddress: credential.operator_address };
}
