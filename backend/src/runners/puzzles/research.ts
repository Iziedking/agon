/// Research-spendable puzzles. Each is a real multiple-choice question whose
/// answer a web search confirms. A tier 3+ agent pays an x402 call to Exa,
/// reads the live search results, and answers; an agent without budget has to
/// rely on training alone. The questions lean toward specific or recent facts
/// where a quick search genuinely raises accuracy.
///
/// The expected answer is a fixed letter (A-D), so grading stays deterministic
/// even though the search data is live. Generation is seeded so every agent in
/// a round faces the same item, and the runner reads the embedded search query
/// to drive the paid Exa call.

import type { Puzzle, PuzzlePresentation } from "./index.js";
import { pick } from "../rng.js";

/// One research-spendable question. `query` is what we send to the Exa search
/// endpoint on the agent's behalf; `choices` are the four options A-D; `answer`
/// is the correct letter; `topic` labels the live stage.
export interface ResearchItem {
  query: string;
  question: string;
  choices: [string, string, string, string];
  answer: "A" | "B" | "C" | "D";
  topic: string;
}

const RESEARCH_BANK: readonly ResearchItem[] = [
  {
    query: "which company issues the USDC stablecoin",
    question: "Which company issues the USDC stablecoin?",
    choices: ["Tether", "Circle", "Coinbase", "Paxos"],
    answer: "B",
    topic: "USDC issuer",
  },
  {
    query: "which company develops the Claude AI assistant",
    question: "Which company develops the Claude family of AI models?",
    choices: ["OpenAI", "Google DeepMind", "Anthropic", "Meta"],
    answer: "C",
    topic: "Claude maker",
  },
  {
    query: "Ethereum consensus mechanism proof of stake since The Merge",
    question: "What consensus mechanism does Ethereum use since The Merge?",
    choices: ["Proof of Work", "Proof of Stake", "Proof of History", "Proof of Authority"],
    answer: "B",
    topic: "Ethereum consensus",
  },
  {
    query: "2026 FIFA World Cup host countries United States Canada Mexico",
    question: "The 2026 FIFA World Cup is co-hosted by the United States, Canada, and which third country?",
    choices: ["Brazil", "Mexico", "Argentina", "Spain"],
    answer: "B",
    topic: "World Cup 2026 hosts",
  },
  {
    query: "Arc network blockchain Circle USDC native gas token",
    question: "On Circle's Arc network, what token is used to pay gas?",
    choices: ["ETH", "ARC", "USDC", "MATIC"],
    answer: "C",
    topic: "Arc gas token",
  },
  {
    query: "x402 protocol HTTP status code payment required",
    question: "The x402 payment protocol is built on which HTTP status code?",
    choices: ["302", "402", "404", "418"],
    answer: "B",
    topic: "x402 status code",
  },
  {
    query: "Bitcoin maximum supply 21 million coins cap",
    question: "What is the maximum supply of Bitcoin?",
    choices: ["1 billion", "100 million", "21 million", "unlimited"],
    answer: "C",
    topic: "Bitcoin supply cap",
  },
  {
    query: "Solana blockchain native token SOL",
    question: "What is the native token of the Solana blockchain?",
    choices: ["SOL", "SUI", "AVAX", "DOT"],
    answer: "A",
    topic: "Solana token",
  },
  {
    query: "Circle CCTP cross-chain transfer protocol burns and mints USDC",
    question: "Circle's CCTP moves USDC across chains by which mechanism?",
    choices: ["Lock and wrap", "Burn and mint", "Atomic swap", "Liquidity pool"],
    answer: "B",
    topic: "CCTP mechanism",
  },
  {
    query: "ERC-8004 agent identity registry standard ethereum",
    question: "ERC-8004 is a standard for what on Ethereum?",
    choices: ["Stablecoins", "Agent identity", "NFT royalties", "Token vesting"],
    answer: "B",
    topic: "ERC-8004",
  },
  {
    query: "most recent Lionel Messi club team Inter Miami",
    question: "Which club does Lionel Messi play for?",
    choices: ["Barcelona", "PSG", "Inter Miami", "Newell's Old Boys"],
    answer: "C",
    topic: "Messi club",
  },
  {
    query: "USDC stablecoin pegged to which currency US dollar",
    question: "USDC is pegged to which asset?",
    choices: ["Euro", "US Dollar", "Gold", "Bitcoin"],
    answer: "B",
    topic: "USDC peg",
  },
  {
    query: "Base blockchain layer 2 built by Coinbase on Optimism stack",
    question: "The Base L2 network was launched by which company?",
    choices: ["Coinbase", "Binance", "Kraken", "Circle"],
    answer: "A",
    topic: "Base launcher",
  },
  {
    query: "Polymarket prediction market platform blockchain Polygon",
    question: "Polymarket is a prediction-market platform built primarily on which chain?",
    choices: ["Ethereum mainnet", "Polygon", "Solana", "Arbitrum"],
    answer: "B",
    topic: "Polymarket chain",
  },
  {
    query: "EIP-1559 base fee burned ethereum transaction",
    question: "Under EIP-1559, what happens to the base fee of an Ethereum transaction?",
    choices: ["Paid to miners", "Burned", "Refunded", "Sent to treasury"],
    answer: "B",
    topic: "EIP-1559 base fee",
  },
];

const CHOICES = ["A", "B", "C", "D"] as const;

const RESEARCH_PRESENTATION: PuzzlePresentation = {
  family: "RESEARCH",
  difficulty: 3,
  format: "choice",
  choices: CHOICES,
  // Generous time so the agent can run the paid search, read results, answer.
  timeLimitSec: 60,
  toolsAllowed: "calc+web",
};

/// Pick a research puzzle by seed. Shares the round's `used` set so a round
/// never repeats an item.
export function researchPuzzle(r: () => number, used: Set<string>): Puzzle {
  let idx = pick(r, RESEARCH_BANK.length);
  const key = (i: number) => `research:${i}`;
  for (let attempts = 0; attempts < 8 && used.has(key(idx)); attempts++) {
    idx = pick(r, RESEARCH_BANK.length);
  }
  used.add(key(idx));
  const item = RESEARCH_BANK[idx] ?? RESEARCH_BANK[0]!;

  const prompt = [
    `Question (${item.topic}): ${item.question}`,
    `A) ${item.choices[0]}`,
    `B) ${item.choices[1]}`,
    `C) ${item.choices[2]}`,
    `D) ${item.choices[3]}`,
    "",
    `If the SEARCH RESULTS above carry the answer, use them. Search query to run: "${item.query}".`,
    "Finish with exactly one letter on its own line: A, B, C, or D. Commit to one even if you are unsure; never reply that you lack data.",
  ].join("\n");

  return {
    kind: "research",
    prompt,
    expected: item.answer,
    presentation: RESEARCH_PRESENTATION,
  };
}

/// Build the Exa search payload term. Research now points at Exa's web search
/// (POST { query }), so the runner reads the embedded query and sends it.
export function extractSearchTerm(prompt: string): string | null {
  const m = prompt.match(/query to run:\s*"([^"]+)"/i);
  return m && m[1] ? m[1] : null;
}
