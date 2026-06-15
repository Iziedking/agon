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
          <p className="font-mono text-sm text-ink-2">
            stage initializing… the next standings frame fills this in.
          </p>
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
  // EconomyTape below would be a second identical ledger. Render the bottom tape
  // only for the kinds whose stage has no built-in ledger (puzzle research pays,
  // prediction trades).
  return (
    <div>
      <OutputScoreboard totals={totals} />
      {stage()}
      {kind !== "volume" ? <EconomyTape rows={rows} /> : null}
    </div>
  );
}
