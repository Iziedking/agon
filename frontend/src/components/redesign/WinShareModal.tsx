"use client";

import { useState } from "react";
import { ModalClose } from "@/components/redesign";

/// The win-share card. Pops the instant the operator's wallet appears in a
/// settled contest's or challenge's winner list. Bracketed surface, stencil
/// "YOU PLACED" + rank, prize in stencil display face, mono description,
/// two tag CTAs (SHARE TO X primary, OPEN PRIZE secondary).

const NOTCH = "polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%)";

const usdc = (amount6: string) => `${(Number(amount6) / 1e6).toFixed(2)} USDC`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export interface WinShareModalProps {
  /// "contest" for campaign settles, "challenge" for peer-stake settles.
  source: "contest" | "challenge";
  /// The contest or challenge id, used in the OPEN PRIZE link + the tweet.
  id: number;
  /// The full winner list straight from the settled frame.
  winners: Array<{ rank: number; operator: string; amount: string }>;
  /// The connected wallet (lowercased ok); used to find the operator's row.
  youAddress: string;
  onClose: () => void;
}

function tweetText(
  source: "contest" | "challenge",
  amount: string,
  rank: number,
  id: number,
  shareUrl: string,
): string {
  const place =
    rank === 1 ? "won" : rank === 2 ? "took 2nd" : rank === 3 ? "took 3rd" : `placed #${rank}`;
  const label = source === "contest" ? `arcrun campaign #${id}` : `arcrun challenge #${id}`;
  // The link is the share route, so X unfurls the personalized win card.
  return `I just ${place} ${amount} in ${label}, where AI agents compete onchain on @arc.\n\n${shareUrl}`;
}

