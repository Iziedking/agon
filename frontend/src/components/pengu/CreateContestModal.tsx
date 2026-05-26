"use client";

import { useState } from "react";
import { zeroAddress } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { Bubble3D } from "@/components/pengu/atoms";
import { CONTRACTS, USDC, publicClient } from "@/lib/arc";
import { erc20Abi } from "@/lib/agents";
import { contestEngineAbi, fetchListingFee, metricForType, nextContestId } from "@/lib/contests";
import { friendlyError } from "@/lib/errors";
import { reportEvent } from "@/lib/report";

const chunky =
  "block w-full rounded-pill bg-pengu-blue px-6 py-3 text-center font-display text-sm uppercase tracking-wide text-white shadow-[0_4px_0_0_#5b34d6] transition-all duration-100 hover:translate-y-[2px] hover:shadow-[0_2px_0_0_#5b34d6] active:translate-y-[3px] disabled:opacity-60";
const input =
  "w-full rounded-xl border border-pengu-blue/20 bg-pengu-card px-3 py-2 font-mono text-sm text-pengu-dark outline-none focus:border-pengu-blue";
const label = "font-display text-[11px] uppercase tracking-wide text-pengu-dark/50";

const TYPES = ["Scout", "Analyst", "Solver"] as const;

/// Host a sponsor-funded campaign contest (ContestEngine.listContest). Two steps:
/// approve USDC to the escrow for the pool plus the listing fee, then list. Any
/// operator can host; the pool comes from their wallet.
export function CreateContestModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
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

      setStatus("approving usdc…");
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-pengu-dark/40" onClick={onClose} />
      <div className="relative w-full max-w-[440px] rounded-card border border-pengu-blue/15 bg-pengu-card p-6 shadow-[0_20px_60px_rgba(70,45,150,0.25)]">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 font-mono text-sm text-pengu-dark/40 hover:text-pengu-dark"
          aria-label="close"
        >
          ✕
        </button>
        <Bubble3D className="text-[26px]">host a campaign</Bubble3D>

        {createdId !== null ? (
          <div className="mt-4">
            <p className="text-sm text-pengu-dark/70">campaign #{createdId} is live. operators can enter it now.</p>
            <a href={`/contests/${createdId}`} className={`mt-5 ${chunky}`}>
              view the contest
            </a>
          </div>
        ) : (
          <>
            <p className="mt-2 text-sm text-pengu-dark/60">
              fund a usdc pool, pick the metric and window, and let agents compete inside it.
            </p>
            <div className="mt-5 flex flex-col gap-4">
              <div>
                <div className={label}>type</div>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {TYPES.map((t, i) => (
                    <button
                      key={t}
                      onClick={() => setCType(i)}
                      className={`rounded-pill px-3 py-1.5 font-display text-xs uppercase ${
                        cType === i ? "bg-pengu-blue text-white" : "bg-pengu-blue/10 text-pengu-blue"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className={label}>prize pool (USDC)</div>
                  <input className={`mt-1.5 ${input}`} value={pool} onChange={(e) => setPool(e.target.value)} inputMode="decimal" />
                </div>
                <div>
                  <div className={label}>duration (min)</div>
                  <input className={`mt-1.5 ${input}`} value={durationMin} onChange={(e) => setDurationMin(e.target.value)} inputMode="numeric" />
                </div>
                <div>
                  <div className={label}>top tier share (%)</div>
                  <input className={`mt-1.5 ${input}`} value={winnerPct} onChange={(e) => setWinnerPct(e.target.value)} inputMode="numeric" />
                </div>
                <div>
                  <div className={label}>top winners</div>
                  <input className={`mt-1.5 ${input}`} value={topN} onChange={(e) => setTopN(e.target.value)} inputMode="numeric" />
                </div>
              </div>
            </div>
            {error ? <p className="mt-4 font-mono text-xs text-[#e0466e]">{error}</p> : null}
            <button onClick={create} disabled={busy} className={`mt-5 ${chunky}`}>
              {busy ? (status ?? "working…") : "host campaign"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
