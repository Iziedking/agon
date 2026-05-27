"use client";

import { BracketedCell, Robot, robotVariantForId } from "@/components/redesign";
import { nameFor, useAgentNames } from "@/hooks/useAgentNames";
import type { StandingsEntry } from "@/lib/live";

/// Promoted stage for SOLVER contests and PUZZLE challenges. Shows:
///   - top FASTEST agent (highest correct, lowest cumulative ms tiebreak)
///   - PUZZLE TYPES THIS ROUND chip strip (gas / classify / route)
///   - per-agent row: mascot, name, full-width puzzle grid, total time
/// Falls back to a score-derived grid when progress hasn't landed yet.

const VARIANT_COLOR: Record<string, string> = {
  violet: "#7C5CFF",
  pink: "#FF3D8A",
  gold: "#D78A2B",
  mint: "#2BD4A3",
  crimson: "#E0345A",
};
const KIND_LABEL: Record<string, string> = {
  gas: "GAS PICK",
  classify: "CLASSIFY",
  route: "ROUTE",
};

export function PuzzleStage({ entries }: { entries: StandingsEntry[] }) {
  const names = useAgentNames(entries.map((e) => e.agentId));
  const maxScore = Math.max(...entries.map((e) => e.score), 1);

  // Aggregate the puzzle kinds from whichever entry carries the data first.
  // Backend sends the same kinds to every agent in a round.
  const kinds = (() => {
    for (const e of entries) {
      if (e.progress?.kind === "solver" && e.progress.puzzleKinds && e.progress.puzzleKinds.length > 0) {
        return e.progress.puzzleKinds;
      }
    }
    return null;
  })();

  // FASTEST: most correct, then lowest cumulative ms.
  const fastest = (() => {
    let best: { entry: StandingsEntry; correctCount: number; totalMs: number } | null = null;
    for (const e of entries) {
      if (e.progress?.kind !== "solver") continue;
      const cc = e.progress.correct.filter(Boolean).length;
      const ms = e.progress.perPuzzleMs?.reduce((sum, m) => sum + m, 0) ?? Infinity;
      if (!best || cc > best.correctCount || (cc === best.correctCount && ms < best.totalMs)) {
        best = { entry: e, correctCount: cc, totalMs: ms };
      }
    }
    return best;
  })();

  return (
    <div className="flex flex-col gap-5">
      {/* PUZZLE TYPES THIS ROUND */}
      {kinds ? (
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em]">
          <span className="text-ink-3">PUZZLE TYPES</span>
          {kinds.map((k, i) => (
            <span
              key={i}
              className="border border-ink-3 px-2 py-0.5 text-ink"
            >
              {KIND_LABEL[k] ?? k.toUpperCase()}
            </span>
          ))}
        </div>
      ) : null}

      {/* FASTEST leader */}
      {fastest ? (
        <BracketedCell pad="sm">
          <div className="flex items-center gap-4">
            <span aria-hidden className="text-accent">★</span>
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">FASTEST</span>
            <span className="font-stencil text-[20px] uppercase text-ink">
              {nameFor(names, fastest.entry.agentId)}
            </span>
            <span className="font-mono text-[12px] text-ink-2">
              {fastest.correctCount}/{fastest.entry.progress?.kind === "solver" ? fastest.entry.progress.total : "?"} solved
              {Number.isFinite(fastest.totalMs)
                ? ` · ${(fastest.totalMs / 1000).toFixed(2)}s`
                : ""}
            </span>
          </div>
        </BracketedCell>
      ) : null}

      {/* Per-agent rows */}
      <BracketedCell pad="sm">
        <div className="flex flex-col">
          {entries.map((e) => {
            const variant = robotVariantForId(e.agentId);
            const accent = VARIANT_COLOR[variant]!;
            const solver = e.progress?.kind === "solver" ? e.progress : null;
            const correctCount = solver ? solver.correct.filter(Boolean).length : 0;
            const totalMs = solver?.perPuzzleMs?.reduce((s, m) => s + m, 0);
            const isFastest = fastest?.entry.agentId === e.agentId;
            return (
              <div
                key={e.agentId}
                className="grid grid-cols-[2rem_auto_1fr_auto] items-center gap-4 border-b border-[color:var(--hairline)] py-3 last:border-0"
              >
                <span className={`font-stencil text-[16px] ${e.rank === 1 ? "text-accent" : "text-ink"}`}>
                  #{e.rank}
                </span>
                <div className="flex items-center gap-3">
                  <Robot variant={variant} size={28} decorative />
                  <div className="min-w-0">
                    <div className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink truncate">
                      {nameFor(names, e.agentId)}
                      {isFastest ? <span className="ml-2 text-accent">★</span> : null}
                    </div>
                    <div className="font-mono text-[10px] text-ink-3">
                      {solver ? `${correctCount}/${solver.total} solved` : "queued"}
                      {totalMs ? ` · ${(totalMs / 1000).toFixed(2)}s` : ""}
                    </div>
                  </div>
                </div>
                {/* Per-puzzle cells, full-width */}
                <PuzzleRow entry={e} accent={accent} maxScore={maxScore} />
                <span
                  key={e.score}
                  className="tick-up min-w-[64px] text-right font-mono text-[12px] tabular-nums text-ink"
                >
                  {Math.round(e.score).toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      </BracketedCell>
    </div>
  );
}

function PuzzleRow({
  entry,
  accent,
  maxScore,
}: {
  entry: StandingsEntry;
  accent: string;
  maxScore: number;
}) {
  if (entry.progress?.kind === "solver") {
    const { correct, total, perPuzzleMs } = entry.progress;
    const cells = Array.from({ length: total }, (_, i) => ({
      hit: correct[i] ?? false,
      ms: perPuzzleMs?.[i] ?? null,
    }));
    return (
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.min(total, 6)}, 1fr)` }}>
        {cells.map((c, i) => (
          <span
            key={i}
            className="relative flex aspect-square items-center justify-center text-[9px] font-mono"
            style={{
              background: c.hit ? accent : "transparent",
              border: c.hit ? `1px solid ${accent}` : "1px solid var(--hairline)",
              color: c.hit ? "#fff" : "var(--ink-3)",
            }}
            title={c.ms ? `${c.ms}ms` : ""}
          >
            {c.hit ? "✓" : i + 1}
          </span>
        ))}
      </div>
    );
  }
  // Score-derived fallback
  const pct = Math.min(1, entry.score / maxScore);
  const filled = Math.round(6 * pct);
  return (
    <div className="grid grid-cols-6 gap-1">
      {Array.from({ length: 6 }, (_, i) => (
        <span
          key={i}
          className="aspect-square"
          style={{
            background: i < filled ? accent : "transparent",
            border: i < filled ? `1px solid ${accent}` : "1px solid var(--hairline)",
          }}
        />
      ))}
    </div>
  );
}
