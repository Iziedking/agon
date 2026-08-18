import { keccak256, stringToHex } from "viem";

function canonicalize(value: unknown, ancestors: Set<object>): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("manifest numbers must be finite");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new Error("manifest contains a value that JSON cannot encode");
  }
  if (ancestors.has(value)) throw new Error("manifest must not contain cycles");

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => canonicalize(entry, ancestors)).join(",")}]`;
    }

    const object = value as Record<string, unknown>;
    const entries = Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(object[key], ancestors)}`);
    return `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalizeManifest(value: unknown): string {
  return canonicalize(value, new Set<object>());
}

export function canonicalManifestHash(value: unknown): `0x${string}` {
  return keccak256(stringToHex(canonicalizeManifest(value)));
}
