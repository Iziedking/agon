"use client";

import { useState } from "react";
import { useOperatorAddress } from "@/hooks/useAuth";
import { useArcWrite } from "@/hooks/useArcWrite";
import { CONTRACTS, publicClient } from "@/lib/arc";
import { challengeArenaAbi, CHALLENGE_KIND, nextChallengeId } from "@/lib/challenges";
import { friendlyError } from "@/lib/errors";
import { reportEvent } from "@/lib/report";
import { ModalClose } from "@/components/redesign";

/// Create-challenge modal reskinned to arcrun-redesign. Flat ink-on-canvas
/// surface, stencil heading, tag-style kind picker, mono inputs with hairline
/// borders, flat pink tag CTA. No rounded pills, no bubble heading, no shadow.

const NOTCH = "polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%)";

const inputCls =
  "w-full border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2 font-mono text-sm text-ink outline-none transition-colors focus:border-ink";
const labelCls = "font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3";

export function CreateChallengeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { address } = useOperatorAddress();
  const { writeContractAsync } = useArcWrite();
  const [kind, setKind] = useState(0);
  const [stake, setStake] = useState("1");
  const [maxEntrants, setMaxEntrants] = useState("4");
  const [joinMin, setJoinMin] = useState("10");
  // Default resolve window bumped from 10 to 30 minutes. The coordinator
  // sweep + preview + scoring + chain receipt can spend a couple of minutes;
  // a 10-minute window left too little headroom and was cancelling
  // already-scored challenges past their deadline.
  const [resolveMin, setResolveMin] = useState("30");
  const [isPrivate, setIsPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<number | null>(null);

  if (!open) return null;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const stake6 = BigInt(Math.round(Number(stake) * 1e6));
      const max = BigInt(Math.max(2, Math.floor(Number(maxEntrants))));
      const now = Math.floor(Date.now() / 1000);
      const joinSecs = Math.max(1, Math.floor(Number(joinMin))) * 60;
      // Floor of 10 minutes on the resolve window so the coordinator has
      // enough room to lock, preview, score, and post the winner root before
      // the deadline forces a refund cancel.
      const resolveSecs = Math.max(10, Math.floor(Number(resolveMin))) * 60;
      const joinDeadline = BigInt(now + joinSecs);
      const resolveDeadline = BigInt(now + joinSecs + resolveSecs);

      const id = await nextChallengeId();
      const hash = await writeContractAsync({
        address: CONTRACTS.ChallengeArena,
        abi: challengeArenaAbi,
        functionName: "createChallenge",
        args: [kind, stake6, max, joinDeadline, resolveDeadline, isPrivate],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setCreatedId(id);
      reportEvent("challenge_create", { context: { id, kind, stake }, address });
    } catch (e) {
      setError(friendlyError(e, "could not create the challenge."));
      reportEvent("challenge_create_error", {
        level: "error",
        message: e instanceof Error ? e.message : String(e),
        address,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-modal overflow-y-auto"
      style={{ backgroundColor: "rgba(27,17,18,0.55)" }}
      onClick={onClose}
    >
      <div className="flex min-h-full items-center justify-center px-4 py-12 sm:py-16">
        <div
          onClick={(e) => e.stopPropagation()}
          className="relative my-auto w-full max-w-[480px] border border-ink bg-canvas p-6"
        >
          {/* corner brackets */}
          <Bracket pos="tl" /><Bracket pos="tr" /><Bracket pos="bl" /><Bracket pos="br" />

          <ModalClose onClick={onClose} />

          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
            <span aria-hidden className="text-accent">■</span> START A CHALLENGE
          </div>
          <h2
            className="mt-3 font-stencil uppercase text-ink"
            style={{ fontSize: 28, lineHeight: 1, letterSpacing: "-0.01em" }}
          >
            CREATE A CHALLENGE
          </h2>

          {createdId !== null ? (
            <div className="mt-5">
              <p className="font-mono text-sm leading-[1.6] text-ink-2">
                challenge #{createdId} is live. other operators can stake in with their agent before the join window
                closes.
              </p>
              <div className="mt-6 flex flex-col gap-2">
                <a
                  href={`/live/challenge/${createdId}`}
                  className="inline-flex items-center justify-center gap-2 bg-accent px-4 py-2.5 font-mono text-[13px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press"
                  style={{ clipPath: NOTCH }}
                >
                  OPEN CHALLENGE <span aria-hidden>→</span>
                </a>
                <button
                  onClick={onClose}
                  className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:text-ink"
                >
                  STAY HERE
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="mt-3 font-mono text-sm leading-[1.55] text-ink-2">
                stake some USDC, set the window, let other operators take you on.
              </p>

              <div className="mt-5 flex flex-col gap-4">
                <div>
                  <div className={labelCls}>KIND</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {CHALLENGE_KIND.map((k, i) => (
                      <button
                        key={k}
                        onClick={() => setKind(i)}
                        className={
                          kind === i
                            ? "border border-accent bg-accent px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-accent-ink"
                            : "border border-ink-3 bg-canvas px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:border-ink hover:text-ink"
                        }
                      >
                        {k.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className={labelCls}>STAKE (USDC)</div>
                    <input className={`mt-1.5 ${inputCls}`} value={stake} onChange={(e) => setStake(e.target.value)} inputMode="decimal" />
                  </div>
                  <div>
                    <div className={labelCls}>MAX ENTRANTS</div>
                    <input className={`mt-1.5 ${inputCls}`} value={maxEntrants} onChange={(e) => setMaxEntrants(e.target.value)} inputMode="numeric" />
                  </div>
                  <div>
                    <div className={labelCls}>JOIN WINDOW (MIN)</div>
                    <input className={`mt-1.5 ${inputCls}`} value={joinMin} onChange={(e) => setJoinMin(e.target.value)} inputMode="numeric" />
                  </div>
                  <div>
                    <div className={labelCls}>RESOLVE WINDOW (MIN)</div>
                    <input className={`mt-1.5 ${inputCls}`} value={resolveMin} onChange={(e) => setResolveMin(e.target.value)} inputMode="numeric" />
                    <div className="mt-1 font-mono text-[10px] text-ink-3">min 10. shorter windows risk a cancel.</div>
                  </div>
                </div>

                <label className="flex items-center gap-2 font-mono text-sm text-ink-2">
                  <input
                    type="checkbox"
                    checked={isPrivate}
                    onChange={(e) => setIsPrivate(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[var(--accent)]"
                  />
                  invite-only (private)
                </label>
              </div>

              {error ? <p className="mt-4 font-mono text-xs text-[color:var(--err)]">{error}</p> : null}

              <button
                onClick={create}
                disabled={busy}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 bg-accent px-4 py-3 font-mono text-[13px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press disabled:opacity-60"
                style={{ clipPath: NOTCH }}
              >
                {busy ? "CREATING…" : "CREATE CHALLENGE"} <span aria-hidden>→</span>
              </button>
            </>
          )}
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
