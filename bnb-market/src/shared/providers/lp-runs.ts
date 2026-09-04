import { createHash } from "node:crypto";
import { database } from "../server/store.ts";
import { HttpError } from "../server/http.ts";
import { LP_AGENT_VERSION, parseLpInput, type LpInput } from "./lp-core.ts";
import { inspectLpPosition, requireLpTestnet, type LpReport } from "./pancake.ts";

export type LpRun = { id: string; chainId: 97; version: string; status: "running" | "completed" | "failed" | "interrupted";
  startedAt: string; finishedAt: string | null; report: LpReport | null; reportJson: string | null; reportHash: string | null; error: string | null };
type RunRow = { id: string; chain_id: 97; version: string; input_json: string; status: "running" | "completed" | "failed";
  started_at: Date; finished_at: Date | null; report_json: string | null; report_hash: string | null; error: string | null };
const INTERRUPTED = "This analysis was interrupted. No funds moved. Start a new analysis to get fresh evidence.";
export function lpDailyLimit(): number {
  const raw = process.env.BNB_LP_AGENT_DAILY_LIMIT ?? "100";
  return /^(0|[1-9][0-9]{0,3})$/.test(raw) && Number(raw) <= 1000 ? Number(raw) : 0;
}
function runId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new HttpError(400, "A version-4 UUID run ID is required for safe retries.");
  return value.toLowerCase();
}
function view(row: RunRow): LpRun {
  const interrupted = row.status === "running" && Date.now() - row.started_at.getTime() > 90_000;
  if (row.report_json && `sha256:${createHash("sha256").update(row.report_json).digest("hex")}` !== row.report_hash) throw new HttpError(503, "The saved report failed its integrity check.");
  return { id: row.id, chainId: row.chain_id, version: row.version, status: interrupted ? "interrupted" : row.status,
    startedAt: row.started_at.toISOString(), finishedAt: row.finished_at?.toISOString() ?? null,
    report: row.report_json ? JSON.parse(row.report_json) as LpReport : null,
    reportJson: row.report_json, reportHash: row.report_hash, error: interrupted ? INTERRUPTED : row.error };
}
export async function readLpRun(chain: number, id: unknown): Promise<LpRun> {
  requireLpTestnet(chain);
  const result = await (await database()).query<RunRow>("SELECT * FROM bnb_lp_agent_runs WHERE chain_id=97 AND id=$1", [runId(id)]);
  if (!result.rows[0]) throw new HttpError(404, "This analysis was not found on BNB Testnet.");
  return view(result.rows[0]);
}
export async function reserveLpRun(chain: number, rawId: unknown, rawInput: unknown): Promise<{ started: boolean; run: LpRun; input: LpInput }> {
  requireLpTestnet(chain); const id = runId(rawId);
  let input: LpInput;
  try { input = parseLpInput(rawInput); } catch (error) { throw new HttpError(400, error instanceof Error ? error.message : "Invalid position settings."); }
  const inputJson = JSON.stringify(input);
  const db = await database(); const connection = await db.connect();
  try {
    await connection.query("BEGIN");
    // pg 8.16.3: one transaction lock spans admission across all app instances.
    // No wallet cost, but concurrent public reads must not multiply RPC usage.
    await connection.query("SELECT pg_advisory_xact_lock(970004,1)");
    const prior = await connection.query<RunRow>("SELECT * FROM bnb_lp_agent_runs WHERE id=$1", [id]);
    if (prior.rows[0]) {
      if (prior.rows[0].input_json !== inputJson || prior.rows[0].version !== LP_AGENT_VERSION) throw new HttpError(409, "This run ID belongs to different inputs or a different agent version.");
      await connection.query("COMMIT"); return { started: false, run: view(prior.rows[0]), input };
    }
    const limit = lpDailyLimit();
    if (!limit) throw new HttpError(503, "The AGON LP analysis service is paused.");
    await connection.query("UPDATE bnb_lp_agent_runs SET status='failed',error=$1,finished_at=now() WHERE status='running' AND started_at < now()-interval '90 seconds'", [INTERRUPTED]);
    const count = await connection.query<{ daily: string; minute: string; active: string }>(`SELECT
      count(*) FILTER (WHERE started_at >= (date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')) AS daily,
      count(*) FILTER (WHERE started_at > now()-interval '1 minute') AS minute,
      count(*) FILTER (WHERE status='running') AS active FROM bnb_lp_agent_runs`);
    const usage = count.rows[0];
    if (Number(usage.daily) >= limit) throw new HttpError(429, "Today's public analysis allowance is used. Try again after 00:00 UTC.");
    if (Number(usage.minute) >= 5 || Number(usage.active) >= 2) throw new HttpError(429, "The LP agent is busy. Please wait a minute and retry.");
    const saved = await connection.query<RunRow>("INSERT INTO bnb_lp_agent_runs(id,chain_id,version,input_json,status) VALUES($1,97,$2,$3,'running') RETURNING *", [id, LP_AGENT_VERSION, inputJson]);
    await connection.query("COMMIT"); return { started: true, run: view(saved.rows[0]), input };
  } catch (error) { await connection.query("ROLLBACK"); throw error; }
  finally { connection.release(); }
}
export async function runLpAgent(chain: number, id: unknown, input: unknown): Promise<LpRun> {
  const reserved = await reserveLpRun(chain, id, input);
  if (!reserved.started) return reserved.run;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([inspectLpPosition(chain, reserved.input), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new HttpError(504, "The chain read timed out. No funds moved. Start a new analysis to retry.")), 45_000);
    })]);
    await (await database()).query("UPDATE bnb_lp_agent_runs SET status='completed',report_json=$2,report_hash=$3,finished_at=now() WHERE id=$1 AND status='running'", [reserved.run.id, result.reportJson, result.reportHash]);
  } catch (error) {
    // RPC exceptions can embed credential-bearing URLs; persist only known copy.
    const reason = error instanceof HttpError ? error.message : "PancakeSwap data could not be verified. No funds moved. Start a new analysis to retry.";
    await (await database()).query("UPDATE bnb_lp_agent_runs SET status='failed',error=$2,finished_at=now() WHERE id=$1 AND status='running'", [reserved.run.id, reason]);
    console.error(JSON.stringify({ event: "agon_lp_analysis_failed", runId: reserved.run.id, chainId: chain }));
  } finally { if (timer) clearTimeout(timer); }
  return readLpRun(chain, reserved.run.id);
}
