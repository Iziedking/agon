import type { Puzzle, PuzzlePresentation } from "./index.js";
import { pick } from "../rng.js";

/// Live-value ORACLE missions (x402 Phase 1b). A research puzzle whose answer
/// is the CURRENT price of a well-known crypto asset, bucketed into ranges and
/// asked as multiple choice. The bucket changes with the live market, so the
/// answer is unknowable from training: the agent must pay the x402 web-search
/// call, read the live price, and pick the range. A no-data agent can't know
/// which bucket the price sits in today, and credit-requires-payment (Phase 1a)
/// zeros any non-payer regardless.
///
/// Why bucketed multiple-choice and not a raw number:
/// - Gradeable as an exact letter (reuses the deterministic judge), no fragile
///   tolerance band on a moving number.
/// - Coarse buckets (one order-of-magnitude wide) don't flip inside a round, so
///   there's no generation-vs-grade-time drift.
/// - Ground truth comes from a FREE public source (CoinGecko), so the referee
///   never has to pay; the x402 spend is the AGENT's in-game path to the data.

/// Assets we ask about. All comfortably above $1 so the bucket math is clean,
/// and all so liquid that a live search returns the current price reliably.
const ASSETS: ReadonlyArray<{ id: string; name: string; symbol: string }> = [
  { id: "bitcoin", name: "Bitcoin", symbol: "BTC" },
  { id: "ethereum", name: "Ethereum", symbol: "ETH" },
  { id: "solana", name: "Solana", symbol: "SOL" },
];

const LETTERS = ["A", "B", "C", "D"] as const;

const ORACLE_PRESENTATION: PuzzlePresentation = {
  family: "ORACLE",
  difficulty: 3,
  format: "choice",
  choices: LETTERS,
  // Generous so the agent can run the paid search, read the price, and answer.
  timeLimitSec: 60,
  toolsAllowed: "calc+web",
};

/// Short price cache so a round of puzzles (and concurrent agents) don't hammer
/// the public price API. TTL is well under how long a bucket stays valid.
const CACHE_TTL_MS = 30_000;
const priceCache = new Map<string, { price: number; at: number }>();

/// Whether ORACLE missions are enabled. Off by default unless explicitly turned
/// on, so existing solver behavior is unchanged until an operator opts in.
export function oracleEnabled(): boolean {
  const v = process.env.PUZZLE_ORACLE_ENABLED;
  return v === "true" || v === "1";
}

/// Fetch the live USD price from CoinGecko's free, key-less simple-price API.
/// Returns null on any failure so the caller falls back to the static research
/// bank and nothing breaks.
async function livePriceUsd(id: string): Promise<number | null> {
  const cached = priceCache.get(id);
  // Date.now() is fine here: this is live data capture, not deterministic seeding.
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.price;
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, { usd?: number }>;
    const price = data?.[id]?.usd;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return null;
    priceCache.set(id, { price, at: now });
    return price;
  } catch {
    return null;
  }
}

function fmtUsd(n: number): string {
  if (n >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${Math.round(n)}`;
}

/// Build four consecutive price buckets one order-of-magnitude-step wide, with
/// the bucket that actually contains `price` placed at a seeded slot. Returns
/// the choice labels and the index of the correct one.
function buildBuckets(price: number, r: () => number): { choices: string[]; answerIdx: number } {
  const unit = Math.pow(10, Math.floor(Math.log10(price))); // 10000 for 67000
  const width = unit;
  const low = Math.floor(price / width) * width; // bottom edge of the true bucket
  const answerIdx = pick(r, 4); // where the correct bucket sits among the four
  const startLow = Math.max(0, low - answerIdx * width);
  const choices: string[] = [];
  for (let i = 0; i < 4; i++) {
    const a = startLow + i * width;
    choices.push(`${fmtUsd(a)} – ${fmtUsd(a + width)}`);
  }
  // If clamping at 0 shifted the true bucket off `answerIdx`, recompute which
  // slot now holds the price so the expected letter is always right.
  const realIdx = Math.min(3, Math.max(0, Math.floor((price - startLow) / width)));
  return { choices, answerIdx: realIdx };
}

/// Generate one live-price ORACLE mission, or null when the live fetch fails or
/// oracle missions are disabled. The returned puzzle is kind "research" so it
/// rides the existing x402 web-search spend + the credit-requires-payment gate.
export async function generatePriceOracle(seed: number): Promise<Puzzle | null> {
  if (!oracleEnabled()) return null;
  const r = (() => {
    // tiny seeded picker for the asset; price itself is live, not seeded
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  })();
  const asset = ASSETS[pick(r, ASSETS.length)]!;
  const price = await livePriceUsd(asset.id);
  if (price === null) return null;
  const { choices, answerIdx } = buildBuckets(price, r);

  const prompt = [
    `What is the CURRENT price of ${asset.name} (${asset.symbol}) in USD closest to right now?`,
    `A) ${choices[0]}`,
    `B) ${choices[1]}`,
    `C) ${choices[2]}`,
    `D) ${choices[3]}`,
    "",
    `This needs a live price. Search query to run: "${asset.symbol} ${asset.name} price usd today".`,
    "Read the live price from the SEARCH RESULTS and pick the range it falls in.",
    "Finish with exactly one letter on its own line: A, B, C, or D.",
  ].join("\n");

  return {
    kind: "research",
    prompt,
    expected: LETTERS[answerIdx]!,
    presentation: ORACLE_PRESENTATION,
    source: `live price · ${asset.symbol}`,
  };
}

const RECON_PRESENTATION: PuzzlePresentation = {
  family: "RECON",
  difficulty: 3,
  format: "choice",
  choices: LETTERS,
  timeLimitSec: 60,
  toolsAllowed: "calc+web",
};

/// A RECON mission: the agent must gather SEVERAL live values and synthesize one
/// answer. Here: look up the current price of all three assets, add them, and
/// pick the bucket for the sum. It's the multi-step agentic workflow (gather
/// many live data points, then compute) the x402 economy is about, and it stays
/// deterministically gradeable because the referee sums the same public prices.
/// Returns null when any live fetch fails or oracle missions are disabled, so
/// the static research puzzle stays as the fallback.
export async function generatePriceRecon(seed: number): Promise<Puzzle | null> {
  if (!oracleEnabled()) return null;
  let s = (seed * 2654435761) >>> 0;
  const r = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const prices = await Promise.all(ASSETS.map((a) => livePriceUsd(a.id)));
  if (prices.some((p) => p === null)) return null;
  const sum = prices.reduce<number>((acc, p) => acc + (p ?? 0), 0);
  const { choices, answerIdx } = buildBuckets(sum, r);

  const list = ASSETS.map((a) => `${a.symbol}`).join(" + ");
  const prompt = [
    `Add up the CURRENT USD price of one of each: ${list}. Which range is the total closest to right now?`,
    `A) ${choices[0]}`,
    `B) ${choices[1]}`,
    `C) ${choices[2]}`,
    `D) ${choices[3]}`,
    "",
    `This needs live prices for all three. Search query to run: "BTC ETH SOL price usd today".`,
    "Read each live price from the SEARCH RESULTS, add them, and pick the range the total falls in.",
    "Finish with exactly one letter on its own line: A, B, C, or D.",
  ].join("\n");

  return {
    kind: "research",
    prompt,
    expected: LETTERS[answerIdx]!,
    presentation: RECON_PRESENTATION,
    source: "live prices · BTC+ETH+SOL",
  };
}
