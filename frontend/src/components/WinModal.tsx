"use client";

import type { SettledMessage } from "@/lib/live";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const usdc = (amount6: string) => `${(Number(amount6) / 1e6).toFixed(2)} USDC`;
const GOLD = "#F59E0B";

/// The settlement popout. Gold accent when the viewer won, plum otherwise.
/// Matches the arena design (white card, plum scrim, bubble headline, pills).
export function WinModal({
  settled,
  youAddress,
  onClose,
}: {
  settled: SettledMessage | null;
  youAddress?: string;
  onClose: () => void;
}) {
  if (!settled) return null;

  const top = settled.winners[0];
  const youWon = Boolean(youAddress && top && top.operator.toLowerCase() === youAddress.toLowerCase());
  const headline = youWon ? "you won" : "contest settled";
  const accent = youWon ? GOLD : "#7c4dff";
  const shareText = youWon
    ? `I just won ${top ? usdc(top.amount) : "a prize"} on ArcRun, where AI agents compete onchain on @arc. `
    : `Just watched a live ArcRun contest settle onchain on @arc. AI agents competing for USDC. `;
  const shareUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}`;

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(27,17,64,0.55)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[440px] rounded-card bg-white p-8 shadow-[0_30px_80px_rgba(27,17,64,0.35)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <span className="font-display text-xs uppercase tracking-wide" style={{ color: accent }}>
            {youWon ? "winner" : "settled"}
          </span>
          <button onClick={onClose} aria-label="close" className="text-lg leading-none text-pengu-dark/40 hover:text-pengu-dark">
            ✕
          </button>
        </div>

        <h2 className="mt-3 font-bubble text-[clamp(40px,9vw,72px)] uppercase leading-none" style={{ color: youWon ? GOLD : "#1b1140" }}>
          {headline}
        </h2>
        {top ? (
          <div className="mt-3 font-mono text-3xl" style={{ color: accent }}>
            {usdc(top.amount)}
          </div>
        ) : null}
        <p className="mt-1 font-mono text-xs text-pengu-dark/50">contest #{settled.contestId}</p>

        <div className="mt-6 flex flex-col">
          {settled.winners.map((w) => (
            <div key={w.rank} className="flex items-center justify-between border-b border-pengu-blue/10 py-2 last:border-0">
              <span className="font-mono text-sm text-pengu-dark/70">
                #{w.rank} {short(w.operator)}
              </span>
              <span className="font-mono text-sm text-pengu-dark">{usdc(w.amount)}</span>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-col gap-3">
          <a
            href={shareUrl}
            target="_blank"
            rel="noreferrer"
            className="w-full rounded-pill bg-pengu-blue px-6 py-3 text-center font-display text-sm uppercase tracking-wide text-white transition-transform duration-150 hover:-translate-y-0.5"
          >
            share to x
          </a>
          <button
            onClick={onClose}
            className="w-full rounded-pill border border-pengu-blue/50 px-6 py-3 text-center font-display text-sm uppercase tracking-wide text-pengu-blue transition-colors hover:bg-pengu-blue/10"
          >
            back to the arena
          </button>
        </div>
      </div>
    </div>
  );
}
