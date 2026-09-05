import { DeliverableManifest, ERC8183JobOps, type OpResult } from "@bnbagent/sdk/erc8183";
import { StorageProvider } from "@bnbagent/sdk/storage";
import { AltanaWalletProvider } from "@bnbagent/sdk/wallets";
import { database } from "./store.ts";
import { HttpError, object } from "./http.ts";
import { readCommerceJob } from "./commerce.ts";
import { lpCommerceConfig } from "./commerce-intent-core.ts";
import { inspectLpPosition, type LpReport } from "../providers/pancake.ts";
import { LP_AGENT_VERSION, parseLpInput, type LpInput } from "../providers/lp-core.ts";
import { parseAgentId } from "../types.ts";

type DeliveryConfig = {
  agentId: string; providerAddress: string; priceRaw: string; publicBaseUrl: string;
};
type DeliveryConfigResult = { ready: true; config: DeliveryConfig } | { ready: false; blockers: string[] };
type DeliveryRow = { job_id: string; intent_id: string; status: "working" | "submitted" | "failed" | "needs_attention";
  attempt_count: number; manifest_json: string | null; manifest_hash: string | null; deliverable_url: string | null; tx_hash: string | null; error: string | null; updated_at: Date };
type ClaimedDelivery = DeliveryRow & { input: LpInput; provider_address: string; agent_id: string };

const TRUE = "true";
function safePublicUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.port) return null;
    return url.toString().replace(/\/+$/, "");
  } catch { return null; }
}

export function lpDeliveryConfig(env: NodeJS.ProcessEnv = process.env): DeliveryConfigResult {
  const commerce = lpCommerceConfig(env);
  const blockers = commerce.ready ? [] : commerce.blockers;
  if (env.BNB_LP_AGENT_EXECUTION_ENABLED !== TRUE) blockers.push("execution_flag_disabled");
  const publicBaseUrl = typeof env.BNB_LP_AGENT_DELIVERABLE_BASE_URL === "string" ? safePublicUrl(env.BNB_LP_AGENT_DELIVERABLE_BASE_URL) : null;
  if (!publicBaseUrl) blockers.push("deliverable_public_url_required");
  if (blockers.length || !commerce.ready || !publicBaseUrl) return { ready: false, blockers: [...new Set(blockers)] };
  return { ready: true, config: { agentId: commerce.config.agentId, providerAddress: commerce.config.providerAddress,
    priceRaw: commerce.config.priceRaw, publicBaseUrl } };
}

export function deliveryUrl(baseUrl: string, jobId: string): string {
  if (!/^[1-9][0-9]{0,77}$/.test(jobId)) throw new Error("A positive commerce job ID is required.");
  const base = safePublicUrl(baseUrl);
  if (!base) throw new Error("A public HTTPS deliverable URL is required.");
  return `${base}/${jobId}`;
}

export function reportContent(report: LpReport): string {
  if (report.chainId !== 97 || report.mode !== "read_only" || report.decision.executed !== false) throw new Error("Only a read-only BNB Testnet report can be delivered.");
  const value = JSON.stringify(report);
  if (new TextEncoder().encode(value).length > 900_000) throw new Error("The provider report is too large to deliver.");
  return value;
}

export function reconcileSubmittedManifest(status: unknown, deliverable: unknown, manifestHash: string | null): "submitted" | "needs_attention" | null {
  if (status !== 2 && status !== 3) return null;
  if (typeof manifestHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(manifestHash) && typeof deliverable === "string" && deliverable.toLowerCase() === manifestHash.toLowerCase()) return "submitted";
  return "needs_attention";
}

function jobIdFromFilename(filename: string | undefined): string {
  if (typeof filename !== "string") throw new Error("A job-scoped deliverable filename is required.");
  const match = /^erc8183-job-([1-9][0-9]{0,77})\.json$/.exec(filename);
  if (!match) throw new Error("The deliverable filename is not bound to one commerce job.");
  return match[1];
}

function manifestFromData(data: Record<string, unknown>, jobId: string): DeliverableManifest {
  const manifest = DeliverableManifest.fromDict(data);
  if (String(manifest.jobId) !== jobId || manifest.chainId !== 97 || typeof manifest.response.content !== "string") throw new Error("The deliverable manifest is not bound to BNB Testnet and this job.");
  return manifest;
}

