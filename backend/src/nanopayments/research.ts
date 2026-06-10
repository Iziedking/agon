import { config } from "../config/index.js";
import { query } from "../db/pool.js";
import { payX402 } from "./index.js";
import { getTierPool, recordTierPoolSpend } from "../coordinator/tierPools.js";

/// Shared tier-gated research spend for all three runner kinds. The Solver
/// was the first spender (Predexon per puzzle); this module generalizes the
/// pattern so the Analyst (paid news before trade picks) and the Scout
/// (paid prices before the volume strategy) run through the exact same
/// gate, pool, and audit trail.
///
/// The gate is the product mechanic: research is unlocked at
/// NANOPAY_MIN_RESEARCH_TIER (default 3). Below that, agents reason from
/// the bare prompt. Upgrading literally buys the agent access to outside
/// data.

export interface ResearchResult {
  usdcAmount6: bigint;
  label: string;
  summary: string;
}

/// True when this tier is allowed to spend on research at all.
export function researchTierUnlocked(tier: number): boolean {
  return config.nanopay.enabled && tier >= config.nanopay.minResearchTier;
}

/// One tier-gated paid call. Returns null on every reason to skip: tier
/// below the research gate, no pool, drained budget, or a non-settled
/// payment. Callers treat null as "proceed without research".
export async function paidAgentResearch(opts: {
  agentId: number;
  contestId?: number;
  challengeId?: number;
  /// Clustering key on the nanopayments table. Solver uses the puzzle
  /// slot; analyst uses the tick index; scout uses 0.
  puzzleIdx: number;
  tier: number;
  endpoint: string;
  label: string;
  payload?: object;
  chain?: string;
  summarize: (response: unknown) => string;
}): Promise<ResearchResult | null> {
  if (!researchTierUnlocked(opts.tier)) return null;
  const pool = getTierPool(opts.tier);
  if (!pool) return null;

  // Per-call cap is the smaller of the tier's per-puzzle cap and what the
  // session pool has left. A drained pool short-circuits to no spend.
  const cap = pool.perPuzzleCap6;
  const remaining = pool.balanceUsdc6 < cap ? pool.balanceUsdc6 : cap;
  if (remaining <= 0n) return null;

  const result = await payX402({
    agentId: opts.agentId,
    contestId: opts.contestId,
    challengeId: opts.challengeId,
    puzzleIdx: opts.puzzleIdx,
    tier: opts.tier,
    endpoint: opts.endpoint,
    endpointLabel: opts.label,
    payload: opts.payload,
    budgetRemaining6: remaining,
    walletAddress: pool.walletAddress,
    chain: opts.chain,
  });
  if (result.status !== "settled") return null;

  pool.balanceUsdc6 = pool.balanceUsdc6 - result.usdcAmount6;
  void recordTierPoolSpend(opts.tier, result.usdcAmount6);

  return {
    usdcAmount6: result.usdcAmount6,
    label: opts.label,
    summary: opts.summarize(result.response),
  };
}

/// Total settled research spend for one agent in one contest, summed from
/// the nanopayments audit rows. Used by runners whose spend happens outside
/// the scoring pass (the analyst's tick scheduler) so the live progress
/// frame still carries the number.
export async function sumAgentResearchSpend(
  contestId: number,
  agentId: number,
): Promise<{ total6: bigint; label: string | null }> {
  try {
    const { rows } = await query<{ total: string; label: string | null }>(
      `select coalesce(sum(usdc_amount_6::numeric), 0)::text as total,
              max(endpoint_label) as label
         from nanopayments
        where contest_id = $1 and agent_id = $2 and status = 'settled'`,
      [contestId, agentId],
    );
    const raw = rows[0]?.total ?? "0";
    return { total6: BigInt(raw.split(".")[0] ?? "0"), label: rows[0]?.label ?? null };
  } catch {
    return { total6: 0n, label: null };
  }
}

// ---------------------------------------------------------------------------
// Endpoint shaping + response summarizers per research kind.
// ---------------------------------------------------------------------------

/// Tickers and themes worth searching news for, scanned against Arcana
/// market titles. First hit wins; "crypto" is the safe fallback keyword.
const NEWS_KEYWORDS = [
  "bitcoin", "btc", "ethereum", "eth", "solana", "sol", "xrp", "doge",
  "usdc", "stablecoin", "fed", "etf", "election", "ai",
];

/// Picks the news keyword for a set of market titles. Lowercase scan,
/// whole-word match, first listed keyword found anywhere wins so the
/// query stays a single term (Gloria prices per request, not per word).
export function newsKeywordFor(titles: string[]): string {
  const haystack = titles.join(" ").toLowerCase();
  for (const kw of NEWS_KEYWORDS) {
    if (new RegExp(`\\b${kw}\\b`).test(haystack)) return kw;
  }
  return "crypto";
}

