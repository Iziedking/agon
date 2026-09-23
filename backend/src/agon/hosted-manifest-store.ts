import { isIP } from "node:net";
import type { Pool } from "pg";

import { canonicalizeManifest, canonicalManifestHash, normalizeManifestV2, validateManifest, type AgonServiceManifestV2 } from "./core/manifest.ts";
import { inspectManifest, ManifestInspectionError, type ManifestInspection } from "./manifest-inspector.ts";

const MAX_MANIFEST_BYTES = 64 * 1024;
const DAILY_FILES_PER_OWNER = 100;
const FILE_PATH = /^\/agon\/manifests\/(0|[1-9]\d{0,77})\/(0x[0-9a-f]{64})\/([1-9]\d{0,77})\/(0x[0-9a-f]{64})\.json$/;
const OWNER_ADDRESS = /^0x[0-9a-f]{40}$/;

export class HostedManifestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "HostedManifestError";
    this.code = code;
  }
}

export type HostedManifestFile = {
  uri: string;
  agentId: string;
  serviceKey: `0x${string}`;
  version: string;
  manifestHash: `0x${string}`;
  body: AgonServiceManifestV2;
  canonicalJson: string;
  byteLength: number;
};

export type HostedManifestStore = {
  put(actor: string, body: unknown, expectedHash?: string): Promise<HostedManifestFile>;
  get(agentId: string, serviceKey: string, version: string, manifestHash: string): Promise<HostedManifestFile | null>;
  inspect(uri: string): Promise<ManifestInspection>;
};

function publicOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HostedManifestError("manifest_host_unavailable", "The public AGON API URL is invalid.");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash
    || isIP(host) !== 0 || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new HostedManifestError("manifest_host_unavailable", "The public AGON API URL must be a public HTTPS origin.");
  }
  return url.origin;
}

function prepareFile(origin: string, input: unknown): HostedManifestFile {
  const normalized = normalizeManifestV2(input);
  if (!normalized.ok || !validateManifest(input).ok) {
    throw new HostedManifestError("manifest_invalid", "The service file is not a valid AGON version 2 manifest.");
  }
  const body = normalized.value;
  const { agentId, serviceKey } = body.identity;
  const version = body.service.version;
  if (!/^(0|[1-9]\d{0,77})$/.test(agentId) || !/^0x[0-9a-fA-F]{64}$/.test(serviceKey) || !/^[1-9]\d{0,77}$/.test(version)) {
    throw new HostedManifestError("manifest_invalid", "The service file needs a valid agent ID, service key, and positive version.");
  }
  const canonicalJson = canonicalizeManifest(body);
  const byteLength = Buffer.byteLength(canonicalJson, "utf8");
  if (byteLength > MAX_MANIFEST_BYTES) {
    throw new HostedManifestError("manifest_too_large", "The service file must be 64 KiB or smaller.");
  }
  const manifestHash = canonicalManifestHash(body);
  const normalizedServiceKey = serviceKey.toLowerCase() as `0x${string}`;
  return {
    uri: `${origin}/agon/manifests/${agentId}/${normalizedServiceKey}/${version}/${manifestHash}.json`,
    agentId,
    serviceKey: normalizedServiceKey,
    version,
    manifestHash,
    body,
    canonicalJson,
    byteLength,
  };
}

type HostedManifestRow = {
  agent_id: string;
  service_key: `0x${string}`;
  version: string;
  manifest_hash: `0x${string}`;
  canonical_json: string;
  byte_length: number;
};

