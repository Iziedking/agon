"use client";

import { useEffect, useRef, useState } from "react";
import type { StandingsEntry, AgentProgress, TickMessage } from "@/lib/live";

/// Watches successive standings frames and surfaces a one-line "what just
/// happened" narrative for the focused /live stage. The line replaces
/// itself as new events arrive; after a quiet period the headline falls
/// back to a neutral "live · streaming" so the page never reads stale.
///
/// Without this hook the user has to interpret the bars and rows on their
/// own. With it, every tick says something concrete: "Agent #4 solved
/// puzzle 3 of 5", "Agent #7 pulled into 1st", "Agent #2 shipped 0.50
/// USDC". Same data, far more legible.

const QUIET_FALLBACK_MS = 6000;

export function useLiveNarrative(
  entries: StandingsEntry[],
  agentName: (id: number) => string,
  lastTick?: TickMessage | null,
): string {
  const prev = useRef<StandingsEntry[]>([]);
  const lastEventAt = useRef<number>(0);
  const lastTickSeen = useRef<TickMessage | null>(null);
  const [line, setLine] = useState<string>("live · waiting for first frame");

  useEffect(() => {
    if (entries.length === 0) {
      setLine("live · waiting for first frame");
      return;
    }
    const events = diffFrame(prev.current, entries, agentName);
    if (events.length > 0) {
      // Newest event wins. Could rotate through them, but a single line
      // reads cleaner on the stage.
      setLine(events[events.length - 1]!);
      lastEventAt.current = Date.now();
    }
    prev.current = entries;
  }, [entries, agentName]);

  // Tick scheduler hint: the WS pushes a {type: "tick"} the moment an
  // agent's per-tick LLM decision lands on chain. Render it immediately
  // so the narration ticks faster than the next standings broadcast.
  useEffect(() => {
    if (!lastTick) return;
    if (lastTickSeen.current === lastTick) return; // same reference, already handled
    lastTickSeen.current = lastTick;
    if (lastTick.action === "HOLD") return; // HOLD ticks aren't worth a narration beat
    const name = agentName(lastTick.agentId);
    const where = lastTick.marketId != null ? `#${lastTick.marketId}` : "";
    const verb =
      lastTick.action === "OPEN_YES" || lastTick.action === "HEDGE_YES" ? "bet YES" : "bet NO";
    const flavor = lastTick.action.startsWith("HEDGE") ? "hedged " : "";
    setLine(`${name} ${flavor}${verb} on ${where}`.trim());
    lastEventAt.current = Date.now();
  }, [lastTick, agentName]);

  // After a quiet period, soften the line so it doesn't show a stale event
  // as the most-recent thing for minutes on end.
  useEffect(() => {
    const t = setInterval(() => {
      if (Date.now() - lastEventAt.current > QUIET_FALLBACK_MS) {
        setLine("live · streaming standings");
      }
    }, 2000);
    return () => clearInterval(t);
  }, []);

  return line;
}