/// Gloria's news-by-keyword is a GET; the keyword rides the query string.
export function buildNewsUrl(baseUrl: string, keyword: string): string {
  const sep = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${sep}keyword=${encodeURIComponent(keyword)}`;
}

/// Reduces a Gloria headlines response to a one-paragraph prompt snippet.
/// Walks the likely wrapper paths the CLI emits, pulls headline strings
/// out of the first array of objects it finds, and joins the top five.
export function summarizeNews(response: unknown): string {
  const items = findFirstArray(response);
  if (items) {
    const titles: string[] = [];
    for (const it of items) {
      if (titles.length >= 5) break;
      if (typeof it === "string") {
        titles.push(it);
        continue;
      }
      if (it && typeof it === "object") {
        const o = it as Record<string, unknown>;
        // Gloria's headline field is `signal`, with a `sentiment` tag worth
        // carrying ("bullish"/"bearish" is exactly what a trading agent
        // needs). Other providers use headline/title/text/summary.
        const t = o["signal"] ?? o["headline"] ?? o["title"] ?? o["text"] ?? o["summary"];
        if (typeof t === "string" && t.trim()) {
          const sentiment = typeof o["sentiment"] === "string" ? ` [${o["sentiment"]}]` : "";
          titles.push(`${t.trim()}${sentiment}`);
        }
      }
    }
    if (titles.length > 0) return titles.join(" | ").slice(0, 600);
  }
  return fallbackStringify(response);
}

/// Price endpoints differ in URL shape: AIsa's CoinGecko proxy bakes its
/// coin ids into the query string (configure the full URL in env), while
/// Alchemy's by-symbol route takes repeated `symbols` params. An endpoint
/// that already carries a query string is used verbatim.
export function buildPriceUrl(baseUrl: string, symbols: string[]): string {
  if (baseUrl.includes("?")) return baseUrl;
  const qs = symbols.map((s) => `symbols=${encodeURIComponent(s)}`).join("&");
  return `${baseUrl}?${qs}`;
}

/// Reduces a paid price response to "ethereum $1635.44 · usd-coin $0.9998".
/// Handles the two live shapes: CoinGecko simple/price (object keyed by
/// coin id, smoke-tested via AIsa on Polygon) and Alchemy prices-by-symbol
/// (array of {symbol, prices:[{value}]}).
export function summarizePrices(response: unknown): string {
  // CoinGecko shape: { ethereum: { usd: 1635.44 }, "usd-coin": { usd: 1 } }
  const fromObject = (node: unknown): string | null => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return null;
    const parts: string[] = [];
    for (const [coin, v] of Object.entries(node as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const usd = (v as Record<string, unknown>)["usd"];
      if (typeof usd === "number") parts.push(`${coin} $${usd}`);
    }
    return parts.length > 0 ? parts.join(" · ").slice(0, 300) : null;
  };
  const direct = fromObject(response);
  if (direct) return direct;
  // The CLI may nest the seller payload one level down (data/response).
  if (response && typeof response === "object") {
    for (const v of Object.values(response as Record<string, unknown>)) {
      const nested = fromObject(v);
      if (nested) return nested;
    }
  }

  // Alchemy shape: { data: [{ symbol, prices: [{ value }] }] }
  const items = findFirstArray(response);
  if (items) {
    const parts: string[] = [];
    for (const it of items) {
      if (!it || typeof it !== "object") continue;
      const o = it as Record<string, unknown>;
      const symbol = typeof o["symbol"] === "string" ? o["symbol"] : null;
      const prices = Array.isArray(o["prices"]) ? (o["prices"] as Array<Record<string, unknown>>) : null;
      const value = prices?.[0]?.["value"];
      if (symbol && (typeof value === "string" || typeof value === "number")) {
        parts.push(`${symbol} $${value}`);
      }
    }
    if (parts.length > 0) return parts.join(" · ").slice(0, 300);
  }
  return fallbackStringify(response);
}

/// Depth-first walk for the first array of length > 0 anywhere in the
/// response envelope. The CLI nests the seller payload differently across
/// versions; hunting for "the list" beats hardcoding wrapper paths.
function findFirstArray(node: unknown, depth = 0): unknown[] | null {
  if (depth > 4 || node === null || node === undefined) return null;
  if (Array.isArray(node)) return node.length > 0 ? node : null;
  if (typeof node !== "object") return null;
  for (const v of Object.values(node as Record<string, unknown>)) {
    const found = findFirstArray(v, depth + 1);
    if (found) return found;
  }
  return null;
}

function fallbackStringify(response: unknown): string {
  if (response === undefined || response === null) return "no data";
  try {
    if (typeof response === "string") return response.slice(0, 600);
    return JSON.stringify(response).slice(0, 600);
  } catch {
    return String(response).slice(0, 600);
  }
}
