import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { serviceTerms, type ServiceTerms } from "./contract.ts";

export type StoredMcpHire = {
  intentId: string;
  actor: string;
  terms: ServiceTerms;
};

export type McpHireStore = {
  create(actor: string, intentId: string, terms: ServiceTerms): Promise<StoredMcpHire>;
  get(actor: string, intentId: string): Promise<StoredMcpHire | null>;
};

function normalizedActor(actor: string): string {
  if (!actor.trim()) throw new Error("hire actor is required");
  return actor.toLowerCase();
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  throw new Error("hire terms must contain JSON values only");
}

export function reviewedTermsDigest(terms: Omit<ServiceTerms, "termsDigest">): `0x${string}` {
  return `0x${createHash("sha256").update(canonicalJson(terms)).digest("hex")}`;
}

function snapshot(actor: string, intentId: string, terms: ServiceTerms): StoredMcpHire {
  const parsed = serviceTerms.parse(terms);
  const { termsDigest, ...reviewed } = parsed;
  if (reviewedTermsDigest(reviewed).toLowerCase() !== termsDigest.toLowerCase()) {
    throw new Error("hire terms digest does not match the reviewed terms");
  }
  return { actor: normalizedActor(actor), intentId, terms: parsed };
}

function requireSameTerms(stored: StoredMcpHire, terms: ServiceTerms): StoredMcpHire {
  if (stored.terms.termsDigest.toLowerCase() !== terms.termsDigest.toLowerCase()) {
    throw new Error("hire intent already has different reviewed terms");
  }
  return stored;
}

/** Process-local fallback for unit tests; production injects the Postgres store. */
export function createMemoryMcpHireStore(): McpHireStore {
  const rows = new Map<string, StoredMcpHire>();
  return {
    async create(actor, intentId, terms) {
      const next = snapshot(actor, intentId, terms);
      const existing = rows.get(intentId);
      if (existing) {
        if (existing.actor !== next.actor) throw new Error("hire intent belongs to another actor");
        return requireSameTerms(existing, next.terms);
      }
      rows.set(intentId, next);
      return next;
    },
    async get(actor, intentId) {
      const row = rows.get(intentId);
      return row?.actor === normalizedActor(actor) ? row : null;
    },
  };
}

/** The reviewed terms stay attached to the durable x402 intent across workers and restarts. */
export function createPostgresMcpHireStore(pool: Pool): McpHireStore {
  return {
    async create(actor, intentId, terms) {
      const next = snapshot(actor, intentId, terms);
      await pool.query(
        `insert into agon_mcp_hire_previews (intent_id, actor_address, terms_digest, terms, expires_at)
         select intent_id, actor_address, $3, $4::jsonb, $5
           from agon_x402_call_intents where intent_id = $1 and actor_address = $2
         on conflict (intent_id) do nothing`,
        [intentId, next.actor, next.terms.termsDigest.toLowerCase(), JSON.stringify(next.terms), next.terms.expiresAt],
      );
      const stored = await this.get(next.actor, intentId);
      if (!stored) throw new Error("hire intent belongs to another actor or could not be persisted");
      return requireSameTerms(stored, next.terms);
    },
    async get(actor, intentId) {
      const result = await pool.query<{ intent_id: string; actor_address: string; terms_digest: string; terms: ServiceTerms }>(
        `select intent_id, actor_address, terms_digest, terms
           from agon_mcp_hire_previews where intent_id = $1 and actor_address = $2`,
        [intentId, normalizedActor(actor)],
      );
      const row = result.rows[0];
      if (!row) return null;
      const stored = snapshot(row.actor_address, row.intent_id, row.terms);
      if (stored.terms.termsDigest.toLowerCase() !== row.terms_digest) throw new Error("stored hire terms digest does not match its index");
      return stored;
    },
  };
}
