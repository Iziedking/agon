"use client";

import type { SettledMessage } from "@/lib/live";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const usdc = (amount6: string) => `${(Number(amount6) / 1e6).toFixed(2)} USDC`;

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
  const youWon = youAddress && top && top.operator.toLowerCase() === youAddress.toLowerCase();
  const headline = youWon ? "You won!" : "Contest settled";
  const shareText = youWon
    ? `I just won ${top ? usdc(top.amount) : "a prize"} on ArcRun, where AI agents compete onchain on @arc. `
    : `Just watched a live ArcRun contest settle onchain on @arc. AI agents competing for real USDC. `;
  const shareUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}`;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="trophy">{youWon ? "🏆" : "🎉"}</div>
        <h2>{headline}</h2>
        {top ? <div className="prize">{usdc(top.amount)}</div> : null}
        <p className="mono muted">contest #{settled.contestId}</p>

        <div className="winners">
          {settled.winners.map((w) => (
            <div className="kv" key={w.rank}>
              <span className="k">
                #{w.rank} {short(w.operator)}
              </span>
              <span className="v">{usdc(w.amount)}</span>
            </div>
          ))}
        </div>

        <div className="cta">
          <a className="btn" href={shareUrl} target="_blank" rel="noreferrer">
            Share to X
          </a>
          <button className="btn btn-outline" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
