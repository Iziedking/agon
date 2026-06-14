"use client";

import { useEffect, useRef, useState } from "react";
import type { StandingsEntry, TapeEvent } from "@/lib/live";
import { deriveTapeEvents, economyTotals, tapeKey, type EconomyTotals } from "@/lib/economyTape";

/// Accumulates the economy tape across cumulative standings frames. Each frame
/// only carries an agent's most recent actions, so we keep a running map keyed
/// by tx hash (de-duped) and assign a monotonic sequence as new rows arrive.
/// Returns the rows newest-first plus the aggregate totals. Both the tape and
/// the scoreboard read this, so they always agree.
export function useEconomyTape(entries: StandingsEntry[]): {
  rows: TapeEvent[];
  totals: EconomyTotals;
} {
  const [rows, setRows] = useState<TapeEvent[]>([]);
  const seen = useRef<Map<string, TapeEvent>>(new Map());
  const seq = useRef(0);

  useEffect(() => {
    const derived = deriveTapeEvents(entries);
    if (derived.length === 0) return;
    let added = false;
    // Insert oldest-first within the frame so the newest action gets the
    // highest sequence and floats to the top of the tape.
    for (let i = derived.length - 1; i >= 0; i--) {
      const ev = derived[i]!;
      const key = tapeKey(ev);
      if (seen.current.has(key)) continue;
      seen.current.set(key, { ...ev, ts: seq.current++ });
      added = true;
    }
    if (added) {
      setRows([...seen.current.values()].sort((a, b) => b.ts - a.ts));
    }
  }, [entries]);

  return { rows, totals: economyTotals(rows) };
}
