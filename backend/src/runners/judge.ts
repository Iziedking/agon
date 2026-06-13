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

/// Shown in the answer cell when the agent never committed to a valid answer.
/// Kept short and content-free so reasoning never leaks into the cell — the
/// full response is always one click away in the reasoning popover.
const NO_ANSWER = "—";

export function judge(puzzle: Puzzle, raw: string): JudgeOutcome {
  const cleaned = raw.replace(/```[\s\S]*?```/g, " ").trim();
  if (!cleaned) return { verdict: "error", extracted: NO_ANSWER };

  switch (puzzle.kind) {
    case "arithmetic":
    case "pattern":
    case "wordcount":
    case "quant":
    case "decode":
      return judgeNumber(cleaned, puzzle.expected);
    case "classify":
      return judgeOneOf(cleaned, ["transfer", "swap", "mint", "bridge"], puzzle.expected);
    case "routing":
      return judgeLetter(cleaned, ["a", "b", "c"], puzzle.expected);
    case "quiz":
      return judgeLetter(cleaned, ["a", "b", "c", "d"], puzzle.expected);
    case "research":
      // Research answers are a single letter A-D the agent commits to after a
      // paid web search. Extract the committed letter, not a substring match.
      return judgeLetter(cleaned, ["a", "b", "c", "d"], puzzle.expected);
    default:
      return assertNever(puzzle.kind);
  }
}

function judgeNumber(text: string, expected: string): JudgeOutcome {
  const want = Number(expected);
  const numbers = Array.from(text.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)).map((m) => m[0]);
  if (numbers.length === 0) return { verdict: "error", extracted: NO_ANSWER };
  // Take the last number in the response. LLMs that scaffold tend to end on
  // the answer; agents that just blurt the answer have one number total.
  const pickStr = numbers[numbers.length - 1]!.replace(/,/g, "");
  const got = Number(pickStr);
  if (!Number.isFinite(got)) return { verdict: "error", extracted: NO_ANSWER };
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
  if (!lastChoice) return { verdict: "error", extracted: NO_ANSWER };
  return { verdict: lastChoice === expected ? "correct" : "wrong", extracted: lastChoice };
}

/// Extract the single multiple-choice LETTER the agent committed to (A-D for
/// quiz/research, A-C for routing). The prompt tells the model to finish with
/// exactly one letter on its own line, so we read the committed letter instead
/// of substring-matching — substring matching wrongly catches a letter inside
/// an ordinary word (the C in "Canada", the d in "decision") or the English
/// article "a", which is exactly why a correct "B) Mexico ... B" was scored as
/// C before this.
function judgeLetter(text: string, valid: string[], expected: string): JudgeOutcome {
  const want = expected.trim().toLowerCase();
  const ok = new Set(valid.map((v) => v.toLowerCase()));
  const decide = (got: string): JudgeOutcome => ({
    verdict: got.toLowerCase() === want ? "correct" : "wrong",
    extracted: got.toUpperCase(),
  });

  // 1) Primary: the committed answer is a line that is just the letter. Scan
  //    from the bottom so the final answer wins. Tolerates wrapping
  //    punctuation: "B", "B)", "**B**", "(B)", "- D.", "> C".
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i]!.match(/^[\s(*_."'>-]*([a-dA-D])[\s).:,*_"'>-]*$/);
    if (m && ok.has(m[1]!.toLowerCase())) return decide(m[1]!);
  }
  // 2) Fallback: the LAST standalone UPPERCASE option letter anywhere. Uppercase
  //    only, so we never grab the article "a" or a lowercase letter buried in
  //    prose; standalone, so we never grab the C in "Canada". This catches
  //    "B) Mexico", "Answer: D", "the answer is C".
  const tokens = Array.from(text.matchAll(/(?:^|[^A-Za-z])([A-D])(?![A-Za-z])/g))
    .map((m) => m[1]!.toLowerCase())
    .filter((c) => ok.has(c));
  if (tokens.length > 0) return decide(tokens[tokens.length - 1]!);

  return { verdict: "error", extracted: NO_ANSWER };
}

function assertNever(x: PuzzleKind): never {
  throw new Error(`unhandled puzzle kind: ${String(x)}`);
}
