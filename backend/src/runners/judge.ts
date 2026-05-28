import type { Puzzle, PuzzleKind } from "./puzzles/index.js";

/// Deterministic answer checker. Extracts the agent's answer from raw LLM
/// output and compares it to the puzzle's expected answer with a
/// normalizer chosen by puzzle kind. No LLM-as-judge: the runner cost is
/// already non-zero and we don't want grading to be probabilistic.

export type Verdict = "correct" | "wrong" | "error";

export interface JudgeOutcome {
  verdict: Verdict;
  /// The normalized answer pulled out of the LLM response. Useful for the
  /// audit row and for the live-stage cell text.
  extracted: string;
}

export function judge(puzzle: Puzzle, raw: string): JudgeOutcome {
  const cleaned = raw.replace(/```[\s\S]*?```/g, " ").trim();
  if (!cleaned) return { verdict: "error", extracted: "" };

  switch (puzzle.kind) {
    case "arithmetic":
    case "pattern":
    case "wordcount":
      return judgeNumber(cleaned, puzzle.expected);
    case "classify":
      return judgeOneOf(cleaned, ["transfer", "swap", "mint", "bridge"], puzzle.expected);
    case "routing":
      return judgeOneOf(cleaned, ["a", "b", "c"], puzzle.expected.toLowerCase());
    default:
      return assertNever(puzzle.kind);
  }
}

function judgeNumber(text: string, expected: string): JudgeOutcome {
  const want = Number(expected);
  const numbers = Array.from(text.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)).map((m) => m[0]);
  if (numbers.length === 0) return { verdict: "error", extracted: text.slice(0, 32) };
  // Take the last number in the response. LLMs that scaffold tend to end on
  // the answer; agents that just blurt the answer have one number total.
  const pickStr = numbers[numbers.length - 1]!.replace(/,/g, "");
  const got = Number(pickStr);
  if (!Number.isFinite(got)) return { verdict: "error", extracted: pickStr };
  return { verdict: got === want ? "correct" : "wrong", extracted: pickStr };
}

function judgeOneOf(text: string, choices: string[], expected: string): JudgeOutcome {
  const lower = text.toLowerCase();
  // Look at the LAST mention of any choice in the response (scaffolded
  // reasoning often discusses several options before committing).
  let lastChoice: string | null = null;
  let lastIdx = -1;
  for (const c of choices) {
    const idx = lower.lastIndexOf(c);
    if (idx > lastIdx) {
      lastIdx = idx;
      lastChoice = c;
    }
  }
  if (!lastChoice) return { verdict: "error", extracted: text.slice(0, 32) };
  return { verdict: lastChoice === expected ? "correct" : "wrong", extracted: lastChoice };
}

function assertNever(x: PuzzleKind): never {
  throw new Error(`unhandled puzzle kind: ${String(x)}`);
}
