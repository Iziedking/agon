import { seededRng, pick } from "../rng.js";
import { QUIZ_BANK, type QuizQuestion } from "./quizBank.js";
import { researchPuzzle } from "./research.js";

/// Puzzle templates for the Solver contest. Generated deterministically from
/// a (contestId, roundIdx) seed so every agent in a round faces the same
/// set. Each template carries:
/// - a prompt string the LLM reads,
/// - an expected answer that's compared by Judge with a normalizer per kind.
///
/// No LLM is used to generate puzzles. Generation must stay cheap and
/// deterministic so the contest itself doesn't burn budget before agents
/// even start.

export type PuzzleKind = "arithmetic" | "classify" | "routing" | "pattern" | "wordcount" | "quiz" | "research";

/// Standardized presentation metadata. Every puzzle, regardless of family,
/// surfaces on the live stage with the same six fields so the audience reads
/// the same shape every time. The variant is in the question text, not the
/// chrome. See docs/brandkit/11-realism-plan.md "Solver track".
export interface PuzzlePresentation {
  /// Capitalized family tag for the chrome ("QUIZ", "ARITHMETIC", etc).
  family: string;
  /// 1 = easy, 2 = medium, 3 = hard. Used by tier-segregated routing.
  difficulty: 1 | 2 | 3;
  /// Shape of the expected answer. Drives the answer input on the live stage.
  format: "integer" | "single_word" | "phrase" | "choice";
  /// Choice labels when format = "choice"; otherwise undefined.
  choices?: readonly string[];
  /// Seconds the agent has before its answer is marked timeout. Pure display
  /// today; runner enforcement comes with the tier-segregated routing pass.
  timeLimitSec: number;
  /// Lowest-tool tier that can answer this honestly. "none" = mental, "calc"
  /// = code_execution helps, "calc+web" = web_search helps. Used by the
  /// tier-segregated puzzle router so a tier 1 contest never draws web items.
  toolsAllowed: "none" | "calc" | "calc+web";
}

export interface Puzzle {
  /// One of a small set so the stage can display "ARITHMETIC", "ROUTING",
  /// etc. above each panel.
  kind: PuzzleKind;
  /// The text the LLM sees. Self-contained: includes any context needed.
  prompt: string;
  /// The expected answer. Comparison is normalized per kind (numbers parsed,
  /// strings lowercased + trimmed, etc.) so the LLM has reasonable latitude
  /// in formatting.
  expected: string;
  /// Standardized presentation for the live stage. Built by each family
  /// generator so the audience reads one consistent card across all puzzles.
  presentation: PuzzlePresentation;
}

/// Build N puzzles for one round. Seed is (contestId * 1009 + roundIdx) so
/// rounds within the same contest don't collide and contests don't share
/// templates. The first 100 rounds of a contest fit inside 32-bit ranges.
///
/// Quiz is weighted up so the demo features it prominently (about half of
/// every round). Each quiz question is drawn from QUIZ_BANK with the same
/// seed-derived index, so a 60+ question bank means a 5-puzzle round rarely
/// reuses questions within the same contest.
export function generatePuzzles(seed: number, count: number): Puzzle[] {
  const r = seededRng(seed);
  const out: Puzzle[] = [];
  // Track quiz indices used in this round so a round of N puzzles doesn't
  // pick the same quiz question twice. Cross-round duplicates are still
  // possible but at low probability with a 60+ bank.
  const usedQuizIndices = new Set<number>();
  // Track research items used so a round doesn't repeat one. Distinct set
  // from the quiz dedupe because research keys live in their own namespace.
  const usedResearch = new Set<string>();
  // Research weight is opt-in via NANOPAY_ENABLED. When off, the generator
  // falls back to the legacy mix so testnet dev without Circle CLI still
  // produces a complete round. When on, research items take 4 of 12 slots
  // so a typical round shows the spend mechanic prominently.
  const includeResearch = process.env.NANOPAY_ENABLED === "true" || process.env.NANOPAY_ENABLED === "1";
  for (let i = 0; i < count; i++) {
    if (includeResearch) {
      // 10 buckets: 5 research (50%), 3 quiz, 1 arithmetic, 1 classify.
      // The 50% research weighting brings the demo's expected
      // P(zero research in 6 puzzles) down to ~1.6%, so judges almost
      // always see Nanopayments fire. Routing / pattern / wordcount drop
      // out at this weight — they were 1/12 each and rarely visible.
      const k = pick(r, 10);
      if (k < 5) out.push(researchPuzzle(r, usedResearch));
      else if (k < 8) out.push(quiz(r, usedQuizIndices));
      else if (k === 8) out.push(arithmetic(r));
      else out.push(classify(r));
    } else {
      // Legacy mix: 10 buckets, 5 quiz, 1 each for the five locally-solvable
      // families. Identical to the pre-Nanopay generator.
      const k = pick(r, 10);
      if (k < 5) out.push(quiz(r, usedQuizIndices));
      else if (k === 5) out.push(arithmetic(r));
      else if (k === 6) out.push(classify(r));
      else if (k === 7) out.push(routing(r));
      else if (k === 8) out.push(pattern(r));
      else out.push(wordcount(r));
    }
  }
  return out;
}

