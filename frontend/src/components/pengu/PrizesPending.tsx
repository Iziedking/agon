"use client";

import { useCallback, useEffect, useState } from "react";
import { useArcWrite } from "@/hooks/useArcWrite";
import { ActivityLedger, BracketedCell } from "@/components/redesign";
import { WinShareModal } from "@/components/redesign/WinShareModal";
import { CHALLENGE_KIND } from "@/lib/challenges";
import { CONTEST_TYPE, formatUsdc } from "@/lib/contests";
import { friendlyError } from "@/lib/errors";
import { logRawError } from "@/lib/report";
import { reportEvent } from "@/lib/report";
import {
  claimWriteShape,
  fetchClaimProof,
  fetchPendingWinnings,
  publicClient,
  type PendingWinning,
  type WinningSource,
} from "@/lib/winnings";

/// Dashboard surface that lists every contest and challenge the operator
/// has won but not yet claimed, with a CLAIM button per row. Replaces the
/// older link-only PRIZES PENDING ledger so users no longer have to find
/// each contest's detail page to claim. On a successful claim we open the
/// WinShareModal so the operator can share to X straight from the
/// dashboard. Self-hides when nothing is pending.

interface SuccessState {
  source: WinningSource;
  id: number;
  amount: bigint;
}

export function PrizesPending({ address }: { address: `0x${string}` }) {
  const { writeContractAsync } = useArcWrite();
  const [rows, setRows] = useState<PendingWinning[] | undefined>(undefined);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [err, setErr] = useState<{ key: string; friendly: string } | null>(null);
  const [success, setSuccess] = useState<SuccessState | null>(null);

  const reload = useCallback(async () => {
    const next = await fetchPendingWinnings(address);
    setRows(next);
  }, [address]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function claim(row: PendingWinning) {
    const key = `${row.source}-${row.id}`;
    setBusyKey(key);
    setErr(null);
    try {
      const claim = await fetchClaimProof(row.source, row.id, address);
      if (!claim) throw new Error("could not fetch claim proof");
      const shape = claimWriteShape(row.source);
      // Simulate before sending. A claim reverts when the winner root isn't
      // posted on-chain yet (a settlement that didn't finish) or the proof
      // doesn't match. Without this, the wallet still sends it, the tx reverts,
      // waitForTransactionReceipt resolves anyway (it does NOT throw on revert),
      // and the prize silently re-appears on the next reload — exactly the
      // "claimed but comes back" bug. Simulating surfaces the real revert reason
      // before any gas is spent.
      await publicClient.simulateContract({
        address: shape.address,
        abi: shape.abi,
        functionName: shape.functionName,
        args: [BigInt(row.id), claim.amount, claim.proof],
        account: address,
      });
      const hash = await writeContractAsync({
        address: shape.address,
        abi: shape.abi,
        functionName: shape.functionName,
        args: [BigInt(row.id), claim.amount, claim.proof],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      // Belt and suspenders: a tx can still revert after a clean simulation
      // (state changed between blocks). Treat a reverted receipt as a failure so
      // the row never drops on a claim that didn't actually land.
      if (receipt.status !== "success") {
        throw new Error("claim reverted on-chain; the prize is still unclaimed");
      }
      reportEvent("prize_claim", {
        context: { source: row.source, id: row.id, amount: claim.amount.toString() },
        address,
      });
      // Drop the row optimistically; backend re-poll happens on next focus
      setRows((prev) => (prev ?? []).filter((r) => `${r.source}-${r.id}` !== key));
      setSuccess({ source: row.source, id: row.id, amount: claim.amount });
    } catch (e) {
      setErr({ key, friendly: friendlyError(e, "could not claim.") });
      logRawError("prize_claim_error", e, { address, context: { source: row.source, id: row.id } });
    } finally {
      setBusyKey(null);
    }
  }

  if (rows === undefined) return null;
  if (rows.length === 0) return null;

  const total = rows.reduce((sum, r) => sum + r.amount, 0n);

  return (
    <>
      <section className="mx-auto max-w-[1600px] px-6 pb-10">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
            <span aria-hidden className="text-accent">■</span> PRIZES PENDING
          </span>
          <span className="font-mono text-[11px] text-ink-3">
            {rows.length} TO CLAIM · {formatUsdc(total)}
          </span>
        </div>
        <BracketedCell pad="sm">
          <ActivityLedger>
            {rows.map((r) => {
              const key = `${r.source}-${r.id}`;
              const label =
                r.source === "contest"
                  ? `CONTEST #${r.id}`
                  : `CHALLENGE #${r.id}`;
              const typeLabel =
                r.source === "contest"
                  ? r.typeNum != null
                    ? CONTEST_TYPE[r.typeNum] ?? `type ${r.typeNum}`
                    : "campaign"
                  : r.typeNum != null
                    ? CHALLENGE_KIND[r.typeNum] ?? "challenge"
                    : "challenge";
              return (
                <div
                  key={key}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--hairline)] py-3 last:border-0"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink">
                      {label}
                    </div>
                    <div className="font-mono text-[10px] text-ink-3">{typeLabel}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[14px] text-accent">{formatUsdc(r.amount)}</span>
                    <button
                      onClick={() => claim(r)}
                      disabled={busyKey === key}
                      className="inline-flex items-center gap-2 bg-accent px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-accent-ink transition-colors hover:bg-accent-press disabled:opacity-60"
                    >
                      {busyKey === key ? "CLAIMING…" : "CLAIM"} <span aria-hidden>→</span>
                    </button>
                  </div>
                  {err && err.key === key ? (
                    <p className="basis-full font-mono text-[11px] text-[#e0466e]">{err.friendly}</p>
                  ) : null}
                </div>
              );
            })}
          </ActivityLedger>
        </BracketedCell>
      </section>

      {success ? (
        <WinShareModal
          source={success.source}
          id={success.id}
          winners={[
            { rank: 1, operator: address, amount: success.amount.toString() },
          ]}
          youAddress={address}
          onClose={() => setSuccess(null)}
        />
      ) : null}
    </>
  );
}
