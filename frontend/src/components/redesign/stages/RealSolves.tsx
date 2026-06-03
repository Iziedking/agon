"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BracketedCell, Robot, robotVariantForId } from "@/components/redesign";
import { nameFor, skinFor, useAgentNames, useAgentSkins } from "@/hooks/useAgentNames";
import { fetchLlmRuns, type LlmRun } from "@/lib/llmRuns";

/// Surfaces the real audit trail on the focused /live/[source]/[id] page.
/// Shows one card per puzzle in the round: the actual prompt text the
/// agents read, plus every agent's answer with a verdict pip. Tells the
/// "real LLM, real puzzles" story concretely instead of leaving the
/// viewer to infer it from grid cells. Renders nothing while the contest
/// is still in the open window (no solves yet).

// 8s cadence: standings come in via the WS so the in-flight stage stays
// real-time; this poll only backfills the audit-row panel underneath which
// is fine on a slower beat. Halves auth-service load vs the previous 4s.
const POLL_MS = 8000;

interface Props {
  /// The contest or challenge id. The backend stores both kinds in
  /// llm_runs.contest_id, so the same endpoint works for either.
  id: number;
}

export function RealSolves({ id }: Props) {
  const [runs, setRuns] = useState<LlmRun[] | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    async function load() {
      const next = await fetchLlmRuns(id);
      if (alive) setRuns(next);
    }
    void load();
    timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [id]);

  // Group by puzzle index. Each puzzle was given to every agent in the
  // round so each group has 1..N rows.
  const puzzles = useMemo(() => {
    if (!runs || runs.length === 0) return [];
    const map = new Map<number, LlmRun[]>();
    for (const r of runs) {
      if (r.kind !== "solver") continue;
      const list = map.get(r.puzzleIdx) ?? [];
      list.push(r);
      map.set(r.puzzleIdx, list);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([idx, rows]) => ({ idx, rows }));
  }, [runs]);

  const ids = useMemo(() => {
    const set = new Set<number>();
    if (runs) for (const r of runs) set.add(r.agentId);
    return Array.from(set);
  }, [runs]);
  const names = useAgentNames(ids);
  const skins = useAgentSkins(ids);

  if (puzzles.length === 0) return null;

  return (
    <div className="mt-8">
      <div className="mb-3 flex flex-wrap items-center gap-3 font-mono text-[11px] uppercase tracking-[0.16em]">
        <span aria-hidden className="text-accent">■</span>
        <span className="text-ink-3">REAL SOLVES</span>
        <span className="text-ink">{puzzles.length} PUZZLES · {runs?.length ?? 0} ANSWERS</span>
      </div>
      {/* Two puzzles per row on lg+ so a 6-puzzle round reads as a 3x2 grid
          instead of a long stack. Stacks on mobile and tablet. */}
      <div className="grid gap-3 lg:grid-cols-2">
        {puzzles.map(({ idx, rows }) => (
          <PuzzleCard
            key={idx}
            idx={idx}
            rows={rows}
            agentName={(n) => nameFor(names, n)}
            agentSkin={(n) => skinFor(skins, n)}
          />
        ))}
      </div>
    </div>
  );
}

function PuzzleCard({
  idx,
  rows,
  agentName,
  agentSkin,
}: {
  idx: number;
  rows: LlmRun[];
  agentName: (id: number) => string;
  agentSkin: (id: number) => string | null;
}) {
  const prompt = rows[0]?.prompt ?? "(no prompt)";
  const expected = rows[0]?.expected ?? null;
  return (
    <BracketedCell pad="sm">
      <div className="flex items-baseline gap-3">
        <span className="font-stencil text-[18px] text-ink">PUZZLE {idx + 1}</span>
        {expected ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
            EXPECTED · {truncate(expected, 24)}
          </span>
        ) : null}
      </div>
      <p className="mt-2 font-mono text-[13px] leading-[1.45] text-ink-2 whitespace-pre-wrap">{prompt}</p>
      <div className="mt-3 flex flex-col gap-1.5">
        {rows.map((r) => (
          <AnswerRow
            key={`${r.agentId}-${idx}`}
            row={r}
            name={agentName(r.agentId)}
            skin={agentSkin(r.agentId)}
          />
        ))}
      </div>
    </BracketedCell>
  );
}

function AnswerRow({ row, name, skin }: { row: LlmRun; name: string; skin: string | null }) {
  const variant = robotVariantForId(row.agentId);
  const tone = verdictTone(row.verdict);
  // Server-side answer wins. Older rows (pre answer-column) fall back to
  // local extraction so we still get a tight cell, not a paragraph.
  const finalAnswer = row.answer && row.answer.trim().length > 0
    ? row.answer
    : extractAnswer(row.response, row.expected);
  return (
    <div className="flex items-center gap-3 border-t border-[color:var(--hairline)] pt-1.5 first:border-0 first:pt-0">
      <span className="flex h-4 w-4 flex-none items-center justify-center overflow-hidden bg-canvas-3">
        {skin ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={skin} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
        ) : (
          <Robot variant={variant} size={16} decorative />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] uppercase tracking-[0.12em] text-ink">
        {name}
      </span>
      <ResponsePopover answer={finalAnswer} response={row.response} />
      <span
        className="inline-flex items-center gap-1 border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em]"
        style={{ borderColor: tone.border, color: tone.text }}
      >
        {tone.label}
      </span>
    </div>
  );
}