// ----- quiz family -----

const LETTERS = ["A", "B", "C", "D"] as const;

function quiz(r: () => number, used: Set<number>): Puzzle {
  let idx = pick(r, QUIZ_BANK.length);
  // Skip already-used indices in this round. Bounded loop so we never spin
  // forever even if the bank is misconfigured.
  for (let attempts = 0; attempts < 8 && used.has(idx); attempts++) {
    idx = pick(r, QUIZ_BANK.length);
  }
  used.add(idx);
  const q: QuizQuestion = QUIZ_BANK[idx] ?? QUIZ_BANK[0]!;
  const lines = [
    q.question,
    `A) ${q.choices[0]}`,
    `B) ${q.choices[1]}`,
    `C) ${q.choices[2]}`,
    `D) ${q.choices[3]}`,
    "Answer with a single letter: A, B, C, or D.",
  ];
  return {
    kind: "quiz",
    prompt: lines.join("\n"),
    expected: LETTERS[q.correctIndex],
    presentation: {
      family: "QUIZ",
      difficulty: 2,
      format: "choice",
      choices: ["A", "B", "C", "D"],
      timeLimitSec: 30,
      // Quiz items are factual recall; web_search dominates here, calc adds
      // nothing. Route quiz items to tier-4-eligible contests only on the
      // hardcore tier-4-only tier-segregated runs.
      toolsAllowed: "calc+web",
    },
  };
}

// ----- families -----

const ARITHMETIC_PRESENTATION: PuzzlePresentation = {
  family: "ARITHMETIC",
  difficulty: 1,
  format: "integer",
  timeLimitSec: 20,
  // Mental math; calc helps but isn't required, no-tool agents can still
  // win on these.
  toolsAllowed: "none",
};

function arithmetic(r: () => number): Puzzle {
  const a = 10 + pick(r, 90);
  const b = 10 + pick(r, 90);
  const op = pick(r, 3);
  if (op === 0) {
    return { kind: "arithmetic", prompt: `What is ${a} times ${b}? Answer with the integer only.`, expected: String(a * b), presentation: ARITHMETIC_PRESENTATION };
  }
  if (op === 1) {
    return { kind: "arithmetic", prompt: `What is ${a * 100} divided by ${a}? Answer with the integer only.`, expected: String(100), presentation: ARITHMETIC_PRESENTATION };
  }
  return {
    kind: "arithmetic",
    prompt: `What is ${a} squared minus ${b}? Answer with the integer only.`,
    expected: String(a * a - b),
    presentation: ARITHMETIC_PRESENTATION,
  };
}

const TX_LABELS = ["transfer", "swap", "mint", "bridge"] as const;

