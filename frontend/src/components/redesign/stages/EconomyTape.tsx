"use client";

import { BracketedCell } from "@/components/redesign";
import { nameFor, useAgentNames } from "@/hooks/useAgentNames";
import type { TapeEvent } from "@/lib/live";
import { explorerTxUrl, usdc6, VERB_COLOR, VERB_LABEL } from "@/lib/economyTape";

/// The live ledger every agent action streams into: a swap, an x402 payment, a
/// prediction trade, each as one row with the USDC amount and an on-chain link.
/// Newest on top. Spans all event kinds, so a viewer always sees the economy
/// working regardless of whether the round is volume, puzzle, or prediction.

const MAX_ROWS = 24;

function shortHash(h: string): string {
  return `${h.slice(0, 10)}…${h.slice(-6)}`;
}

function TapeRow({ ev, name }: { ev: TapeEvent; name: string }) {
  const color = VERB_COLOR[ev.verb] ?? "#847C70";
  const amount = ev.amount6 && ev.amount6 !== "0" ? usdc6(ev.amount6) : "··";
  const inner = (
    <>
      <span
        className="flex h-5 w-5 flex-none items-center justify-center"
        style={{ background: color }}
        aria-hidden
      >
        <span className="font-mono text-[8px] text-white">{VERB_LABEL[ev.verb].slice(0, 1)}</span>
      </span>
      <span className="min-w-0">
        <span className="block truncate font-mono text-[11px] text-ink">
          {name} <span className="text-ink-3">· {VERB_LABEL[ev.verb]}</span>
        </span>
        <span className="block truncate font-mono text-[10px] text-ink-3">
          {ev.txHash ? shortHash(ev.txHash) : ev.label}
        </span>
      </span>
      <span className="whitespace-nowrap text-right font-mono text-[11px] text-ink">
        {amount}
        {ev.txHash ? <span className="ml-1 text-ink-3" aria-hidden>↗</span> : null}
      </span>
    </>
  );

  const cls =
    "grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-[color:var(--hairline)] py-2 last:border-0";

  return ev.txHash ? (
    <a
      href={explorerTxUrl(ev.chain, ev.txHash)}
      target="_blank"
      rel="noreferrer"
      className={`${cls} hover:bg-canvas-2`}
      title={`${VERB_LABEL[ev.verb]} · ${ev.label} · ${ev.chain}`}
    >
      {inner}
    </a>
  ) : (
    <div className={cls} title={`${VERB_LABEL[ev.verb]} · ${ev.label}`}>
      {inner}
    </div>
  );
}

export function EconomyTape({ rows }: { rows: TapeEvent[] }) {
  const names = useAgentNames(rows.map((r) => r.agentId));
  const shown = rows.slice(0, MAX_ROWS);

  return (
    <div className="mt-4">
      <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
        <span aria-hidden className="text-accent">
          ■
        </span>{" "}
        LIVE TAPE
        <span className="ml-2 text-ink-3">· {rows.length} ACTIONS</span>
      </div>
      <BracketedCell pad="sm">
        <div className="scroll-brand max-h-[360px] overflow-y-auto pr-1">
          {shown.length === 0 ? (
            <p className="px-2 py-5 font-mono text-sm text-ink-2">
              waiting for the first action. swaps, payments, and trades land here in real time.
            </p>
          ) : (
            <div className="flex flex-col">
              {shown.map((ev) => (
                <TapeRow key={`${ev.verb}-${ev.txHash || ev.label}-${ev.ts}`} ev={ev} name={nameFor(names, ev.agentId)} />
              ))}
            </div>
          )}
        </div>
      </BracketedCell>
    </div>
  );
}
