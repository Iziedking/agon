import type { PredictionQuestion } from "./oracle.js";

/// Parse a YES/NO + confidence pair from an LLM response. Format is forgiving:
/// the LLM might write "YES, 0.8 confidence" or "I think NO. 60%" or just
/// "yes 0.7". We extract:
///   - the last YES/NO mention (case-insensitive)
///   - the last numeric confidence in [0, 1] or [0%, 100%]
/// If either is missing, we treat the call as p=0.5 (no information).

export interface ParsedPrediction {
  /// 0..1 probability the agent assigned to YES being the answer.
  p: number;
  /// Whether the agent's strongest opinion matches the actual outcome.
  correct: boolean;
}

export function judgePrediction(question: PredictionQuestion, raw: string): ParsedPrediction {
  const cleaned = raw.replace(/```[\s\S]*?```/g, " ").trim();
  const lower = cleaned.toLowerCase();

  // Find the last yes/no token. Strip word boundaries so "yesterday" doesn't
  // count as YES, but "yes" anywhere reasonable does.
  const yesIdx = lastWordIndex(lower, "yes");
  const noIdx = lastWordIndex(lower, "no");
  let call: 0 | 1 | null = null;
  if (yesIdx >= 0 && noIdx >= 0) call = yesIdx > noIdx ? 1 : 0;
  else if (yesIdx >= 0) call = 1;
  else if (noIdx >= 0) call = 0;

  // Find the last numeric confidence. Accept "0.8", "80%", "80 percent", etc.
  const confidence = extractConfidence(cleaned);

  // If the model said NO with confidence c, then p(YES) = 1 - c.
  // If the model said YES with confidence c, then p(YES) = c.
  // If no call was extracted, fall back to base rate 0.5.
  let p: number;
  if (call === 1) p = confidence;
  else if (call === 0) p = 1 - confidence;
  else p = 0.5;

  // Clamp into [0.01, 0.99] so a "100% sure but wrong" doesn't infinity-penalize.
  p = Math.max(0.01, Math.min(0.99, p));

  const correct = (p >= 0.5 ? 1 : 0) === question.outcome;
  return { p, correct };
}

function lastWordIndex(text: string, word: string): number {
  const re = new RegExp(`\\b${word}\\b`, "g");
  let last = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) last = m.index;
  return last;
}

function extractConfidence(text: string): number {
  // Try percent form first (e.g. "80%", "80 percent")
  const pctMatches = [...text.matchAll(/(\d{1,3}(?:\.\d+)?)\s*(?:%|percent)/gi)];
  if (pctMatches.length > 0) {
    const v = Number(pctMatches[pctMatches.length - 1]![1]);
    if (Number.isFinite(v) && v >= 0 && v <= 100) return v / 100;
  }
  // Otherwise look for a decimal in [0, 1]
  const decMatches = [...text.matchAll(/(?<![\d.])(0?\.\d{1,4}|1(?:\.0+)?)(?!\d)/g)];
  if (decMatches.length > 0) {
    const v = Number(decMatches[decMatches.length - 1]![1]);
    if (Number.isFinite(v) && v >= 0 && v <= 1) return v;
  }
  // Fall back to 0.6 — slightly above base rate, since the agent at least
  // committed to a side. Stops every parse-failure from looking like a
  // perfect 50/50 base-rate guess.
  return 0.6;
}