class DatabaseDeliverableStorage extends StorageProvider {
  readonly usesFileUrl = false;
  private readonly publicBaseUrl: string;
  constructor(publicBaseUrl: string) { super(); this.publicBaseUrl = publicBaseUrl; }
  async upload(data: Record<string, unknown>, filename?: string): Promise<string> {
    const jobId = jobIdFromFilename(filename);
    const manifest = manifestFromData(data, jobId);
    const json = JSON.stringify(data);
    const saved = await (await database()).query<{ intent_id: string }>("SELECT intent_id FROM bnb_commerce_deliveries WHERE job_id=$1 AND status='working'", [jobId]);
    if (!saved.rows[0]) throw new Error("This commerce job is not owned by the delivery worker.");
    await (await database()).query(`UPDATE bnb_commerce_deliveries SET manifest_json=$2,manifest_hash=$3,deliverable_url=$4,updated_at=now() WHERE job_id=$1 AND status='working'`,
      [jobId, json, manifest.manifestHash(), deliveryUrl(this.publicBaseUrl, jobId)]);
    return deliveryUrl(this.publicBaseUrl, jobId);
  }
  async download(url: string): Promise<Record<string, unknown>> {
    const jobId = this.jobFromUrl(url);
    const row = await (await database()).query<{ manifest_json: string | null }>("SELECT manifest_json FROM bnb_commerce_deliveries WHERE job_id=$1", [jobId]);
    if (!row.rows[0]?.manifest_json) throw new Error("Deliverable not found.");
    return object(JSON.parse(row.rows[0].manifest_json));
  }
  async exists(url: string): Promise<boolean> {
    try { await this.download(url); return true; } catch { return false; }
  }
  private jobFromUrl(value: string): string {
    const expected = new URL(this.publicBaseUrl);
    const actual = new URL(value);
    if (actual.origin !== expected.origin || actual.pathname.startsWith(`${expected.pathname}/`) === false) throw new Error("Deliverable URL is outside the configured public scope.");
    return jobIdFromFilename(`erc8183-job-${actual.pathname.slice(expected.pathname.length + 1)}.json`);
  }
}

export async function claimDelivery(jobId: string, providerAddress: string, agentId: string): Promise<ClaimedDelivery | null> {
  const db = await database(); const connection = await db.connect();
  try {
    await connection.query("BEGIN");
    await connection.query("SELECT pg_advisory_xact_lock(9708183,2)");
    const intent = await connection.query<{ id: string; input_json: string; provider_address: string; agent_id: string }>(
      "SELECT id,input_json,provider_address,agent_id FROM bnb_commerce_intents WHERE chain_id=97 AND job_id=$1 AND state='funded'", [jobId]);
    if (!intent.rows[0] || intent.rows[0].provider_address.toLowerCase() !== providerAddress.toLowerCase() || intent.rows[0].agent_id !== agentId) { await connection.query("COMMIT"); return null; }
    const prior = await connection.query<DeliveryRow>("SELECT * FROM bnb_commerce_deliveries WHERE job_id=$1 FOR UPDATE", [jobId]);
    if (prior.rows[0]?.status === "submitted" || prior.rows[0]?.status === "needs_attention") { await connection.query("COMMIT"); return null; }
    if (prior.rows[0]?.status === "working" && Date.now() - prior.rows[0].updated_at.getTime() < 10 * 60_000) { await connection.query("COMMIT"); return null; }
    const saved = await connection.query<DeliveryRow>(`INSERT INTO bnb_commerce_deliveries(job_id,intent_id,status,attempt_count,started_at,updated_at)
      VALUES($1,$2,'working',1,now(),now()) ON CONFLICT(job_id) DO UPDATE SET status='working',attempt_count=bnb_commerce_deliveries.attempt_count+1,started_at=now(),updated_at=now(),error=NULL
      WHERE bnb_commerce_deliveries.status IN ('failed','working') AND bnb_commerce_deliveries.attempt_count < 20 RETURNING *`, [jobId, intent.rows[0].id]);
    await connection.query("COMMIT");
    if (!saved.rows[0]) return null;
    return { ...saved.rows[0], input: parseLpInput(JSON.parse(intent.rows[0].input_json)), provider_address: intent.rows[0].provider_address, agent_id: intent.rows[0].agent_id };
  } catch (error) { await connection.query("ROLLBACK").catch(() => undefined); throw error; } finally { connection.release(); }
}

async function markDelivery(jobId: string, status: DeliveryRow["status"], fields: { error?: string; txHash?: string }): Promise<void> {
  await (await database()).query("UPDATE bnb_commerce_deliveries SET status=$2,error=$3,tx_hash=COALESCE($4,tx_hash),submitted_at=CASE WHEN $2='submitted' THEN now() ELSE submitted_at END,updated_at=now() WHERE job_id=$1", [jobId, status, fields.error ?? null, fields.txHash ?? null]);
}

function safeError(error: unknown): string { return error instanceof Error ? error.message.replace(/\S+:\/\/\S+/g, "<redacted>").slice(0, 500) : "Provider delivery failed."; }

