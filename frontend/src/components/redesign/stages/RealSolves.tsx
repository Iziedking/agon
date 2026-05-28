"use client";

import { useEffect, useMemo, useState } from "react";
import { BracketedCell, Robot, robotVariantForId } from "@/components/redesign";
import { nameFor, skinFor, useAgentNames, useAgentSkins } from "@/hooks/useAgentNames";
import { fetchLlmRuns, type LlmRun } from "@/lib/llmRuns";

/// Surfaces the real audit trail on the focused /live/[source]/[id] page.
/// Shows one card per puzzle in the round: the actual prompt text the
/// agents read, plus every agent's answer with a verdict pip. Tells the
/// "real LLM, real puzzles" story concretely instead of leaving the
/// viewer to infer it from grid cells. Renders nothing while the contest
/// is still in the open window (no solves yet).

const POLL_MS = 4000;

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
      <span className="font-mono text-[11px] text-ink-2 truncate max-w-[40%]" title={row.response}>
        {summary(row.response)}
      </span>
      <span
        className="inline-flex items-center gap-1 border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em]"
        style={{ borderColor: tone.border, color: tone.text }}
      >
        {tone.label}
      </span>
    </div>
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

function summary(response: string): string {
  const cleaned = response.replace(/\s+/g, " ").trim();
  return truncate(cleaned, 80);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
