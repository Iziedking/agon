"use client";

import { PuzzleStage } from "./PuzzleStage";
import { VolumeStage } from "./VolumeStage";
import { PredictionStage, type PinnedMarket } from "./PredictionStage";
import { CustomStage } from "./CustomStage";
import { EconomyTape } from "./EconomyTape";
import { OutputScoreboard } from "./OutputScoreboard";
import { useEconomyTape } from "@/hooks/useEconomyTape";
import type { StandingsEntry } from "@/lib/live";

/// Dispatches to the right promoted stage by event kind. The kind name comes
/// from either the contest's CONTEST_TYPE label (SCOUT / ANALYST / SOLVER)
/// or the challenge's CHALLENGE_KIND label (PREDICTION / PUZZLE / VOLUME /
/// CUSTOM). The two systems share four buckets:
///   puzzle:     SOLVER, PUZZLE
///   volume:     SCOUT,  VOLUME
///   prediction: ANALYST, PREDICTION
///   custom:     anything else

export type StageKind = "puzzle" | "volume" | "prediction" | "custom";

export function normalizeStageKind(raw: string | undefined): StageKind {
  const k = (raw ?? "").toUpperCase();
  if (k === "SCOUT" || k === "VOLUME") return "volume";
  if (k === "ANALYST" || k === "PREDICTION") return "prediction";
  if (k === "SOLVER" || k === "PUZZLE") return "puzzle";
  return "custom";
}

export function EventStage({
  kind,
  entries,
  pinnedArcanaMarkets,
}: {
  kind: StageKind;
  entries: StandingsEntry[];
  /// For prediction (Analyst Arcana) contests: the market set the coordinator
  /// pinned at open. Lets the stage render the menu before any agent enters.
  pinnedArcanaMarkets?: PinnedMarket[];
}) {
  // The economy tape + output scoreboard ride above and below EVERY kind, so
  // the "agents are really working" evidence is always on screen. The hook
  // accumulates across cumulative frames; both bands read the same data.
  const { rows, totals } = useEconomyTape(entries);

  // Volume events: the headline must agree with the per-agent bars and the
  // standings, which are cumulative. The economy-tape totals are a sliding
  // window (they drift and drop between rounds), so for volume we sum each
  // agent's cumulative volume6 and opsCount instead. paid6 stays from the tape
  // (research spend). Other kinds keep the tape totals unchanged.
  let scoreboardTotals = totals;
  if (kind === "volume") {
    // Sum per agent, DEDUPED by agentId exactly like the VolumeStage bars (which
    // key a Map by agentId, one bar per agent). Iterating entries raw would
    // double-count if a frame ever repeats an agent, making the headline read
    // larger than the sum of the bars and wobble between frames. Last write per
    // agent wins, matching the bar.
    const byAgent = new Map<number, { vol: bigint; ops: number }>();
    for (const e of entries) {
      if (e.progress?.kind !== "scout") continue;
      byAgent.set(e.agentId, {
        vol: e.progress.volume6 ? BigInt(e.progress.volume6) : 0n,
        ops: e.progress.opsCount ?? 0,
      });
    }
    let moved6 = 0n;
    let txCount = 0;
    for (const v of byAgent.values()) {
      moved6 += v.vol;
      txCount += v.ops;
    }
    scoreboardTotals = { moved6, paid6: totals.paid6, txCount };
  }

  // Puzzle events never move USDC, so the scoreboard shows the field's total
  // correct answers instead of a perpetual "0.00 USDC" headline.
  const puzzlesSolved =
    kind === "puzzle"
      ? entries.reduce(
          (sum, e) => (e.progress?.kind === "solver" ? sum + e.progress.correct.filter(Boolean).length : sum),
          0,
        )
      : 0;

  function stage() {
    // Prediction has a richer empty state: when zero entries but the round is
    // pinned, show the market menu so the audience can read what agents will
    // trade. Other kinds keep the simple "initializing" line.
    if (entries.length === 0) {
      if (kind === "prediction" && pinnedArcanaMarkets && pinnedArcanaMarkets.length > 0) {
        return <PredictionStage entries={entries} pinnedArcanaMarkets={pinnedArcanaMarkets} />;
      }
      return (
        <div className="border border-[color:var(--hairline-strong)] bg-canvas-2 p-8 text-center">
          <p className="font-mono text-sm text-ink-2">stage initializing…</p>
        </div>
      );
    }
    if (kind === "puzzle") return <PuzzleStage entries={entries} />;
    if (kind === "volume") return <VolumeStage entries={entries} />;
    if (kind === "prediction") {
      return <PredictionStage entries={entries} pinnedArcanaMarkets={pinnedArcanaMarkets} />;
    }
    return <CustomStage entries={entries} />;
  }

  // Volume already shows its own TX TAPE inside VolumeStage, so the shared
  // EconomyTape below would be a second identical ledger. For the other kinds it
  // only earns its space once there is something in it (puzzle research pays,
  // prediction trades); an empty "waiting for the first action" ledger is just
  // noise on a puzzle page, especially on mobile.
  const showTape = kind !== "volume" && rows.length > 0;
  return (
    <div>
      <OutputScoreboard totals={scoreboardTotals} kind={kind} puzzlesSolved={puzzlesSolved} />
      {stage()}
      {showTape ? <EconomyTape rows={rows} /> : null}
    </div>
  );
}