export function createPostgresHostedManifestStore(
  pool: Pool,
  options: { publicApiUrl: string; isAgentOwner: (actor: string, agentId: string) => Promise<boolean> },
): HostedManifestStore {
  const origin = publicOrigin(options.publicApiUrl);
  const fromRow = (row: HostedManifestRow): HostedManifestFile => {
    try {
      const body = JSON.parse(row.canonical_json) as AgonServiceManifestV2;
      const file = prepareFile(origin, body);
      if (file.agentId === row.agent_id && file.serviceKey === row.service_key && file.version === row.version
        && file.manifestHash === row.manifest_hash && file.byteLength === row.byte_length && file.canonicalJson === row.canonical_json) {
        return file;
      }
    } catch {
      // Treat malformed stored bytes as an integrity failure, not an invalid caller request.
    }
    throw new HostedManifestError("manifest_corrupt", "The stored service file failed its integrity check.");
  };
  const store: HostedManifestStore = {
    async put(actor, input, expectedHash) {
      const normalizedActor = actor.toLowerCase();
      if (!OWNER_ADDRESS.test(normalizedActor)) throw new HostedManifestError("manifest_owner_mismatch", "Sign in with the agent owner's wallet to host its service file.");
      const file = prepareFile(origin, input);
      if (expectedHash && file.manifestHash.toLowerCase() !== expectedHash.toLowerCase()) {
        throw new HostedManifestError("manifest_hash_mismatch", "The service file differs from the reviewed manifest hash.");
      }
      let ownsAgent = false;
      try { ownsAgent = await options.isAgentOwner(normalizedActor, file.agentId); }
      catch { throw new HostedManifestError("manifest_owner_unavailable", "The agent owner could not be checked onchain."); }
      if (!ownsAgent) {
        throw new HostedManifestError("manifest_owner_mismatch", "The signed-in wallet does not own this ERC-8004 agent.");
      }
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("select pg_advisory_xact_lock(hashtext($1))", [`agon-manifest:${normalizedActor}`]);
        const key = [file.agentId, file.serviceKey, file.version, file.manifestHash];
        const select = `select agent_id::text, service_key, version::text, manifest_hash, canonical_json, byte_length
            from agon_hosted_manifests where chain_id = 5042002 and agent_id = $1::numeric and service_key = $2
              and version = $3::numeric and manifest_hash = $4`;
        const prior = await client.query<HostedManifestRow>(select, key);
        if (prior.rows[0]) {
          await client.query("commit");
          return fromRow(prior.rows[0]);
        }
        const count = await client.query<{ total: string }>(
          `select count(*)::text as total from agon_hosted_manifests
            where actor_address = $1 and created_at >= now() - interval '1 day'`,
          [normalizedActor],
        );
        if (Number(count.rows[0]?.total ?? 0) >= DAILY_FILES_PER_OWNER) {
          throw new HostedManifestError("manifest_quota_exceeded", "This wallet has reached its daily service-file hosting limit.");
        }
        await client.query(
          `insert into agon_hosted_manifests
             (chain_id, agent_id, service_key, version, manifest_hash, actor_address, canonical_json, byte_length)
           values (5042002, $1::numeric, $2, $3::numeric, $4, $5, $6, $7)
           on conflict do nothing`,
          [file.agentId, file.serviceKey, file.version, file.manifestHash, normalizedActor, file.canonicalJson, file.byteLength],
        );
        const stored = await client.query<HostedManifestRow>(select, key);
        if (!stored.rows[0]) throw new HostedManifestError("manifest_unavailable", "The service file could not be saved.");
        await client.query("commit");
        return fromRow(stored.rows[0]);
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
    async get(agentId, serviceKey, version, manifestHash) {
      if (!/^(0|[1-9]\d{0,77})$/.test(agentId) || !/^0x[0-9a-f]{64}$/.test(serviceKey)
        || !/^[1-9]\d{0,77}$/.test(version) || !/^0x[0-9a-f]{64}$/.test(manifestHash)) return null;
      const result = await pool.query<HostedManifestRow>(
        `select agent_id::text, service_key, version::text, manifest_hash, canonical_json, byte_length
           from agon_hosted_manifests
          where chain_id = 5042002 and agent_id = $1::numeric and service_key = $2
            and version = $3::numeric and manifest_hash = $4`,
        [agentId, serviceKey, version, manifestHash],
      );
      return result.rows[0] ? fromRow(result.rows[0]) : null;
    },
    async inspect(uri) {
      let url: URL;
      try { url = new URL(uri); } catch { return inspectManifest(uri); }
      if (url.origin !== origin) return inspectManifest(uri);
      const match = url.pathname.match(FILE_PATH);
      if (!match || url.search || url.hash) throw new ManifestInspectionError("manifest_uri_invalid", "The AGON-hosted service file URL is invalid.");
      const file = await store.get(match[1]!, match[2]!, match[3]!, match[4]!);
      if (!file) throw new ManifestInspectionError("manifest_unavailable", "The AGON-hosted service file does not exist.");
      return {
        uri: file.uri,
        manifestHash: file.manifestHash,
        body: file.body,
        contentType: "application/json; charset=utf-8",
        byteLength: file.byteLength,
        validation: { ok: true },
      };
    },
  };
  return store;
}