function diffFrame(
  before: StandingsEntry[],
  after: StandingsEntry[],
  agentName: (id: number) => string,
): string[] {
  const out: string[] = [];
  const byId = new Map<number, StandingsEntry>();
  for (const b of before) byId.set(b.agentId, b);

  for (const a of after) {
    const b = byId.get(a.agentId);
    const name = agentName(a.agentId);

    if (!b) {
      // First time we've seen this agent in standings.
      out.push(`${name} joined the stage`);
      continue;
    }

    // Rank flip into the lead.
    if (a.rank === 1 && b.rank !== 1) {
      out.push(`${name} pulled into 1st`);
    } else if (a.rank < b.rank && a.rank <= 3) {
      out.push(`${name} moved up to #${a.rank}`);
    }

    // Per-kind progress diffs.
    const pa = a.progress;
    const pb = b.progress;
    if (pa && pb && pa.kind === pb.kind) {
      if (pa.kind === "solver" && pb.kind === "solver") {
        const newCorrect = pa.correct.filter(Boolean).length;
        const oldCorrect = pb.correct.filter(Boolean).length;
        if (newCorrect > oldCorrect) {
          out.push(`${name} solved ${newCorrect} of ${pa.total}`);
        }
      } else if (pa.kind === "analyst" && pb.kind === "analyst") {
        // Arcana branch first — when a real position lands or resolves it's
        // way more interesting than a synthetic call.
        const aArc = pa.arcana ?? [];
        const bArc = pb.arcana ?? [];
        if (aArc.length > bArc.length) {
          const fresh = aArc[aArc.length - 1]!;
          const usd = (Number(BigInt(fresh.stakeUsdc)) / 1e6).toFixed(2);
          out.push(`${name} bet $${usd} ${fresh.side.toUpperCase()} on #${fresh.marketId}`);
        } else if (aArc.length === bArc.length && aArc.length > 0) {
          // No new positions; surface a resolution flip if one landed.
          for (let i = 0; i < aArc.length; i++) {
            const aP = aArc[i]!;
            const bP = bArc[i]!;
            if (aP.resolved && !bP.resolved) {
              const pnl = Number(BigInt(aP.mtmPnLUsdc6)) / 1e6;
              const sign = pnl >= 0 ? "+" : "−";
              out.push(`${name} settled #${aP.marketId} ${sign}$${Math.abs(pnl).toFixed(2)}`);
              break;
            }
          }
        } else if (pa.calls.length > pb.calls.length) {
          const latest = pa.calls[pa.calls.length - 1];
          if (latest) {
            out.push(`${name} called ${Math.round(latest.p * 100)}% confidence`);
          }
        }
      } else if (pa.kind === "scout" && pb.kind === "scout") {
        if (pa.opsCount > pb.opsCount) {
          const newOps = pa.opsCount - pb.opsCount;
          out.push(`${name} shipped ${newOps} tx${newOps === 1 ? "" : "s"}`);
        }
      }
    }
  }

  return out;
}

/// Narrative for a settled event. Surfaces the winner and runner-up if any
/// so the page reads "Agent X won 25.00 USDC" instead of switching to a
/// blank.
export function settledNarrative(
  winners: Array<{ rank: number; operator: string; amount: string }>,
  agentForOperator?: (op: string) => string,
): string {
  if (winners.length === 0) return "settled · no winners this round";
  const top = winners[0]!;
  const who = agentForOperator?.(top.operator) ?? short(top.operator);
  const amount = formatUsdc6(top.amount);
  return `${who} won ${amount}`;
}

function short(addr: string): string {
  if (addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatUsdc6(raw: string): string {
  try {
    const n = Number(BigInt(raw)) / 1e6;
    return `${n.toFixed(2)} USDC`;
  } catch {
    return raw;
  }
}

/// Helper: extract a human total from agent progress so the standings row
/// can show "3/5 solved" or "12 tx" instead of just the score number.
export function progressSummary(p: AgentProgress | undefined): string | null {
  if (!p) return null;
  if (p.kind === "solver") return `${p.correct.filter(Boolean).length}/${p.total} solved`;
  if (p.kind === "analyst") {
    const arc = p.arcana ?? [];
    if (arc.length > 0) {
      const totalStake = arc.reduce((acc, x) => acc + Number(BigInt(x.stakeUsdc)) / 1e6, 0);
      const totalPnl = arc.reduce((acc, x) => acc + Number(BigInt(x.mtmPnLUsdc6)) / 1e6, 0);
      const sign = totalPnl >= 0 ? "+" : "−";
      return `${arc.length} pos · $${totalStake.toFixed(2)} stake · ${sign}$${Math.abs(totalPnl).toFixed(2)}`;
    }
    return `${p.calls.length} call${p.calls.length === 1 ? "" : "s"}`;
  }
  if (p.kind === "scout") return `${p.opsCount} tx`;
  return null;
}
