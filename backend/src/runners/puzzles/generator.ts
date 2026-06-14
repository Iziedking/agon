import { config } from "../../config/index.js";
import { query } from "../../db/pool.js";
import { callModel, llmConfigured } from "../llm/client.js";
import { corpusForDifficulty, SOURCE_CORPUS, type CorpusFact } from "./sourceCorpus.js";
import type { Puzzle } from "./index.js";

/// LLM-generated, source-grounded, grader-verified quiz pool. The generator
/// turns one corpus fact into a varied multiple-choice question, then a SECOND
/// independent LLM call answers that question from scratch. The puzzle is only
/// stored if the grader's answer matches the generator's, so a hallucinated
/// answer can never reach a contest. Stored puzzles are deduped by content hash
/// and drawn least-recently-used first, so contests rarely repeat a question.
///
/// The model is configurable via PUZZLE_GEN_MODEL (defaults to the solver model,
/// Haiku). Generation runs in a background top-up job, never in the contest hot
/// path, so a contest pays nothing to draw a fresh, verified, sourced question.

const LETTERS = ["A", "B", "C", "D"] as const;

function genModel(): string {
  return process.env.PUZZLE_GEN_MODEL ?? config.llm.model;
}

/// FNV-1a hex hash of normalized question text, for dedupe.
function contentHash(question: string): string {
  const s = question.trim().toLowerCase().replace(/\s+/g, " ");
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

interface GenQuiz {
  question: string;
  choices: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
}

/// Pull the first JSON object out of an LLM response (handles code fences and
/// stray prose). Returns null when nothing parses.
function parseJsonObject(text: string): unknown | null {
  const fenced = text.replace(/```(?:json)?/gi, "").trim();
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1));
  } catch {
    return null;
  }
}

function validGenQuiz(v: unknown): v is GenQuiz {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.question !== "string" || o.question.trim().length < 8) return false;
  if (!Array.isArray(o.choices) || o.choices.length !== 4) return false;
  if (!o.choices.every((c) => typeof c === "string" && c.trim().length > 0)) return false;
  if (typeof o.correctIndex !== "number" || o.correctIndex < 0 || o.correctIndex > 3) return false;
  // Choices must be distinct so the grader has a single right answer.
  const lower = (o.choices as string[]).map((c) => c.trim().toLowerCase());
  if (new Set(lower).size !== 4) return false;
  return true;
}

/// Generate one quiz grounded in a single fact. Null on any failure.
async function generateQuiz(fact: CorpusFact, difficulty: 1 | 2 | 3): Promise<GenQuiz | null> {
  const system = [
    "You are a quiz author for a competitive blockchain arena.",
    "Write ONE multiple-choice question grounded ONLY in the provided FACT.",
    "The question must be fully answerable from the fact alone, with exactly four options and exactly one correct.",
    "Make the wrong options plausible but clearly wrong to someone who knows the fact.",
    "Vary the angle and phrasing so questions feel fresh; never copy the fact verbatim as the question.",
    difficulty >= 3 ? "Aim for a sharp, precise question a strong agent would still have to think about." : "Keep it clear and fair.",
    'Output STRICT JSON only, no prose: {"question": string, "choices": [string,string,string,string], "correctIndex": 0-3}.',
  ].join(" ");
  try {
    const out = await callModel({
      model: genModel(),
      systemPrompt: system,
      userPrompt: `FACT: ${fact.fact}\nCATEGORY: ${fact.category}\n\nWrite the question now as JSON.`,
      maxTokens: 400,
      temperature: 0.9,
    });
    const parsed = parseJsonObject(out.text);
    return validGenQuiz(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/// Independent grader: answer the question cold, no fact provided, and return
/// the chosen index. The puzzle ships only if this matches the generator.
async function gradeQuiz(q: GenQuiz): Promise<number | null> {
  const body = [
    q.question,
    `A) ${q.choices[0]}`,
    `B) ${q.choices[1]}`,
    `C) ${q.choices[2]}`,
    `D) ${q.choices[3]}`,
    "Answer with a single letter: A, B, C, or D.",
  ].join("\n");
  try {
    const out = await callModel({
      model: genModel(),
      systemPrompt: "You answer a multiple-choice question correctly. Reply with ONLY one letter: A, B, C, or D.",
      userPrompt: body,
      maxTokens: 8,
      temperature: 0,
    });
    const m = out.text.toUpperCase().match(/[A-D]/);
    if (!m) return null;
    return LETTERS.indexOf(m[0] as (typeof LETTERS)[number]);
  } catch {
    return null;
  }
}

/// Generate, grade, and store up to `perFact` verified quizzes per corpus fact
/// for the given difficulty. Returns how many new puzzles were inserted. Safe to
/// call repeatedly: dedupe on content hash means re-runs only add fresh items.
export async function topUpQuizPool(difficulty: 1 | 2 | 3, perFact = 1): Promise<number> {
  if (!llmConfigured()) return 0;
  const facts = corpusForDifficulty(difficulty);
  let added = 0;
  for (const fact of facts) {
    for (let n = 0; n < perFact; n++) {
      const gen = await generateQuiz(fact, difficulty);
      if (!gen) continue;
      const graded = await gradeQuiz(gen);
      // Reject on disagreement: a question only ships if an independent solve
      // lands on the same answer. This is the hallucination guard.
      if (graded == null || graded !== gen.correctIndex) continue;
      const hash = contentHash(gen.question);
      const presentation = {
        family: "QUIZ",
        difficulty,
        format: "choice",
        choices: ["A", "B", "C", "D"],
        timeLimitSec: 30,
        toolsAllowed: "none",
      };
      const prompt = [
        gen.question,
        `A) ${gen.choices[0]}`,
        `B) ${gen.choices[1]}`,
        `C) ${gen.choices[2]}`,
        `D) ${gen.choices[3]}`,
        "Answer with a single letter: A, B, C, or D.",
      ].join("\n");
      const res = await query(
        `insert into generated_puzzles (content_hash, kind, prompt, expected, presentation, difficulty, source)
         values ($1, 'quiz', $2, $3, $4, $5, $6)
         on conflict (content_hash) do nothing
         returning id`,
        [hash, prompt, LETTERS[gen.correctIndex], JSON.stringify(presentation), difficulty, fact.source],
      ).catch(() => ({ rowCount: 0 }));
      if ((res as { rowCount?: number }).rowCount) added += 1;
    }
  }
  return added;
}

/// How many verified quizzes are in the pool for a difficulty band.
export async function quizPoolCount(difficulty: 1 | 2 | 3): Promise<number> {
  try {
    const { rows } = await query<{ n: string }>(
      "select count(*)::text as n from generated_puzzles where kind = 'quiz' and difficulty = $1",
      [difficulty],
    );
    return Number(rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}

interface PoolRow {
  id: string;
  prompt: string;
  expected: string;
  presentation: unknown;
  source: string | null;
}

/// Draw up to `n` least-recently-used verified quizzes for a difficulty band and
/// stamp them used so the next round pulls different ones. Returns Puzzles ready
/// to drop into a round; empty array on any miss (caller falls back to the
/// static quiz bank).
export async function drawQuizzesFromPool(difficulty: 1 | 2 | 3, n: number): Promise<Puzzle[]> {
  if (n <= 0) return [];
  try {
    const { rows } = await query<PoolRow>(
      `select id::text, prompt, expected, presentation, source
         from generated_puzzles
        where kind = 'quiz' and difficulty = $1
        order by last_used_at nulls first, id
        limit $2`,
      [difficulty, n],
    );
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    await query(
      "update generated_puzzles set last_used_at = now(), use_count = use_count + 1 where id = any($1::bigint[])",
      [ids],
    ).catch(() => 0);
    return rows.map((r) => {
      const presentation = (typeof r.presentation === "string" ? JSON.parse(r.presentation) : r.presentation) as Puzzle["presentation"];
      const puzzle: Puzzle = {
        kind: "quiz",
        prompt: r.prompt,
        expected: r.expected,
        presentation,
      };
      if (r.source) puzzle.source = r.source;
      return puzzle;
    });
  } catch {
    return [];
  }
}

/// Per-difficulty target pool size. Once a band has this many verified quizzes,
/// the top-up idles and contests just reuse them least-recently-used. Raise it
/// to grow the rotation. Generation only runs when the LLM is configured.
const POOL_TARGET = Number(process.env.PUZZLE_POOL_TARGET ?? "24");
const TOPUP_EVERY_MS = Number(process.env.PUZZLE_POOL_TOPUP_SECONDS ?? "900") * 1000;

/// Background loop that keeps the verified quiz pool stocked across the three
/// difficulty bands. Generation happens here, off the contest hot path, so a
/// contest never pays to draw a fresh, sourced, grader-checked question. No-op
/// when the LLM is unconfigured (contests stay on the deterministic templates).
export async function startPuzzlePoolTopUp(): Promise<void> {
  if (!llmConfigured()) {
    console.log("puzzle pool: LLM not configured, staying on deterministic templates");
    return;
  }
  for (;;) {
    for (const d of [1, 2, 3] as const) {
      try {
        const have = await quizPoolCount(d);
        if (have < POOL_TARGET) {
          const added = await topUpQuizPool(d, 1);
          if (added > 0) {
            console.log(`puzzle pool: +${added} verified sourced quizzes at difficulty ${d} (had ${have}, target ${POOL_TARGET})`);
          }
        }
      } catch (err) {
        console.error("puzzle pool top-up:", err instanceof Error ? err.message : err);
      }
    }
    await new Promise((r) => setTimeout(r, TOPUP_EVERY_MS));
  }
}

export { SOURCE_CORPUS };
