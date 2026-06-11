/// Research-spendable puzzles. Each item requires data the LLM doesn't carry
/// in training (live prediction-market state, recent counts, ranking position)
/// so an agent that pays for an x402 lookup outperforms one that doesn't.
///
/// The expected answer is a BUCKET (FEW / SOME / MANY / TONS), not an exact
/// number. Buckets stay stable as markets churn, so the bank doesn't go stale
/// week by week the way a literal-count answer would.
///
/// Generation is deterministic from a seed, so every agent in the round sees
/// the same item. The runner's `researchEndpointFor("research")` reads
/// `NANOPAY_PREDICTION_ENDPOINT` to know which paid URL to call.

import type { Puzzle, PuzzlePresentation } from "./index.js";
import { pick } from "../rng.js";

/// A single research-spendable item. `searchTerm` is what the agent (or
/// our runner on its behalf) passes to the configured x402 endpoint as
/// part of the payload. `expected` is the bucket label below.
export interface ResearchItem {
  /// Short search keyword the lookup endpoint can match against. Two-word max
  /// so it stays predictable across endpoint versions.
  searchTerm: string;
  /// Bucket the live count is expected to fall in. We keep the bucketing
  /// coarse so the answer doesn't drift hour to hour.
  expected: "NONE" | "FEW" | "SOME" | "MANY";
  /// Short label that surfaces on the live stage and in the prompt.
  topic: string;
}

const RESEARCH_BANK: readonly ResearchItem[] = [
  { searchTerm: "bitcoin", topic: "Bitcoin markets", expected: "MANY" },
  { searchTerm: "ethereum", topic: "Ethereum markets", expected: "MANY" },
  { searchTerm: "trump", topic: "Trump markets", expected: "MANY" },
  { searchTerm: "election", topic: "election markets", expected: "SOME" },
  { searchTerm: "fed rate", topic: "Fed rate markets", expected: "SOME" },
  { searchTerm: "weather", topic: "weather markets", expected: "FEW" },
  { searchTerm: "arc network", topic: "Arc markets", expected: "NONE" },
  { searchTerm: "ai", topic: "AI markets", expected: "SOME" },
  { searchTerm: "spacex", topic: "SpaceX markets", expected: "FEW" },
  { searchTerm: "stocks", topic: "stocks markets", expected: "SOME" },
  { searchTerm: "nfl", topic: "NFL markets", expected: "MANY" },
  { searchTerm: "nba", topic: "NBA markets", expected: "MANY" },
  { searchTerm: "oscars", topic: "Oscars markets", expected: "FEW" },

  // --- FIFA World Cup 2026 (seasonal hype). During the tournament a real
  // prediction-market feed is thick with football markets, so these sit in
  // the forgiving SOME/MANY buckets. Retune or trim after the tournament. ---
  { searchTerm: "world cup", topic: "World Cup 2026 markets", expected: "MANY" },
  { searchTerm: "fifa", topic: "FIFA markets", expected: "MANY" },
  { searchTerm: "world cup winner", topic: "World Cup winner markets", expected: "SOME" },
  { searchTerm: "world cup final", topic: "World Cup final markets", expected: "SOME" },
  { searchTerm: "golden boot", topic: "Golden Boot markets", expected: "FEW" },
  { searchTerm: "messi", topic: "Messi markets", expected: "SOME" },
  { searchTerm: "mbappe", topic: "Mbappe markets", expected: "SOME" },
  { searchTerm: "argentina", topic: "Argentina markets", expected: "SOME" },
  { searchTerm: "brazil", topic: "Brazil markets", expected: "SOME" },
  { searchTerm: "england", topic: "England markets", expected: "SOME" },
] as const;

const BUCKETS = ["NONE", "FEW", "SOME", "MANY"] as const;

const RESEARCH_PRESENTATION: PuzzlePresentation = {
  family: "RESEARCH",
  difficulty: 3,
  format: "choice",
  choices: BUCKETS,
  // Generous time so agents have room to call an external API, parse the
  // response, then commit an answer.
  timeLimitSec: 60,
  // calc+web because the agent benefits from external data; the runner
  // surfaces that data via the configured x402 endpoint when a tier has
  // budget. Without budget, the agent has to guess.
  toolsAllowed: "calc+web",
};

/// Pick a research puzzle by seed. Uses the same `used` set the rest of the
/// generator uses so a round never reuses an item.
export function researchPuzzle(r: () => number, used: Set<string>): Puzzle {
  let idx = pick(r, RESEARCH_BANK.length);
  const key = (i: number) => `research:${i}`;
  for (let attempts = 0; attempts < 8 && used.has(key(idx)); attempts++) {
    idx = pick(r, RESEARCH_BANK.length);
  }
  used.add(key(idx));
  const item = RESEARCH_BANK[idx] ?? RESEARCH_BANK[0]!;

  const prompt = [
    `Research task: look up prediction markets about ${item.topic} on the configured marketplace.`,
    `How many OPEN markets currently match the keyword "${item.searchTerm}"?`,
    "Bucket your answer:",
    "A) NONE  (no open markets)",
    "B) FEW   (1 to 3 open markets)",
    "C) SOME  (4 to 10 open markets)",
    "D) MANY  (11 or more open markets)",
    "Answer with one of: NONE, FEW, SOME, MANY.",
    "If the RESEARCH context above carries market data, count and bucket from it. Otherwise estimate from what you know.",
  ].join("\n");

  return {
    kind: "research",
    prompt,
    expected: item.expected,
    presentation: RESEARCH_PRESENTATION,
  };
}

/// Appends the search term to a Predexon endpoint as a query string.
/// Predexon's `pm/*` endpoints are HTTP GET routes and 404 when params live
/// in the body; they MUST be baked into the URL. We also pin `status=open` so the
/// response reflects markets the agent could actually trade today (default
/// sort returns historical highest-volume markets, most of which are closed).
export function buildResearchUrl(baseUrl: string, searchTerm: string): string {
  const sep = baseUrl.includes("?") ? "&" : "?";
  const safe = encodeURIComponent(searchTerm);
  return `${baseUrl}${sep}search=${safe}&status=open&limit=10`;
}

/// Pull the search term out of the prompt so the runner knows what to pass
/// to the x402 endpoint. Cheaper than threading the item through every layer.
export function extractSearchTerm(prompt: string): string | null {
  const m = prompt.match(/keyword\s+"([^"]+)"/i);
  return m && m[1] ? m[1] : null;
}
