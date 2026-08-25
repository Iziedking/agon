import { createHash, randomBytes } from "node:crypto";

export const CLI_DEVICE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CLI_USER_CODE_RE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

export function hashCliCode(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomCliCode(bytes: number): string {
  const raw = randomBytes(bytes);
  let code = "";
  for (const byte of raw) code += CLI_DEVICE_ALPHABET[byte % CLI_DEVICE_ALPHABET.length];
  return code;
}

export function formatCliUserCode(raw: string): string {
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}
