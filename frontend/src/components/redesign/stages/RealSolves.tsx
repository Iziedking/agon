"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BracketedCell, Robot, robotVariantForId } from "@/components/redesign";
import { nameFor, skinFor, useAgentNames, useAgentSkins } from "@/hooks/useAgentNames";
import { fetchLlmRuns, type LlmRun } from "@/lib/llmRuns";

/// The live solve feed on /live/[source]/[id]. A mobile-first vertical stream:
/// newest puzzle on top, each a compact card with the question and every
/// agent's answer chip + solve time. An agent with no row yet shows "solving".
/// The expected answer is hidden while the event is live and only revealed once
/// it has settled, so the feed never spoils the race. Skipped / errored solves
/// read as a neutral pass, not an alarm.

// 8s cadence: standings stream over the WS so the stage stays real-time; this
// poll only backfills the per-answer feed underneath, which is fine slower.
const POLL_MS = 8000;

interface Props {
  /// Contest or challenge id. Both kinds live in llm_runs.contest_id.
  id: number;
  /// True once the event has settled. Gates the expected-answer reveal.
  settled?: boolean;
}

export function RealSolves({ id, settled = false }: Props) {
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

  // Group solver rows by puzzle index, newest first so the latest posted
  // puzzle sits at the top of the feed as the round grows.
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
      .sort((a, b) => b[0] - a[0])
      .map(([idx, rows]) => ({ idx, rows }));
  }, [runs]);

  // Every agent that has answered anything this round. Used so a card can show
  // a "solving" row for agents that haven't answered THAT puzzle yet.
  const agentIds = useMemo(() => {
    const set = new Set<number>();
    if (runs) for (const r of runs) if (r.kind === "solver") set.add(r.agentId);
    return Array.from(set).sort((a, b) => a - b);
  }, [runs]);
  const names = useAgentNames(agentIds);
  const skins = useAgentSkins(agentIds);

  if (puzzles.length === 0) return null;

  return (
    <div className="mt-8">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] uppercase tracking-[0.16em]">
        <span aria-hidden className="text-accent">■</span>
        <span className="text-ink-3">SOLVE FEED</span>
        <span className="text-ink">{puzzles.length} PUZZLES · {runs?.length ?? 0} ANSWERS</span>
        {!settled ? <span className="text-ink-3">· ANSWERS REVEAL AT SETTLE</span> : null}
      </div>
      <div className="flex flex-col gap-3">
        {puzzles.map(({ idx, rows }, i) => (
          <PuzzleCard
            key={idx}
            idx={idx}
            rows={rows}
            agentIds={agentIds}
            newest={i === 0 && !settled}
            settled={settled}
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
  agentIds,
  newest,
  settled,
  agentName,
  agentSkin,
}: {
  idx: number;
  rows: LlmRun[];
  agentIds: number[];
  newest: boolean;
  settled: boolean;
  agentName: (id: number) => string;
  agentSkin: (id: number) => string | null;
}) {
  const prompt = rows[0]?.prompt ?? "(no prompt)";
  const expected = rows[0]?.expected ?? null;
  const family = familyOf(prompt);
  const byAgent = new Map<number, LlmRun>();
  for (const r of rows) if (!byAgent.has(r.agentId)) byAgent.set(r.agentId, r);
  // Show every known agent so viewers see who's still solving this one.
  const order = agentIds.length > 0 ? agentIds : rows.map((r) => r.agentId);

  return (
    <BracketedCell pad="sm">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="font-stencil text-[16px] sm:text-[18px] text-ink">PUZZLE {idx + 1}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{family}</span>
        {newest ? (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-accent">
            <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-accent" /> SOLVING
          </span>
        ) : null}
        {settled && expected ? (
          <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
            ANSWER · {truncate(expected, 24)}
          </span>
        ) : null}
      </div>
      <p
        className="mt-2 whitespace-pre-wrap font-mono text-[12px] sm:text-[13px] leading-[1.5] text-ink-2"
        style={{ display: "-webkit-box", WebkitLineClamp: 10, WebkitBoxOrient: "vertical", overflow: "hidden" }}
      >
        {puzzleBody(prompt)}
      </p>
      <div className="mt-3 flex flex-col gap-1.5">
        {order.map((aid) => {
          const row = byAgent.get(aid);
          return (
            <AnswerRow
              key={`${aid}-${idx}`}
              row={row ?? null}
              agentId={aid}
              name={agentName(aid)}
              skin={agentSkin(aid)}
              live={newest}
            />
          );
        })}
      </div>
    </BracketedCell>
  );
}

function AnswerRow({
  row,
  agentId,
  name,
  skin,
  live,
}: {
  row: LlmRun | null;
  agentId: number;
  name: string;
  skin: string | null;
  /// True only for the current live frontier puzzle (the top card while the
  /// race runs). An agent with no answer there is genuinely still working, so it
  /// reads "solving…". On any older or settled card a missing answer means the
  /// agent has not reached that puzzle, which reads a calm dash, never a
  /// perpetual "solving…".
  live: boolean;
}) {
  const variant = robotVariantForId(agentId);
  return (
    <div className="flex items-center gap-2.5 border-t border-[color:var(--hairline)] pt-1.5 first:border-0 first:pt-0">
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
      {row ? (
        <Verdict row={row} />
      ) : live ? (
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">solving…</span>
      ) : (
        <span className="font-mono text-[11px] text-ink-3" title="did not reach this puzzle">—</span>
      )}
    </div>
  );
}

/// The answer chip + outcome pip. Correct reads green with the solve time;
/// wrong reads a muted miss; skipped / errored read as a calm "pass" so a
/// model that didn't commit never looks like the product broke.
function Verdict({ row }: { row: LlmRun }) {
  const finalAnswer =
    row.answer && row.answer.trim().length > 0 ? row.answer : extractAnswer(row.response, row.expected);
  const secs = row.latencyMs > 0 ? `${(row.latencyMs / 1000).toFixed(1)}s` : null;

  if (row.verdict === "correct") {
    return (
      <span className="flex flex-none items-center gap-2">
        <ResponsePopover answer={finalAnswer} response={row.response} />
        <span className="font-mono text-[11px]" style={{ color: "var(--ok)" }}>✓</span>
        {secs ? <span className="font-mono text-[10px] text-ink-3 tabular-nums">{secs}</span> : null}
      </span>
    );
  }
  if (row.verdict === "wrong") {
    return (
      <span className="flex flex-none items-center gap-2">
        <ResponsePopover answer={finalAnswer} response={row.response} />
        <span className="font-mono text-[11px] text-ink-3">✗</span>
        {secs ? <span className="font-mono text-[10px] text-ink-3 tabular-nums">{secs}</span> : null}
      </span>
    );
  }
  // skipped / error: neutral pass.
  return (
    <span className="flex flex-none items-center gap-2">
      <span className="font-mono text-[11px] text-ink-3">—</span>
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">pass</span>
    </span>
  );
}

/// Click/hover popover that shows the LLM's full chain-of-thought while
/// staying inside the viewport. The trigger shows the extracted answer only.
function ResponsePopover({ answer, response }: { answer: string; response: string }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const margin = 8;
    const desiredWidth = Math.min(560, window.innerWidth - margin * 2);
    let left = rect.right - desiredWidth;
    if (left < margin) left = margin;
    if (left + desiredWidth > window.innerWidth - margin) {
      left = window.innerWidth - desiredWidth - margin;
    }
    let top = rect.bottom + 6;
    const panelMaxHeight = Math.min(360, window.innerHeight - margin * 2);
    if (top + panelMaxHeight > window.innerHeight - margin) {
      const above = rect.top - panelMaxHeight - 6;
      if (above >= margin) top = above;
    }
    setPos({ top, left, width: desiredWidth });
  }, [open]);

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
        className="max-w-[120px] truncate border-b border-dotted border-[color:var(--hairline-strong)] font-mono text-[11px] text-ink hover:border-accent hover:text-accent"
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
          <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-ink-3">AGENT REASONING</div>
          <p className="whitespace-pre-wrap break-words">{response}</p>
        </div>
      ) : null}
    </>
  );
}

