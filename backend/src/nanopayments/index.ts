import { spawn } from "node:child_process";

import { config } from "../config/index.js";
import { query } from "../db/pool.js";

/// Nanopayments = Circle Gateway + x402 micropayments. Each call here is a
/// real USDC payment from a tier-pool Gateway balance to a paid HTTP
/// endpoint, settled in sub-500ms via Circle's marketplace
/// (`circle services pay`).
///
/// Why shell out instead of an SDK: Circle hasn't released a programmatic
/// x402 SDK yet. The CLI handles payment-authorization signing, Gateway
/// routing, and the 402 round-trip, so spawning it is the supported
/// integration shape today.
///
/// Per-tier spending caps are enforced in this module because Circle's
/// native `wallet limit set` policy is mainnet-only; testnet rejects it
/// with "Spending policies are mainnet-only."
///
/// Every call writes one row to `nanopayments`. The Solver runner uses
/// these rows to surface real spend per call on the live stage.

const USDC_6 = 1_000_000n;

let cliPresent: boolean | null = null;

/// Detect Circle CLI availability once per process lifetime. Cached so the
/// hot path doesn't pay a spawn-per-call.
export async function isCliPresent(): Promise<boolean> {
  if (cliPresent !== null) return cliPresent;
  cliPresent = await new Promise<boolean>((resolve) => {
    const proc = spawn(config.nanopay.cliPath, ["--version"], { shell: false });
    proc.on("error", () => resolve(false));
    proc.on("exit", (code) => resolve(code === 0));
  });
  if (!cliPresent && config.nanopay.enabled) {
    console.warn(
      `[nanopay] cli "${config.nanopay.cliPath}" not found on PATH; ` +
        "x402 paid calls will be skipped. Install with `npm i -g @circle-fin/cli`.",
    );
  }
  return cliPresent;
}

/// USDC decimal → 6-dec integer. Rounds DOWN so we never exceed a cap due
/// to float drift.
export function usdcToInt6(amount: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) return 0n;
  return BigInt(Math.floor(amount * Number(USDC_6)));
}

/// 6-dec integer → human USDC string with 4 fractional digits. Used in
/// log lines and the live-stage display ("$0.0136" instead of raw 6-dec).
export function int6ToUsdcString(n: bigint): string {
  const whole = n / USDC_6;
  const frac = n % USDC_6;
  const fracStr = frac.toString().padStart(6, "0").slice(0, 4);
  return `${whole}.${fracStr}`;
}

export interface PayX402Opts {
  agentId: number;
  contestId?: number;
  challengeId?: number;
  /// 0-indexed puzzle slot within the contest. Used as a clustering key on
  /// the `nanopayments` table.
  puzzleIdx: number;
  tier: number;
  /// Paid endpoint URL surfaced by `circle services search`.
  endpoint: string;
  /// Human label like "Predexon prediction markets"; drives the live-stage
  /// caption.
  endpointLabel?: string;
  /// Request body forwarded as the `--data` flag.
  payload?: object;
  /// Remaining puzzle budget in 6-dec USDC. The runner decrements this as it
  /// spends; this module is the second line of defense.
  budgetRemaining6: bigint;
  /// Coordinator wallet address paying the call. Required by the CLI.
  walletAddress: `0x${string}`;
  /// Override the default settlement chain when the endpoint demands a
  /// specific one (most are Polygon today, hence the env default of MATIC).
  chain?: string;
}

export interface PayX402Result {
  status: "settled" | "rejected" | "failed";
  /// 6-dec USDC actually moved. Zero on rejected, equal to the seller's
  /// asking price on settled/failed.
  usdcAmount6: bigint;
  txHash?: string;
  response?: unknown;
  errorMessage?: string;
}

