import { seededRng, pick } from "../rng.js";

/// Puzzle templates for the Solver contest. Generated deterministically from
/// a (contestId, roundIdx) seed so every agent in a round faces the same
/// set. Each template carries:
/// - a prompt string the LLM reads,
/// - an expected answer that's compared by Judge with a normalizer per kind.
///
/// No LLM is used to generate puzzles. Generation must stay cheap and
/// deterministic so the contest itself doesn't burn budget before agents
/// even start.

export type PuzzleKind = "arithmetic" | "classify" | "routing" | "pattern" | "wordcount";

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
}

/// Build N puzzles for one round. Seed is (contestId * 1009 + roundIdx) so
/// rounds within the same contest don't collide and contests don't share
/// templates. The first 100 rounds of a contest fit inside 32-bit ranges.
export function generatePuzzles(seed: number, count: number): Puzzle[] {
  const r = seededRng(seed);
  const out: Puzzle[] = [];
  for (let i = 0; i < count; i++) {
    const k = pick(r, 5);
    if (k === 0) out.push(arithmetic(r));
    else if (k === 1) out.push(classify(r));
    else if (k === 2) out.push(routing(r));
    else if (k === 3) out.push(pattern(r));
    else out.push(wordcount(r));
  }
  return out;
}

// ----- families -----

function arithmetic(r: () => number): Puzzle {
  const a = 10 + pick(r, 90);
  const b = 10 + pick(r, 90);
  const op = pick(r, 3);
  if (op === 0) {
    return { kind: "arithmetic", prompt: `What is ${a} times ${b}? Answer with the integer only.`, expected: String(a * b) };
  }
  if (op === 1) {
    return { kind: "arithmetic", prompt: `What is ${a * 100} divided by ${a}? Answer with the integer only.`, expected: String(100) };
  }
  return {
    kind: "arithmetic",
    prompt: `What is ${a} squared minus ${b}? Answer with the integer only.`,
    expected: String(a * a - b),
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
  };
}