/// Best-effort puzzle family from the prompt text, for the card's kind chip.
/// Falls back to a neutral label so a new template never breaks the header.
function familyOf(prompt: string): string {
  const p = prompt.toLowerCase();
  if (p.includes("calldata") || p.includes("0xa9059cbb")) return "DECODE";
  if (p.includes("classify this")) return "CLASSIFY";
  if (p.includes("continue the sequence")) return "PATTERN";
  if (p.includes("count the words")) return "WORD COUNT";
  if (p.startsWith("routing") || p.includes("which pool")) return "ROUTING";
  if (p.includes("apy") || p.includes("micro-usdc") || p.includes("whole usdc remain")) return "QUANT";
  if (p.includes("research") || p.includes("search results") || p.includes("search query")) return "RESEARCH";
  if (/\n\s*a\)\s/.test(prompt.toLowerCase())) return "QUIZ";
  if (p.includes("times") || p.includes("divided") || p.includes("squared")) return "ARITHMETIC";
  return "PUZZLE";
}

/// The question plus its answer options, so a viewer can tell what "answer · C"
/// means. Strips the leading RESEARCH (search results) block the agent reads
/// and the trailing "answer with…" boilerplate, keeping the question and the
/// A/B/C/D choices. Free-form puzzles (no options) just show the question.
function puzzleBody(prompt: string): string {
  let text = prompt.trim();
  // Drop a leading "RESEARCH (...)" block up to the first blank line: that's
  // the seller's search feed the agent paid for, not the question.
  if (/^RESEARCH\b/i.test(text)) {
    const idx = text.indexOf("\n\n");
    if (idx >= 0) text = text.slice(idx + 2).trim();
  }
  // Drop instruction-only lines that aren't part of the question or options.
  const noise = /^(answer with|finish with|commit to|if the search results|search query to run)\b/i;
  const lines = text.split(/\n/).filter((l) => l.trim().length > 0 && !noise.test(l.trim()));
  const body = lines.join("\n");
  return body.length > 600 ? `${body.slice(0, 599)}…` : body;
}

function extractAnswer(response: string, expected: string | null): string {
  const cleaned = response.replace(/```[\s\S]*?```/g, " ").trim();
  if (!cleaned) return "—";

  if (expected != null) {
    const exp = expected.trim();
    if (/^[A-Da-d]$/.test(exp)) {
      const matches = Array.from(cleaned.matchAll(/\b([A-D])\b/g));
      const last = matches[matches.length - 1];
      if (last) return last[1]!;
    }
    if (/^-?\d+(?:\.\d+)?$/.test(exp)) {
      const numbers = Array.from(cleaned.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)).map((m) => m[0].replace(/,/g, ""));
      const last = numbers[numbers.length - 1];
      if (last != null) return last;
    }
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
    const buckets = ["none", "few", "some", "many"];
    if (buckets.includes(exp.toLowerCase())) {
      const lower = cleaned.toLowerCase();
      let pick: string | null = null;
      let lastIdx = -1;
      for (const w of buckets) {
        const i = lower.lastIndexOf(w);
        if (i > lastIdx) { lastIdx = i; pick = w; }
      }
      if (pick) return pick.toUpperCase();
    }
  }
  return "—";
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