async function processDelivery(ops: ERC8183JobOps, claimed: ClaimedDelivery): Promise<"submitted" | "failed" | "needs_attention"> {
  const jobId = Number(claimed.job_id);
  if (claimed.manifest_hash) {
    const current = await ops.getJob(jobId);
    if (current.success) {
      const recovered = reconcileSubmittedManifest(current.status, current.deliverable, claimed.manifest_hash);
      if (recovered === "submitted") {
        await markDelivery(claimed.job_id, "submitted", {});
        return recovered;
      }
      if (recovered === "needs_attention") {
        await markDelivery(claimed.job_id, recovered, { error: "The onchain deliverable does not match the saved manifest." });
        return recovered;
      }
    }
  }
  const verification = await ops.verifyJob(jobId);
  if (!verification.valid) { const status = verification.retryable ? "failed" : "needs_attention"; await markDelivery(claimed.job_id, status, { error: String(verification.error ?? "The funded job failed provider verification.") }); return status; }
  const report = await inspectLpPosition(97, claimed.input);
  const response = reportContent(report.report);
  const result: OpResult = await ops.submitResult(jobId, response, { intent_id: claimed.intent_id, agent_version: LP_AGENT_VERSION, source_report_hash: report.reportHash, execution: "read_only" });
  if (result.success === true && typeof result.txHash === "string") { await markDelivery(claimed.job_id, "submitted", { txHash: result.txHash }); return "submitted"; }
  const status = result.error_code === "tx_pending" || result.error_code === "tx_unverified" ? "needs_attention" : result.retryable ? "failed" : "needs_attention";
  await markDelivery(claimed.job_id, status, { error: String(result.error ?? "The provider could not submit the deliverable."), txHash: typeof result.tx_hash === "string" ? result.tx_hash : undefined });
  return status;
}

export async function runLpDeliveryOnce(): Promise<{ status: "disabled" | "idle" | "submitted" | "failed" | "needs_attention"; blockers?: string[]; jobId?: string }> {
  const configured = lpDeliveryConfig();
  if (!configured.ready) return { status: "disabled", blockers: configured.blockers };
  const wallet = await AltanaWalletProvider.sessionFromEnv({ network: "bnb-testnet" });
  if (wallet.address.toLowerCase() !== configured.config.providerAddress.toLowerCase()) throw new Error("The provider session wallet does not match the configured onchain provider.");
  const storage = new DatabaseDeliverableStorage(configured.config.publicBaseUrl);
  const ops = await ERC8183JobOps.create({ network: "bsc-testnet", walletProvider: wallet, storageProvider: storage, servicePrice: BigInt(configured.config.priceRaw), agentUrl: configured.config.publicBaseUrl });
  const pending = await ops.getPendingJobs();
  if (!pending.success) throw new Error(String(pending.error ?? "The provider job scan failed."));
  const jobs = Array.isArray(pending.jobs) ? pending.jobs as Array<Record<string, unknown>> : [];
  for (const job of jobs) {
    if (typeof job.jobId !== "number" && typeof job.jobId !== "string") continue;
    const claimed = await claimDelivery(String(job.jobId), configured.config.providerAddress, configured.config.agentId);
    if (!claimed) continue;
    try { const status = await processDelivery(ops, claimed); return { status, jobId: claimed.job_id }; }
    catch (error) { const message = safeError(error); await markDelivery(claimed.job_id, "failed", { error: message }); console.error(JSON.stringify({ event: "agon_lp_delivery_failed", jobId: claimed.job_id })); return { status: "failed", jobId: claimed.job_id }; }
  }
  return { status: "idle" };
}

export async function readPublicDeliverable(rawJobId: unknown): Promise<Record<string, unknown>> {
  const jobId = parseAgentId(rawJobId);
  const row = await (await database()).query<DeliveryRow>("SELECT * FROM bnb_commerce_deliveries WHERE job_id=$1 AND status='submitted'", [jobId]);
  if (!row.rows[0]?.manifest_json || !row.rows[0].manifest_hash) throw new HttpError(404, "This deliverable is not published.");
  let manifest: DeliverableManifest;
  try { manifest = manifestFromData(object(JSON.parse(row.rows[0].manifest_json)), jobId); } catch { throw new HttpError(503, "The saved deliverable failed its integrity check."); }
  if (manifest.manifestHash().toLowerCase() !== row.rows[0].manifest_hash.toLowerCase()) throw new HttpError(503, "The saved deliverable failed its integrity check.");
  const job = await readCommerceJob(97, jobId);
  if (!['submitted', 'completed'].includes(job.state) || job.deliverableHash.toLowerCase() !== manifest.manifestHash().toLowerCase()) throw new HttpError(409, "The onchain deliverable does not match this published manifest.");
  return manifest.toDict();
}

export function workerIntervalMs(value: string | undefined): number { return typeof value === "string" && /^[1-9][0-9]{2,5}$/.test(value) ? Math.min(Number(value), 600_000) : 30_000; }
