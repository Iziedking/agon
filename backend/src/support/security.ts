import { createHash, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
const KEY_LENGTH = 32;
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

function scrypt(password: string, salt: Buffer, length: number, options: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(password, salt, length, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

export function normalizeSupportEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function validateSupportPassword(password: string): string | null {
  if (password.length < 12) return "password must be at least 12 characters";
  if (password.length > 128) return "password must be at most 128 characters";
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "password must include uppercase, lowercase, and a number";
  }
  return null;
}

export async function hashSupportPassword(password: string): Promise<string> {
  const validation = validateSupportPassword(password);
  if (validation) throw new Error(validation);
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$v1$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifySupportPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 7 || parts[0] !== "scrypt" || parts[1] !== "v1") return false;
  const n = Number(parts[2]);
  const r = Number(parts[3]);
  const p = Number(parts[4]);
  if (n !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) return false;
  try {
    const salt = Buffer.from(parts[5]!, "base64url");
    const expected = Buffer.from(parts[6]!, "base64url");
    if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false;
    const actual = await scrypt(password, salt, expected.length, { N: n, r, p });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function newOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function secretMatches(received: string | undefined, expected: string | undefined): boolean {
  if (!received || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
