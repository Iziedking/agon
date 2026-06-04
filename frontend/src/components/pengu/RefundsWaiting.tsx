"use client";

import { useCallback, useEffect, useState } from "react";
import { useArcWrite } from "@/hooks/useArcWrite";
import { CONTRACTS, publicClient } from "@/lib/arc";
import {
  challengeArenaAbi,
  fetchPendingRefunds,
  type CancelledContestRef,
  type PendingRefund,
} from "@/lib/challenges";
import { formatUsdc } from "@/lib/contests";
import { friendlyError } from "@/lib/errors";
import { logRawError } from "@/lib/report";
import { reportEvent } from "@/lib/report";
import { ActivityLedger, BracketedCell } from "@/components/redesign";

/// Dashboard surface listing cancelled events the operator showed up for.
/// Challenges row → REFUND STAKE button (the operator's stake is locked in
/// escrow until they pull it back). Contest row → informational only,
/// since contest entry is free and the sponsor was auto-refunded by the
/// cancel tx. If both lists are empty the whole section hides itself so
/// the dashboard stays quiet for the common path.

export function RefundsWaiting({ address }: { address: `0x${string}` }) {
  const { writeContractAsync } = useArcWrite();
  const [challenges, setChallenges] = useState<PendingRefund[] | undefined>(undefined);
  const [contests, setContests] = useState<CancelledContestRef[] | undefined>(undefined);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [err, setErr] = useState<{ id: number; friendly: string } | null>(null);

  const reload = useCallback(async () => {
    const next = await fetchPendingRefunds(address);
    setChallenges(next.challenges);
    setContests(next.contests);
  }, [address]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function doRefund(row: PendingRefund) {
    const id = row.id;
    setBusyId(id);
    setErr(null);
    try {
      // Stale-cancellable rows need a cancel tx first; the contract
      // requires status == CANCELLED before refund() is callable.
      if (row.action === "cancel_then_refund") {
        const cancelHash = await writeContractAsync({
          address: CONTRACTS.ChallengeArena,
          abi: challengeArenaAbi,
          functionName: "cancelChallenge",
          args: [BigInt(id)],
        });
        await publicClient.waitForTransactionReceipt({ hash: cancelHash });
        reportEvent("challenge_cancel", { context: { id, source: "dashboard" }, address });
      }
      const hash = await writeContractAsync({
        address: CONTRACTS.ChallengeArena,
        abi: challengeArenaAbi,
        functionName: "refund",
        args: [BigInt(id)],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      reportEvent("challenge_refund", { context: { id, source: "dashboard" }, address });
      setChallenges((prev) => (prev ?? []).filter((r) => r.id !== id));
      void reload();
    } catch (e) {
      setErr({ id, friendly: friendlyError(e, "could not refund.") });
      logRawError("challenge_refund_error", e, { address, context: { id, source: "dashboard" } });
    } finally {
      setBusyId(null);
    }
  }

  if (challenges === undefined || contests === undefined) return null;
  if (challenges.length === 0 && contests.length === 0) return null;

  const total = challenges.reduce((sum, r) => sum + r.stake, 0n);
  const lines = [
    challenges.length > 0
      ? `${challenges.length} CHALLENGE${challenges.length === 1 ? "" : "S"} · ${formatUsdc(total)} TO PULL BACK`
      : null,
    contests.length > 0
      ? `${contests.length} CONTEST${contests.length === 1 ? "" : "S"} · CANCELLED`
      : null,
  ].filter(Boolean);

  return (
    <section className="mx-auto max-w-[1600px] px-6 pb-10">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
          <span aria-hidden className="text-accent">■</span> REFUNDS & CANCELLATIONS
        </span>
        <span className="font-mono text-[11px] text-ink-3">{lines.join(" · ")}</span>
      </div>
      <BracketedCell pad="sm">
        <p className="px-2 pt-2 font-mono text-[12px] leading-[1.5] text-ink-2">
          challenges you staked into that are cancelled (or past their deadline and stuck) show here. pull your stake out below.
          {contests.length > 0
            ? " cancelled contests you entered also show here. contest entry is free, so there's nothing to recover."
            : ""}
        </p>
        <ActivityLedger>
          {challenges.map((r) => {
            const isStale = r.action === "cancel_then_refund";
            const subLabel = isStale
              ? "DEADLINE PASSED · CANCEL TO RECOVER STAKE"
              : "CANCELLED · STAKE LOCKED";
            const idle = isStale ? "CANCEL + REFUND" : "REFUND STAKE";
            const busy = isStale ? "WORKING…" : "REFUNDING…";
            return (
              <div
                key={`ch-${r.id}`}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--hairline)] py-3 last:border-0"
              >
                <div className="min-w-0">
                  <div className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink">
                    CHALLENGE #{r.id}
                  </div>
                  <div className="font-mono text-[10px] text-ink-3">{subLabel}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[14px] text-ink">{formatUsdc(r.stake)}</span>
                  <button
                    onClick={() => doRefund(r)}
                    disabled={busyId === r.id}
                    className="inline-flex items-center gap-2 bg-accent px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-accent-ink transition-colors hover:bg-accent-press disabled:opacity-60"
                  >
                    {busyId === r.id ? busy : idle} <span aria-hidden>→</span>
                  </button>
                </div>
                {err && err.id === r.id ? (
                  <p className="basis-full font-mono text-[11px] text-[color:var(--err)]">{err.friendly}</p>
                ) : null}
              </div>
            );
          })}
          {contests.map((r) => (
            <div
              key={`ct-${r.id}`}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--hairline)] py-3 last:border-0"
            >
              <div className="min-w-0">
                <div className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink">
                  CONTEST #{r.id}
                </div>
                <div className="font-mono text-[10px] text-ink-3">CANCELLED · NO STAKE TO RECOVER</div>
              </div>
              <a
                href={`/live/contest/${r.id}`}
                className="inline-flex items-center gap-2 border border-ink bg-canvas px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink transition-colors hover:bg-canvas-3"
              >
                VIEW <span aria-hidden>→</span>
              </a>
            </div>
          ))}
        </ActivityLedger>
      </BracketedCell>
    </section>
  );
}