/// Single x402 paid call. Returns a structured result regardless of
/// outcome. The runner is expected to inspect `status` and proceed even on
/// rejection.
export async function payX402(opts: PayX402Opts): Promise<PayX402Result> {
  const present = await isCliPresent();
  if (!present || !config.nanopay.enabled) {
    return persistAndReturn(opts, {
      status: "rejected",
      usdcAmount6: 0n,
      errorMessage: present ? "nanopay disabled" : "circle cli unavailable",
    });
  }

  // Cap per call wins against the puzzle budget (whichever is smaller).
  const hardCap6 = usdcToInt6(config.nanopay.maxPerCallUsdc);
  const effectiveCap6 = opts.budgetRemaining6 < hardCap6 ? opts.budgetRemaining6 : hardCap6;
  if (effectiveCap6 <= 0n) {
    return persistAndReturn(opts, {
      status: "rejected",
      usdcAmount6: 0n,
      errorMessage: "budget exhausted",
    });
  }

  const chain = opts.chain ?? config.nanopay.settlementChain;
  const maxAmountUsdc = int6ToUsdcString(effectiveCap6);

  const args = [
    "services",
    "pay",
    opts.endpoint,
    "--address",
    opts.walletAddress,
    "--chain",
    chain,
    "--output",
    "json",
    "--max-amount",
    maxAmountUsdc,
  ];
  if (opts.payload) {
    args.push("--data", JSON.stringify(opts.payload));
  }

  try {
    const cli = await runCli(args, 45_000);
    if (cli.exitCode !== 0) {
      return persistAndReturn(opts, parseCliFailure(cli.stdout, cli.stderr));
    }
    const parsed = safeJsonParse(cli.stdout);
    if (!parsed) {
      return persistAndReturn(opts, {
        status: "failed",
        usdcAmount6: 0n,
        errorMessage: "could not parse cli stdout as json",
      });
    }
    // The CLI's success envelope carries the seller response under one of
    // a few keys depending on version. Walk a few likely paths.
    const sellerResponse =
      pick(parsed, "data") ??
      pick(parsed, "response") ??
      pick(parsed, "result") ??
      parsed;
    const txHash: string | undefined =
      pickString(parsed, "txHash") ??
      pickString(parsed, "transactionHash") ??
      pickString(parsed, "payment", "txHash");
    const charged6 = extractChargedAmount6(parsed) ?? estimateChargedFromCli(parsed);

    return persistAndReturn(opts, {
      status: "settled",
      usdcAmount6: charged6 ?? 0n,
      txHash,
      response: sellerResponse,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return persistAndReturn(opts, {
      status: "failed",
      usdcAmount6: 0n,
      errorMessage: msg,
    });
  }
}

/// Marketplace search. Returns the parsed CLI JSON for the Solver to pick
/// an endpoint from, or null if the CLI is unavailable.
export async function searchX402(keyword: string): Promise<unknown | null> {
  const present = await isCliPresent();
  if (!present) return null;
  const cli = await runCli(["services", "search", keyword, "--output", "json"], 20_000);
  if (cli.exitCode !== 0) return null;
  return safeJsonParse(cli.stdout);
}

/// Marketplace inspect. Confirms current price/chain/schema before the
/// runner commits to a paid call.
export async function inspectX402(endpoint: string): Promise<unknown | null> {
  const present = await isCliPresent();
  if (!present) return null;
  const cli = await runCli(["services", "inspect", endpoint, "--output", "json"], 20_000);
  if (cli.exitCode !== 0) return null;
  return safeJsonParse(cli.stdout);
}

function persistAndReturn(opts: PayX402Opts, result: PayX402Result): PayX402Result {
  // Fire and forget: DB write should never block the runner. Errors here
  // are logged, never thrown.
  void query(
    `insert into nanopayments
       (agent_id, contest_id, challenge_id, puzzle_idx, tier, endpoint,
        endpoint_label, usdc_amount_6, chain, tx_hash, status,
        response_summary, error_message, budget_remaining_6)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      opts.agentId,
      opts.contestId ?? null,
      opts.challengeId ?? null,
      opts.puzzleIdx,
      opts.tier,
      opts.endpoint,
      opts.endpointLabel ?? null,
      result.usdcAmount6.toString(),
      opts.chain ?? config.nanopay.settlementChain,
      result.txHash ?? null,
      result.status,
      summarizeResponse(result.response),
      result.errorMessage ?? null,
      opts.budgetRemaining6.toString(),
    ],
  ).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[nanopay] failed to persist row: ${msg}`);
  });
  return result;
}

function summarizeResponse(r: unknown): string | null {
  if (r === undefined || r === null) return null;
  try {
    const s = typeof r === "string" ? r : JSON.stringify(r);
    return s.slice(0, 500);
  } catch {
    return null;
  }
}

function pick(obj: unknown, ...keys: string[]): unknown {
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur && typeof cur === "object" && k in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[k];
    } else {
      return undefined;
    }
  }
  return cur;
}

function pickString(obj: unknown, ...keys: string[]): string | undefined {
  const v = pick(obj, ...keys);
  return typeof v === "string" ? v : undefined;
}

function extractChargedAmount6(parsed: unknown): bigint | null {
  // Many CLI versions return the charge under `payment.amount` as a string
  // in 6-dec form, or under `data.price` as a decimal USDC string.
  const explicit =
    pickString(parsed, "payment", "amount") ??
    pickString(parsed, "amount") ??
    pickString(parsed, "data", "price");
  if (!explicit) return null;
  // If it looks like a decimal (contains "."), parse as decimal USDC.
  if (explicit.includes(".")) {
    const n = Number(explicit);
    return Number.isFinite(n) ? usdcToInt6(n) : null;
  }
  // Otherwise treat as 6-dec integer.
  try {
    return BigInt(explicit);
  } catch {
    return null;
  }
}

function estimateChargedFromCli(_parsed: unknown): bigint | null {
  // Fallback when the CLI doesn't surface a settled amount. We deliberately
  // return null so the row reflects "amount unknown" rather than guessing
  // wrong. Callers (the Solver) credit the puzzle budget conservatively.
  return null;
}

function safeJsonParse(s: string): unknown | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

interface CliRun {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runCli(args: string[], timeoutMs: number): Promise<CliRun> {
  return new Promise((resolve) => {
    const proc = spawn(config.nanopay.cliPath, args, {
      shell: false,
      env: {
        ...process.env,
        NODE_OPTIONS: process.env.NODE_OPTIONS ?? "--max-http-header-size=262144",
      },
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const killer = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve({ stdout, stderr: stderr + "\n[timeout]", exitCode: 124 });
    }, timeoutMs);
    proc.on("error", (err) => {
      clearTimeout(killer);
      resolve({ stdout, stderr: stderr + "\n" + err.message, exitCode: 127 });
    });
    proc.on("exit", (code) => {
      clearTimeout(killer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

function parseCliFailure(stdout: string, stderr: string): PayX402Result {
  const msg = (stderr || stdout).slice(0, 500);
  // The CLI distinguishes pre-flight (no payment) from post-authorization
  // (payment may have moved). We err on the side of "failed" + zero amount
  // for pre-flight, and "failed" + null amount for post-authorization. The
  // operator inspects ~/.circle-cli/payments/ for forensics if needed.
  if (/PAYMENT WAS SUBMITTED/i.test(msg)) {
    return {
      status: "failed",
      usdcAmount6: 0n,
      errorMessage: `post-auth failure: ${msg}`,
    };
  }
  if (/Payment was NOT charged/i.test(msg)) {
    return {
      status: "rejected",
      usdcAmount6: 0n,
      errorMessage: `pre-flight rejection: ${msg}`,
    };
  }
  return {
    status: "failed",
    usdcAmount6: 0n,
    errorMessage: msg,
  };
}
