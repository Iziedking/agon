"use client";

import { useEffect, useState } from "react";
import { BracketedCell } from "@/components/redesign";

/// Operator-facing Arcana hot wallet card. Surfaces what the autofund did
/// (per-tier USDC drip on Analyst contest entry), what positions the agent
/// is currently sitting on, and what's settled. Read-only — funding is
/// coordinator-driven; trades are runner-driven. Mounts on the workshop's
/// active agent so the operator can see the state at a glance.

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

interface Position {
  contest_id: number;
  market_id: number;
  title: string;
  category: string;
  side: "yes" | "no";
  stake_usdc: number;
  entry_yes_prob: number;
  current_yes_prob: number;
  tx_hash: string | null;
  claimed: boolean;
  claim_tx_hash: string | null;
  pnl_usdc: number | null;
  resolved: boolean;
  outcome: boolean | null;
  end_time: string | null;
  created_at: string;
}

interface Response {
  agent_id: number;
  open: Position[];
  settled: Position[];
  summary: {
    positions_total: number;
    open_count: number;
    settled_count: number;
    total_stake_usdc: number;
    realized_pnl_usdc: number;
    win_count: number;
    win_rate: number | null;
  };
}

export function ArcanaWalletPanel({ agentId }: { agentId: number }) {
  const [data, setData] = useState<Response | null | "loading">("loading");

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch(`${AUTH_URL}/agents/${agentId}/arcana-positions`, { cache: "no-store" });
        if (!res.ok) {
          if (alive) setData(null);
          return;
        }
        const json = (await res.json()) as Response;
        if (alive) setData(json);
      } catch {
        if (alive) setData(null);
      }
    }
    void load();
    const t = setInterval(load, 12_000);
    return () => { alive = false; clearInterval(t); };
  }, [agentId]);

  if (data === "loading") {
    return (
      <BracketedCell pad="sm">
        <p className="font-mono text-[12px] text-ink-2">reading arcana wallet…</p>
      </BracketedCell>
    );
  }
  if (data === null) {
    return (
      <BracketedCell pad="sm">
        <p className="font-mono text-[12px] text-ink-2">arcana wallet unreachable.</p>
      </BracketedCell>
    );
  }

  const recent = [...data.open.slice(0, 3), ...data.settled.slice(0, 3 - data.open.length)].slice(0, 3);
  const realized = data.summary.realized_pnl_usdc;
  const pnlColor = realized > 0 ? "var(--ok)" : realized < 0 ? "var(--err)" : "var(--ink-3)";

  return (
    <BracketedCell pad="sm">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
            <span aria-hidden className="text-accent">■</span> ARCANA WALLET
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
            AGENT #{data.agent_id}
          </span>
        </div>

        {/* Summary numbers */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="OPEN" value={`${data.summary.open_count}`} />
          <Stat label="SETTLED" value={`${data.summary.settled_count}`} />
          <Stat label="WIN RATE" value={data.summary.win_rate != null ? `${Math.round(data.summary.win_rate * 100)}%` : "—"} />
          <Stat
            label="REALIZED PnL"
            value={`${realized >= 0 ? "+" : "−"}$${Math.abs(realized).toFixed(2)}`}
            color={pnlColor}
          />
        </div>

        {/* Recent positions */}
        {recent.length === 0 ? (
          <p className="font-mono text-[11px] text-ink-3">
            no arcana positions yet. enter an analyst contest and the coordinator drips USDC into your agent's hot wallet automatically.
          </p>
        ) : (
          <div className="flex flex-col">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">RECENT POSITIONS</div>
            {recent.map((p) => (
              <PositionRow key={`${p.contest_id}-${p.market_id}-${p.side}`} pos={p} />
            ))}
          </div>
        )}
      </div>
    </BracketedCell>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="border border-[color:var(--hairline)] p-2">
      <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">{label}</div>
      <div className="mt-0.5 font-mono text-[15px] tabular-nums" style={{ color: color ?? "var(--ink)" }}>
        {value}
      </div>
    </div>
  );
}

function PositionRow({ pos }: { pos: Position }) {
  const pnl = pos.pnl_usdc != null ? pos.pnl_usdc : pnlFromMarks(pos);
  const pnlColor = pnl > 0 ? "var(--ok)" : pnl < 0 ? "var(--err)" : "var(--ink-3)";
  const sideColor = pos.side === "yes" ? "var(--accent)" : "var(--ink-2)";
  const currentPct = Math.round((pos.side === "yes" ? pos.current_yes_prob : 1 - pos.current_yes_prob) * 100);
  return (
    <div className="grid grid-cols-[auto_1fr_auto_auto] items-baseline gap-2 border-t border-[color:var(--hairline)] py-1.5 first:border-0">
      <span style={{ color: sideColor }} className="font-mono text-[10px] uppercase tracking-[0.1em]">
        {pos.side.toUpperCase()}
      </span>
      <span className="truncate font-mono text-[11px] text-ink">
        {pos.title || `Market #${pos.market_id}`}
      </span>
      <span className="font-mono text-[10px] tabular-nums text-ink-3">
        ${pos.stake_usdc.toFixed(2)} @ {currentPct}%
      </span>
      <span className="font-mono text-[10px] tabular-nums" style={{ color: pnlColor }}>
        {pnl >= 0 ? "+" : "−"}${Math.abs(pnl).toFixed(2)}
        {pos.resolved ? " ✓" : ""}
      </span>
    </div>
  );
}

function pnlFromMarks(p: Position): number {
  const entryProb = p.side === "yes" ? p.entry_yes_prob : 1 - p.entry_yes_prob;
  const currentProb = p.side === "yes" ? p.current_yes_prob : 1 - p.current_yes_prob;
  if (entryProb <= 0) return 0;
  return p.stake_usdc * (currentProb - entryProb) / entryProb;
}
