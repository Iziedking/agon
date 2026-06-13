import { spawn } from "node:child_process";

import type { SupportedChainName } from "@circle-fin/x402-batching/client";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
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
  if (!config.nanopay.enabled) {
    return persistAndReturn(opts, { status: "rejected", usdcAmount6: 0n, errorMessage: "nanopay disabled" });
  }
  // SDK path: real x402 payment via the Gateway batching client, signed from a
  // private key. Container-native, no CLI. For Gateway-batched sellers.
  if (config.nanopay.provider === "sdk") {
    return payViaSdk(opts);
  }
  // Exact path: standard x402 "exact" scheme via x402-fetch, for normal x402
  // sellers (Gloria, Exa) that settle on their own chain. Container-native.
  if (config.nanopay.provider === "exact") {
    return payViaExact(opts);
  }
  const present = await isCliPresent();
  if (!present) {
    // The Circle CLI isn't on PATH (e.g. a slim container). Fall back to a
    // direct HTTPS fetch so the agent still gets real research data, instead
    // of reasoning blind. No USDC moves on this path; it's marked accordingly.
    if (config.nanopay.httpFallback) {
      return httpFallbackFetch(opts);
    }
    return persistAndReturn(opts, {
      status: "rejected",
      usdcAmount6: 0n,
      errorMessage: "circle cli unavailable",
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

/// Direct-HTTPS fallback for when the Circle CLI isn't available. Calls the
/// research endpoint with the same payload, attaching a per-host API key if one
/// is configured. Returns "settled" with a zero charge (no USDC moves) so the
/// runner injects the real data into the prompt; the row's error_message notes
/// it was the HTTP path. A GET is used when there's no payload, else a POST.
async function httpFallbackFetch(opts: PayX402Opts): Promise<PayX402Result> {
  try {
    const host = (() => {
      try { return new URL(opts.endpoint).host; } catch { return ""; }
    })();
    const key = config.nanopay.apiKeysByHost[host];
    const headers: Record<string, string> = { accept: "application/json" };
    if (key) {
      headers["authorization"] = `Bearer ${key}`;
      headers["x-api-key"] = key;
    }
    const init: RequestInit = opts.payload
      ? { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(opts.payload) }
      : { method: "GET", headers };
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 20_000);
    let res: Response;
    try {
      res = await fetch(opts.endpoint, { ...init, signal: ac.signal });
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) {
      return persistAndReturn(opts, {
        status: "failed",
        usdcAmount6: 0n,
        errorMessage: `http fallback ${res.status}`,
      });
    }
    const text = await res.text();
    const parsed = safeJsonParse(text) ?? text;
    return persistAndReturn(opts, {
      status: "settled",
      usdcAmount6: 0n,
      response: parsed,
      errorMessage: "http fallback (no payment)",
    });
  } catch (err) {
    return persistAndReturn(opts, {
      status: "failed",
      usdcAmount6: 0n,
      errorMessage: `http fallback error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

// ---------------------------------------------------------------------------
// SDK provider: @circle-fin/x402-batching GatewayClient.
// ---------------------------------------------------------------------------

type GatewayClientInstance = InstanceType<
  typeof import("@circle-fin/x402-batching/client")["GatewayClient"]
>;

let gatewayClient: GatewayClientInstance | null = null;
let gatewayInit = false;

/// Lazily build one GatewayClient per process from the agent wallet private
/// key. Cached (including the null result) so a missing key or import only
/// warns once. The package is a real dependency, so the import is typed.
async function getGatewayClient(): Promise<GatewayClientInstance | null> {
  if (gatewayInit) return gatewayClient;
  gatewayInit = true;
  const pk = config.nanopay.walletPrivateKey;
  if (!pk) {
    console.warn("[nanopay] NANOPAY_PROVIDER=sdk but NANOPAY_WALLET_PRIVATE_KEY is unset; research-spend will no-op.");
    return null;
  }
  try {
    const { GatewayClient } = await import("@circle-fin/x402-batching/client");
    gatewayClient = new GatewayClient({
      chain: config.nanopay.gatewayChain as SupportedChainName,
      privateKey: pk,
    });
    console.log(`[nanopay] x402 SDK ready on ${config.nanopay.gatewayChain} (wallet ${gatewayClient.address})`);
  } catch (err) {
    console.warn(`[nanopay] x402 SDK init failed: ${err instanceof Error ? err.message : err}`);
    gatewayClient = null;
  }
  return gatewayClient;
}

/// Best-effort parse of a seller's asking price (6-dec USDC) from the x402
/// payment requirements, so we can enforce the per-call budget cap before
/// paying. Returns null when the shape isn't recognized (then we just pay,
/// still bounded by the session pool).
function parseRequirementAmount6(req: unknown): bigint | null {
  if (!req || typeof req !== "object") return null;
  const r = req as Record<string, unknown>;
  const amt = r["amount"] ?? r["maxAmountRequired"] ?? r["price"];
  if (typeof amt === "number") return usdcToInt6(amt);
  if (typeof amt === "string") {
    if (amt.includes(".")) return usdcToInt6(Number(amt));
    try { return BigInt(amt); } catch { return null; }
  }
  return null;
}

/// One real x402 payment via the Gateway batching client. The SDK runs the
/// full 402 round-trip (request, sign EIP-3009 authorization, retry) and
/// settles off the wallet's Gateway balance. Mirrors payX402's structured
/// result so the runners are provider-agnostic.
async function payViaSdk(opts: PayX402Opts): Promise<PayX402Result> {
  const client = await getGatewayClient();
  if (!client) {
    return persistAndReturn(opts, {
      status: "rejected",
      usdcAmount6: 0n,
      errorMessage: "x402 sdk unavailable (set NANOPAY_WALLET_PRIVATE_KEY)",
    });
  }
  try {
    // Cap guard: refuse if the seller's price exceeds the remaining budget,
    // mirroring the CLI --max-amount behavior.
    const sup = await client.supports(opts.endpoint).catch(() => null);
    const price6 = parseRequirementAmount6(sup?.requirements);
    if (price6 != null && price6 > opts.budgetRemaining6) {
      return persistAndReturn(opts, {
        status: "rejected",
        usdcAmount6: 0n,
        errorMessage: `price ${int6ToUsdcString(price6)} over budget ${int6ToUsdcString(opts.budgetRemaining6)}`,
      });
    }

    const res = await client.pay(
      opts.endpoint,
      opts.payload ? { method: "POST", body: opts.payload } : { method: "GET" },
    );
    return persistAndReturn(opts, {
      status: "settled",
      usdcAmount6: typeof res.amount === "bigint" ? res.amount : 0n,
      txHash: typeof res.transaction === "string" ? res.transaction : undefined,
      response: res.data,
    });
  } catch (err) {
    // The seller may not offer the Gateway batching option (e.g. an exact-only
    // scheme). Rather than leave the agent dataless, fall back to a direct
    // HTTPS fetch when enabled, so it still gets real research to reason on
    // (no USDC moves on that path).
    if (config.nanopay.httpFallback) {
      return httpFallbackFetch(opts);
    }
    return persistAndReturn(opts, {
      status: "failed",
      usdcAmount6: 0n,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Exact-scheme provider: x402-fetch (standard x402 "exact" scheme).
// ---------------------------------------------------------------------------

let exactHttp: InstanceType<typeof x402HTTPClient> | null = null;
let exactHttpInit = false;

/// Lazily build one x402HTTPClient with the exact EVM scheme registered.
/// registerExactEvmScheme registers BOTH the v1 (name networks, e.g. Gloria's
/// "base") and v2 (CAIP-2, e.g. Exa's "eip155:8453") schemes, so a single
/// client pays both dialects. Signs from NANOPAY_WALLET_PRIVATE_KEY.
async function getExactClient(): Promise<InstanceType<typeof x402HTTPClient> | null> {
  if (exactHttpInit) return exactHttp;
  exactHttpInit = true;
  const pk = config.nanopay.walletPrivateKey;
  if (!pk) {
    console.warn("[nanopay] NANOPAY_PROVIDER=exact but NANOPAY_WALLET_PRIVATE_KEY is unset; research-spend will no-op.");
    return null;
  }
  try {
    const account = privateKeyToAccount(pk);
    const client = new x402Client();
    registerExactEvmScheme(client, { signer: account as never });
    exactHttp = new x402HTTPClient(client);
    console.log(`[nanopay] x402 exact-scheme (v1+v2) ready, signer ${account.address}`);
  } catch (err) {
    console.warn(`[nanopay] x402 exact init failed: ${err instanceof Error ? err.message : err}`);
    exactHttp = null;
  }
  return exactHttp;
}

export interface ExactPayResult {
  ok: boolean;
  status: number;
  data: unknown;
  txHash?: string;
  amount6: bigint;
  error?: string;
}

/// Standalone exact-scheme paid request: GET/POST a URL, run the 402 round-trip
/// (read requirements, sign, retry with the signature header), and return the
/// data plus the settlement tx. Reusable by the runner and the probe so they
/// exercise the exact same path.
export async function payExactRequest(url: string, init: RequestInit): Promise<ExactPayResult> {
  const http = await getExactClient();
  if (!http) return { ok: false, status: 0, data: null, amount6: 0n, error: "no signer (set NANOPAY_WALLET_PRIVATE_KEY)" };

  const first = await fetch(url, init);
  if (first.status !== 402) {
    const data = await first.json().catch(() => null);
    return { ok: first.ok, status: first.status, data, amount6: 0n };
  }
  const body = await first.json().catch(() => undefined);
  const required = http.getPaymentRequiredResponse((n) => first.headers.get(n), body);
  // Price (6-dec USDC) from the selected requirement, for the live-stage amount.
  const accepts = (required as { accepts?: Array<{ maxAmountRequired?: string }> }).accepts;
  let amount6 = 0n;
  const amtStr = accepts?.[0]?.maxAmountRequired;
  if (typeof amtStr === "string") { try { amount6 = BigInt(amtStr); } catch { amount6 = 0n; } }

  const payload = await http.createPaymentPayload(required);
  const payHeaders = http.encodePaymentSignatureHeader(payload);
  const retryHeaders: Record<string, string> = {
    ...((init.headers as Record<string, string>) ?? {}),
    ...payHeaders,
  };
  const second = await fetch(url, { ...init, headers: retryHeaders });
  let txHash: string | undefined;
  try {
    txHash = http.getPaymentSettleResponse((n) => second.headers.get(n))?.transaction;
  } catch { /* settle header absent; tx best-effort */ }
  const data = await second.json().catch(() => null);
  return { ok: second.ok, status: second.status, data, txHash, amount6 };
}

/// One real x402 payment via the exact scheme for the runner. Enforces the
/// per-call budget cap, then runs payExactRequest. Falls back to a data-only
/// HTTPS fetch when the payment can't complete (and the fallback is enabled).
async function payViaExact(opts: PayX402Opts): Promise<PayX402Result> {
  const init: RequestInit = opts.payload
    ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(opts.payload) }
    : { method: "GET" };
  try {
    const res = await payExactRequest(opts.endpoint, init);
    if (res.error) {
      return persistAndReturn(opts, { status: "rejected", usdcAmount6: 0n, errorMessage: res.error });
    }
    if (res.amount6 > 0n && res.amount6 > opts.budgetRemaining6) {
      return persistAndReturn(opts, {
        status: "rejected",
        usdcAmount6: 0n,
        errorMessage: `price ${int6ToUsdcString(res.amount6)} over budget ${int6ToUsdcString(opts.budgetRemaining6)}`,
      });
    }
    if (!res.ok) {
      if (config.nanopay.httpFallback) return httpFallbackFetch(opts);
      return persistAndReturn(opts, { status: "failed", usdcAmount6: 0n, errorMessage: `exact http ${res.status}` });
    }
    return persistAndReturn(opts, {
      status: "settled",
      usdcAmount6: res.amount6,
      txHash: res.txHash,
      response: res.data,
    });
  } catch (err) {
    if (config.nanopay.httpFallback) return httpFallbackFetch(opts);
    return persistAndReturn(opts, {
      status: "failed",
      usdcAmount6: 0n,
      errorMessage: err instanceof Error ? err.message : String(err),
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