/// Click/hover popover that shows the LLM's full chain-of-thought while
/// staying inside the viewport. Replaces the browser-native `title` tooltip
/// which renders unstyled and overflows off-screen on rows near the right
/// edge of the page. The trigger shows the extracted answer only.
function ResponsePopover({ answer, response }: { answer: string; response: string }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  // Recompute the popover position so it sits below the trigger and never
  // bleeds past the viewport. Runs synchronously after the panel mounts so
  // the user never sees a flash at the wrong spot.
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const margin = 8;
    const desiredWidth = Math.min(560, window.innerWidth - margin * 2);
    let left = rect.right - desiredWidth; // right-align to the trigger
    if (left < margin) left = margin;
    if (left + desiredWidth > window.innerWidth - margin) {
      left = window.innerWidth - desiredWidth - margin;
    }
    let top = rect.bottom + 6;
    // If there's not enough room below, place above.
    const panelMaxHeight = Math.min(360, window.innerHeight - margin * 2);
    if (top + panelMaxHeight > window.innerHeight - margin) {
      const above = rect.top - panelMaxHeight - 6;
      if (above >= margin) top = above;
    }
    setPos({ top, left, width: desiredWidth });
  }, [open]);

  // Close on outside click, Escape, or scroll.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  const toggle = useCallback(() => setOpen((o) => !o), []);

  return (
    <>
      <button
        ref={triggerRef}
        onClick={toggle}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="click for the agent's reasoning"
        className="max-w-[40%] truncate border-b border-dotted border-[color:var(--hairline-strong)] font-mono text-[11px] text-ink hover:border-accent hover:text-accent"
      >
        {answer}
      </button>
      {open && pos ? (
        <div
          ref={panelRef}
          role="dialog"
          className="fixed z-50 max-h-[360px] overflow-auto border border-ink bg-canvas-2 p-3 font-mono text-[11px] leading-[1.45] text-ink shadow-[0_8px_30px_rgba(26,22,18,0.18)]"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
        >
          <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-ink-3">
            AGENT REASONING
          </div>
          <p className="whitespace-pre-wrap break-words">{response}</p>
        </div>
      ) : null}
    </>
  );
}

function verdictTone(v: LlmRun["verdict"]): { label: string; border: string; text: string } {
  switch (v) {
    case "correct":
      return { label: "CORRECT", border: "var(--ok)", text: "var(--ok)" };
    case "wrong":
      return { label: "WRONG", border: "var(--err)", text: "var(--err)" };
    case "skipped":
      return { label: "SKIPPED", border: "var(--hairline-strong)", text: "var(--ink-3)" };
    case "error":
    default:
      return { label: "ERROR", border: "var(--err)", text: "var(--err)" };
  }
}

/// Pull the final answer out of an LLM response, mirroring the backend
/// judge in `backend/src/runners/judge.ts`. The rule is "answer with a
/// single letter" or "answer with the integer only" — so the cell shows
/// only that. The full chain-of-thought stays available on hover via
/// the `title` attr.
///
/// Inference order:
///   - expected looks like a single A..D letter → return the last A..D
///   - expected parses as a number → return the last number in the response
///   - expected is one of the classify words → return the last matching word
///   - fallback → tight summary of the response (legacy behavior)
function extractAnswer(response: string, expected: string | null): string {
  const cleaned = response.replace(/```[\s\S]*?```/g, " ").trim();
  if (!cleaned) return "—";

  if (expected != null) {
    const exp = expected.trim();
    // Single A-D letter (multiple choice / routing / quiz)
    if (/^[A-Da-d]$/.test(exp)) {
      const matches = Array.from(cleaned.matchAll(/\b([A-D])\b/g));
      const last = matches[matches.length - 1];
      if (last) return last[1]!;
    }
    // Numeric
    if (/^-?\d+(?:\.\d+)?$/.test(exp)) {
      const numbers = Array.from(cleaned.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)).map((m) => m[0].replace(/,/g, ""));
      const last = numbers[numbers.length - 1];
      if (last != null) return last;
    }
    // Word from a known classify set
    const classifyWords = ["transfer", "swap", "mint", "bridge"];
    if (classifyWords.includes(exp.toLowerCase())) {
      const lower = cleaned.toLowerCase();
      let pick: string | null = null;
      let lastIdx = -1;
      for (const w of classifyWords) {
        const i = lower.lastIndexOf(w);
        if (i > lastIdx) { lastIdx = i; pick = w; }
      }
      if (pick) return pick;
    }
  }

  // Fallback: tight summary (legacy). Trims to one short line so the cell
  // isn't a paragraph even when extraction fails.
  return truncate(cleaned.replace(/\s+/g, " "), 32);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
