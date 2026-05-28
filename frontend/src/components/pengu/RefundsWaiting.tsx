"use client";

import { useCallback, useEffect, useState } from "react";
import { useArcWrite } from "@/hooks/useArcWrite";
import { CONTRACTS, publicClient } from "@/lib/arc";
import { challengeArenaAbi, fetchPendingRefunds, type PendingRefund } from "@/lib/challenges";
import { formatUsdc } from "@/lib/contests";
import { friendlyError, rawErrorDetail } from "@/lib/errors";
import { reportEvent } from "@/lib/report";
import { ActivityLedger, BracketedCell } from "@/components/redesign";

/// Dashboard surface listing cancelled challenges the operator still has a
/// stake locked in. Each row has a REFUND STAKE button that calls
/// ChallengeArena.refund(id) through the unified write hook (wagmi or
/// Circle depending on wallet kind). On success the row drops out of the
/// list. If the list ends up empty the whole card hides itself so the
/// dashboard stays quiet for the common path.

export function RefundsWaiting({ address }: { address: `0x${string}` }) {
  const { writeContractAsync } = useArcWrite();
  const [rows, setRows] = useState<PendingRefund[] | undefined>(undefined);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [err, setErr] = useState<{ id: number; friendly: string; raw: string } | null>(null);

  const reload = useCallback(async () => {
    const next = await fetchPendingRefunds(address);
    setRows(next);
  }, [address]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function doRefund(id: number) {
    setBusyId(id);
    setErr(null);
    try {
      const hash = await writeContractAsync({
        address: CONTRACTS.ChallengeArena,
        abi: challengeArenaAbi,
        functionName: "refund",
        args: [BigInt(id)],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      reportEvent("challenge_refund", { context: { id, source: "dashboard" }, address });
      // Optimistically drop the row, then refresh from the backend.
      setRows((prev) => (prev ?? []).filter((r) => r.id !== id));
      void reload();
    } catch (e) {
      setErr({ id, friendly: friendlyError(e, "could not refund."), raw: rawErrorDetail(e) });
      reportEvent("challenge_refund_error", {
        level: "error",
        message: e instanceof Error ? e.message : String(e),
        context: { id, source: "dashboard" },
        address,
      });
    } finally {
      setBusyId(null);
    }
  }

  if (rows === undefined) return null; // loading: keep dashboard quiet
  if (rows.length === 0) return null; // happy path: hide the section entirely

  const total = rows.reduce((sum, r) => sum + r.stake, 0n);

  return (
    <section className="mx-auto max-w-[1600px] px-6 pb-10">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
          <span aria-hidden className="text-accent">■</span> REFUNDS WAITING
        </span>
        <span className="font-mono text-[11px] text-ink-3">
          {rows.length} CHALLENGE{rows.length === 1 ? "" : "S"} · {formatUsdc(total)} TO PULL BACK
        </span>
      </div>
      <BracketedCell pad="sm">
        <p className="px-2 pt-2 font-mono text-[12px] leading-[1.5] text-ink-2">
          these challenges were cancelled before they settled. your stake is sitting in escrow until you pull it back.
        </p>
        <ActivityLedger>
          {rows.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--hairline)] py-3 last:border-0"
            >
              <div className="min-w-0">
                <div className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink">
                  CHALLENGE #{r.id}
                </div>
                <div className="font-mono text-[10px] text-ink-3">cancelled · stake locked</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[14px] text-ink">{formatUsdc(r.stake)}</span>
                <button
                  onClick={() => doRefund(r.id)}
                  disabled={busyId === r.id}
                  className="inline-flex items-center gap-2 bg-accent px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-accent-ink transition-colors hover:bg-accent-press disabled:opacity-60"
                >
                  {busyId === r.id ? "REFUNDING…" : "REFUND STAKE"} <span aria-hidden>→</span>
                </button>
              </div>
              {err && err.id === r.id ? (
                <div className="basis-full">
                  <p className="font-mono text-[11px] text-[#e0466e]">{err.friendly}</p>
                  {err.raw && err.raw !== err.friendly ? (
                    <p className="mt-1 font-mono text-[10px] leading-[1.4] text-ink-3 break-words">
                      <span className="text-ink-2">details:</span> {err.raw}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </ActivityLedger>
      </BracketedCell>
    </section>
  );
}