export function WinShareModal({ source, id, winners, youAddress, onClose }: WinShareModalProps) {
  const [cardError, setCardError] = useState(false);
  const me = youAddress.toLowerCase();
  const my = winners.find((w) => w.operator.toLowerCase() === me);
  if (!my) return null;

  const amount = usdc(my.amount);
  const heading =
    my.rank === 1 ? "YOU WON"
    : my.rank === 2 ? "YOU TOOK 2ND"
    : my.rank === 3 ? "YOU TOOK 3RD"
    : `YOU PLACED #${my.rank}`;

  const detailHref = source === "contest" ? `/contests/${id}` : `/challenges/${id}`;
  // Absolute share-route URL so the tweet's link unfurls the personalized win
  // card. origin keeps it correct across prod and preview deploys.
  const origin = typeof window !== "undefined" ? window.location.origin : "https://arcrun.xyz";
  const shareUrl = `${origin}/share/${source}/${id}/${my.operator}`;
  // The same dynamic card the link unfurls to, shown in the modal and
  // downloadable so the branded win image is always in hand even when X is
  // slow to fetch the unfurl. X's compose intent can't attach media itself.
  const cardUrl = `${shareUrl}/opengraph-image`;
  const shareHref = `https://x.com/intent/tweet?text=${encodeURIComponent(tweetText(source, amount, my.rank, id, shareUrl))}`;

  const label = source === "contest" ? "CAMPAIGN" : "CHALLENGE";

  return (
    <div
      className="fixed inset-0 z-modal overflow-y-auto"
      style={{ backgroundColor: "rgba(27,17,18,0.55)" }}
      onClick={onClose}
    >
      <div className="flex min-h-full items-center justify-center px-4 py-12 sm:py-16">
        <div
          onClick={(e) => e.stopPropagation()}
          className="relative my-auto w-full max-w-[520px] border border-ink bg-canvas p-7"
        >
          <Bracket pos="tl" /><Bracket pos="tr" /><Bracket pos="bl" /><Bracket pos="br" />

          <ModalClose onClick={onClose} />

          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
            <span aria-hidden className="text-accent">■</span>
            {label} #{id} · SETTLED ONCHAIN
          </div>

          <h2
            className="mt-3 font-stencil uppercase text-ink"
            style={{ fontSize: "clamp(40px, 7vw, 64px)", lineHeight: 0.95, letterSpacing: "-0.01em" }}
          >
            {heading}
          </h2>

          <div className="mt-4">
            <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">YOUR PRIZE</div>
            <div
              className="mt-1 font-stencil text-accent"
              style={{ fontSize: "clamp(40px, 7vw, 64px)", lineHeight: 1, letterSpacing: "-0.02em" }}
            >
              {amount}
            </div>
          </div>

          {winners.length > 1 ? (
            <div className="mt-6">
              <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">FIELD</div>
              <div className="mt-2 flex flex-col">
                {winners.slice(0, 5).map((w) => {
                  const isMe = w.operator.toLowerCase() === me;
                  return (
                    <div
                      key={w.rank}
                      className="flex items-center gap-3 border-b border-[color:var(--hairline)] py-2 last:border-0"
                    >
                      <span className="font-stencil text-[18px] text-ink">#{w.rank}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">
                        {short(w.operator)}{isMe ? " · YOU" : ""}
                      </span>
                      <span className="font-mono text-[12px] text-ink">{usdc(w.amount)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* The branded win card with the operator's pfp. This is exactly what
              the X link unfurls to; we show a tidy preview and offer a download
              so the image is always in hand. Kept small (max 340px) so it
              doesn't dominate the modal, and an error state replaces the broken
              image icon if the card route is briefly unavailable. */}
          <div className="mt-6">
            <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">YOUR CARD</div>
            <div
              className="relative mt-2 w-full max-w-[340px] overflow-hidden border border-[color:var(--hairline-strong)] bg-canvas-2"
              style={{ aspectRatio: "1200 / 630" }}
            >
              {cardError ? (
                <div className="flex h-full w-full items-center justify-center px-3 text-center font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
                  card preview unavailable · use download
                </div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cardUrl}
                  alt="your ArcRun win card"
                  onError={() => setCardError(true)}
                  className="block h-full w-full object-cover"
                  loading="lazy"
                />
              )}
            </div>
            <a
              href={cardUrl}
              download={`arcrun-${source}-${id}-win.png`}
              className="mt-2 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:text-accent"
            >
              DOWNLOAD CARD <span aria-hidden>↓</span>
            </a>
          </div>

          <div className="mt-5 flex flex-col gap-2">
            <a
              href={shareHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-full items-center justify-center gap-2 bg-accent px-4 py-3 font-mono text-[13px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press"
              style={{ clipPath: NOTCH }}
            >
              SHARE TO X <span aria-hidden>→</span>
            </a>
            <a
              href={detailHref}
              className="inline-flex w-full items-center justify-center gap-2 border border-ink bg-canvas px-4 py-3 font-mono text-[13px] uppercase tracking-[0.12em] text-ink hover:bg-canvas-3"
            >
              OPEN PRIZE <span aria-hidden>→</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function Bracket({ pos }: { pos: "tl" | "tr" | "bl" | "br" }) {
  const base = {
    position: "absolute" as const,
    width: 14,
    height: 14,
    pointerEvents: "none" as const,
  };
  const ink = "var(--ink)";
  const styles = {
    tl: { ...base, top: -1, left: -1, borderTop: `1.5px solid ${ink}`, borderLeft: `1.5px solid ${ink}` },
    tr: { ...base, top: -1, right: -1, borderTop: `1.5px solid ${ink}`, borderRight: `1.5px solid ${ink}` },
    bl: { ...base, bottom: -1, left: -1, borderBottom: `1.5px solid ${ink}`, borderLeft: `1.5px solid ${ink}` },
    br: { ...base, bottom: -1, right: -1, borderBottom: `1.5px solid ${ink}`, borderRight: `1.5px solid ${ink}` },
  };
  return <span aria-hidden style={styles[pos]} />;
}
