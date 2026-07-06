"use client";

import { BracketedCell } from "@/components/redesign";
import { nameFor, useAgentNames } from "@/hooks/useAgentNames";
import type { TapeEvent } from "@/lib/live";
import { explorerTxUrl, usd6, usdc6, VERB_COLOR, VERB_LABEL } from "@/lib/economyTape";

/// The live ledger every agent action streams into: a swap, an x402 payment, a
/// prediction trade, each as one row with the USDC amount and an on-chain link.
/// Newest on top. Spans all event kinds, so a viewer always sees the economy
/// working regardless of whether the round is volume, puzzle, or prediction.

const MAX_ROWS = 24;

function shortHash(h: string): string {
  return `${h.slice(0, 10)}…${h.slice(-6)}`;
}

/// Sub-cent x402 nanopayments round to 0.00 at two decimals, so show four for
/// small amounts ($0.0136) and the plain "1.23 USDC" for dollar-scale A2A buys.
function amountLabel(amount6: string): string {
  return Number(amount6 || "0") / 1e6 >= 0.01 ? usdc6(amount6) : usd6(amount6);
}

/// A real settled payment, pinned above the scrolling tape so a receipt with its
/// on-chain tx is ALWAYS on screen during a live mission, never scrolled away.
/// It is the newest tape row that carries a tx hash and a non-zero amount, so it
/// is proof, not intent. Clickable straight to the explorer.
function PinnedReceipt({ ev, name }: { ev: TapeEvent; name: string }) {
  const color = VERB_COLOR[ev.verb] ?? "#847C70";
  return (
    <a
      href={explorerTxUrl(ev.chain, ev.txHash)}
      target="_blank"
      rel="noreferrer"
      className="mb-3 flex items-center gap-3 border border-[color:var(--accent)] bg-canvas-2 px-3 py-2.5 hover:bg-canvas"
      title={`${VERB_LABEL[ev.verb]} · ${ev.label} · ${ev.chain}`}
    >
      <span className="flex h-6 w-6 flex-none items-center justify-center" style={{ background: color }} aria-hidden>
        <span className="font-mono text-[9px] text-white">{VERB_LABEL[ev.verb].slice(0, 1)}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-mono text-[9px] uppercase tracking-[0.16em] text-ink-3">LATEST RECEIPT</span>
        <span className="block truncate font-mono text-[12px] text-ink">
          {name} <span className="text-ink-3">· {VERB_LABEL[ev.verb]} · {shortHash(ev.txHash)}</span>
        </span>
      </span>
      <span className="whitespace-nowrap text-right">
        <span className="font-mono text-[14px] text-ink">{amountLabel(ev.amount6)}</span>
        <span className="ml-1 text-ink-3" aria-hidden>↗</span>
      </span>
    </a>
  );
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
  // Newest real settled payment (has a tx hash + non-zero amount), pinned so a
  // receipt is always on screen even as the tape scrolls.
  const latestReceipt = rows.find((r) => r.txHash && r.amount6 && r.amount6 !== "0");

  return (
    <div className="mt-4">
      <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
        <span aria-hidden className="text-accent">
          ■
        </span>{" "}
        LIVE TAPE
        <span className="ml-2 text-ink-3">· {rows.length} ACTIONS</span>
      </div>
      {latestReceipt ? (
        <PinnedReceipt ev={latestReceipt} name={nameFor(names, latestReceipt.agentId)} />
      ) : null}
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