function classify(r: () => number): Puzzle {
  const k = pick(r, TX_LABELS.length);
  const label = TX_LABELS[k]!;
  const hints: Record<(typeof TX_LABELS)[number], string> = {
    transfer:
      "calldata starts with 0xa9059cbb (ERC-20 transfer selector), destination is an EOA, value is 0",
    swap:
      "calldata starts with 0x38ed1739 (swapExactTokensForTokens selector), destination is a router, four token addresses appear in the input",
    mint:
      "calldata starts with 0x40c10f19 (mint selector), destination is an ERC-721 contract, no value transferred",
    bridge:
      "calldata starts with 0xeb672419 (depositERC20 selector), destination is a canonical bridge address, tokens lock for L1->L2",
  };
  return {
    kind: "classify",
    prompt: `Classify this Ethereum transaction. The ${hints[label]}. Answer with one word, lowercase: transfer, swap, mint, or bridge.`,
    expected: label,
    presentation: {
      family: "CLASSIFY",
      difficulty: 2,
      format: "choice",
      choices: ["transfer", "swap", "mint", "bridge"],
      timeLimitSec: 25,
      toolsAllowed: "none",
    },
  };
}

function routing(r: () => number): Puzzle {
  // Three pools, each with (fee %, slippage %). Output = 100 * (1 - fee - slippage).
  const pools = [
    { name: "A", fee: 0.05 + (pick(r, 50) / 100), slippage: 0.1 + (pick(r, 200) / 100) },
    { name: "B", fee: 0.05 + (pick(r, 50) / 100), slippage: 0.1 + (pick(r, 200) / 100) },
    { name: "C", fee: 0.05 + (pick(r, 50) / 100), slippage: 0.1 + (pick(r, 200) / 100) },
  ];
  const outs = pools.map((p) => 100 * (1 - p.fee / 100 - p.slippage / 100));
  let bestIdx = 0;
  for (let i = 1; i < outs.length; i++) if (outs[i]! > outs[bestIdx]!) bestIdx = i;
  const lines = pools
    .map((p) => `Pool ${p.name}: fee ${p.fee.toFixed(2)}%, slippage ${p.slippage.toFixed(2)}%`)
    .join("; ");
  return {
    kind: "routing",
    prompt: `Routing 100 USDC. ${lines}. Which pool gives the highest output? Answer with one letter: A, B, or C.`,
    expected: pools[bestIdx]!.name,
    presentation: {
      family: "ROUTING",
      difficulty: 2,
      format: "choice",
      choices: ["A", "B", "C"],
      timeLimitSec: 25,
      // Code execution helps with the small comparison math; web doesn't.
      toolsAllowed: "calc",
    },
  };
}

function pattern(r: () => number): Puzzle {
  const start = 1 + pick(r, 5);
  const step = 2 + pick(r, 4);
  const seq: number[] = [];
  for (let i = 0; i < 5; i++) seq.push(start * Math.pow(step, i));
  const next = start * Math.pow(step, 5);
  return {
    kind: "pattern",
    prompt: `Continue the sequence: ${seq.join(", ")}. What is the next number? Answer with the integer only.`,
    expected: String(next),
    presentation: {
      family: "PATTERN",
      difficulty: 2,
      format: "integer",
      timeLimitSec: 25,
      toolsAllowed: "calc",
    },
  };
}

const SENTENCES = [
  "the quick brown fox jumps over the lazy dog",
  "arc is a high throughput chain with usdc native gas",
  "agents compete in contests to win usdc prize pools",
  "syndicates roll reputation into a weekly war",
  "a higher tier agent runs on a smarter model brain",
];

function wordcount(r: () => number): Puzzle {
  const idx = pick(r, SENTENCES.length);
  const s = SENTENCES[idx]!;
  const n = s.trim().split(/\s+/).length;
  return {
    kind: "wordcount",
    prompt: `Count the words: "${s}". Answer with the integer only.`,
    expected: String(n),
    presentation: {
      family: "WORD COUNT",
      difficulty: 1,
      format: "integer",
      timeLimitSec: 15,
      toolsAllowed: "none",
    },
  };
}
