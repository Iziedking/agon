"use client";

import { useState } from "react";
import { zeroAddress } from "viem";
import { useOperatorAddress } from "@/hooks/useAuth";
import { useArcWrite } from "@/hooks/useArcWrite";
import { CONTRACTS, USDC, publicClient } from "@/lib/arc";
import { erc20Abi } from "@/lib/agents";
import { contestEngineAbi, fetchListingFee, metricForType, nextContestId } from "@/lib/contests";
import { friendlyError } from "@/lib/errors";
import { reportEvent } from "@/lib/report";

/// Host-campaign modal reskinned to arcrun-redesign. Same flat ink-on-canvas
/// chrome as CreateChallengeModal: bracketed surface, stencil heading, tag
/// type picker, hairline inputs, flat pink tag CTA.

const NOTCH = "polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%)";

const inputCls =
  "w-full border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2 font-mono text-sm text-ink outline-none transition-colors focus:border-ink";
const labelCls = "font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3";

const TYPES = ["SCOUT", "ANALYST", "SOLVER"] as const;

export function CreateContestModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { address } = useOperatorAddress();
  const { writeContractAsync } = useArcWrite();
  const [cType, setCType] = useState(0);
  const [pool, setPool] = useState("10");
  const [durationMin, setDurationMin] = useState("60");
  const [winnerPct, setWinnerPct] = useState("60");
  const [topN, setTopN] = useState("3");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<number | null>(null);

  if (!open) return null;

  async function create() {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      const pool6 = BigInt(Math.round(Number(pool) * 1e6));
      const duration = BigInt(Math.max(1, Math.floor(Number(durationMin))) * 60);
      const winnerCutBps = Math.min(10000, Math.max(0, Math.round(Number(winnerPct) * 100)));
      const top = Math.max(1, Math.floor(Number(topN)));
      const fee = await fetchListingFee();

      setStatus("approving USDC…");
      const approveHash = await writeContractAsync({
        address: USDC,
        abi: erc20Abi,
        functionName: "approve",
        args: [CONTRACTS.PrizeEscrow, pool6 + fee],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      setStatus("creating campaign…");
      const id = await nextContestId();
      const hash = await writeContractAsync({
        address: CONTRACTS.ContestEngine,
        abi: contestEngineAbi,
        functionName: "listContest",
        args: [cType, zeroAddress, metricForType(cType), pool6, duration, winnerCutBps, top],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setCreatedId(id);
      reportEvent("campaign_create", { context: { id, cType, pool }, address });
    } catch (e) {
      setError(friendlyError(e, "could not create the campaign."));
      reportEvent("campaign_create_error", {
        level: "error",
        message: e instanceof Error ? e.message : String(e),
        address,
      });
    } finally {
      setBusy(false);
      setStatus(null);
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
          <Bracket pos="tl" /><Bracket pos="tr" /><Bracket pos="bl" /><Bracket pos="br" />

          <button
            onClick={onClose}
            aria-label="close"
            className="absolute right-4 top-4 font-mono text-base text-ink-3 hover:text-ink"
          >
            ✕
          </button>

          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
            <span aria-hidden className="text-accent">■</span> HOST A CAMPAIGN
          </div>
          <h2
            className="mt-3 font-stencil uppercase text-ink"
            style={{ fontSize: 28, lineHeight: 1, letterSpacing: "-0.01em" }}
          >
            FUND A POOL
          </h2>

          {createdId !== null ? (
            <div className="mt-5">
              <p className="font-mono text-sm leading-[1.6] text-ink-2">
                campaign #{createdId} is live. operators can enter it now.
              </p>
              <div className="mt-6 flex flex-col gap-2">
                <a
                  href={`/live/contest/${createdId}`}
                  className="inline-flex items-center justify-center gap-2 bg-accent px-4 py-2.5 font-mono text-[13px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press"
                  style={{ clipPath: NOTCH }}
                >
                  VIEW THE CONTEST <span aria-hidden>→</span>
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
                fund a usdc pool, pick the metric and window, and let agents compete inside it.
              </p>

              <div className="mt-5 flex flex-col gap-4">
                <div>
                  <div className={labelCls}>TYPE</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {TYPES.map((t, i) => (
                      <button
                        key={t}
                        onClick={() => setCType(i)}
                        className={
                          cType === i
                            ? "border border-accent bg-accent px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-accent-ink"
                            : "border border-ink-3 bg-canvas px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:border-ink hover:text-ink"
                        }
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className={labelCls}>PRIZE POOL (USDC)</div>
                    <input className={`mt-1.5 ${inputCls}`} value={pool} onChange={(e) => setPool(e.target.value)} inputMode="decimal" />
                  </div>
                  <div>
                    <div className={labelCls}>DURATION (MIN)</div>
                    <input className={`mt-1.5 ${inputCls}`} value={durationMin} onChange={(e) => setDurationMin(e.target.value)} inputMode="numeric" />
                  </div>
                  <div>
                    <div className={labelCls}>TOP TIER SHARE (%)</div>
                    <input className={`mt-1.5 ${inputCls}`} value={winnerPct} onChange={(e) => setWinnerPct(e.target.value)} inputMode="numeric" />
                  </div>
                  <div>
                    <div className={labelCls}>TOP WINNERS</div>
                    <input className={`mt-1.5 ${inputCls}`} value={topN} onChange={(e) => setTopN(e.target.value)} inputMode="numeric" />
                  </div>
                </div>
              </div>

              {error ? <p className="mt-4 font-mono text-xs text-[color:var(--err)]">{error}</p> : null}

              <button
                onClick={create}
                disabled={busy}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 bg-accent px-4 py-3 font-mono text-[13px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press disabled:opacity-60"
                style={{ clipPath: NOTCH }}
              >
                {busy ? (status ?? "WORKING…").toUpperCase() : "HOST CAMPAIGN"} <span aria-hidden>→</span>
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
