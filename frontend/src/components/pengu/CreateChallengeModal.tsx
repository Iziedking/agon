"use client";

import { useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { Bubble3D } from "@/components/pengu/atoms";
import { CONTRACTS, publicClient } from "@/lib/arc";
import { challengeArenaAbi, CHALLENGE_KIND, nextChallengeId } from "@/lib/challenges";
import { friendlyError } from "@/lib/errors";
import { reportEvent } from "@/lib/report";

const chunky =
  "block w-full rounded-pill bg-pengu-blue px-6 py-3 text-center font-display text-sm uppercase tracking-wide text-white shadow-[0_4px_0_0_#5b34d6] transition-all duration-100 hover:translate-y-[2px] hover:shadow-[0_2px_0_0_#5b34d6] active:translate-y-[3px] disabled:opacity-60";
const input =
  "w-full rounded-xl border border-pengu-blue/20 bg-pengu-card px-3 py-2 font-mono text-sm text-pengu-dark outline-none focus:border-pengu-blue";
const label = "font-display text-[11px] uppercase tracking-wide text-pengu-dark/50";

/// Opens a peer-to-peer ChallengeArena challenge. The creator does not stake at
/// creation; entrants stake when they join. Single tx, no USDC approval needed.
export function CreateChallengeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
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
      // the deadline forces a refund cancel. Anything shorter and the
      // challenge will likely settle from your side then cancel from chain.
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
        <Bubble3D className="text-[26px]">create a challenge</Bubble3D>

        {createdId !== null ? (
          <div className="mt-4">
            <p className="text-sm text-pengu-dark/70">
              challenge #{createdId} is live. other operators can stake in with their agent before the join window
              closes.
            </p>
            <a href={`/challenges/${createdId}`} className={`mt-5 ${chunky}`}>
              open challenge
            </a>
            <button
              onClick={onClose}
              className="mt-3 block w-full text-center font-display text-xs uppercase tracking-wide text-pengu-dark/55 hover:text-pengu-blue"
            >
              stay here
            </button>
          </div>
        ) : (
          <>
            <p className="mt-2 text-sm text-pengu-dark/60">
              stake some USDC, set the window, and let other operators take you on.
            </p>
            <div className="mt-5 flex flex-col gap-4">
              <div>
                <div className={label}>kind</div>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {CHALLENGE_KIND.map((k, i) => (
                    <button
                      key={k}
                      onClick={() => setKind(i)}
                      className={`rounded-pill px-3 py-1.5 font-display text-xs uppercase ${
                        kind === i ? "bg-pengu-blue text-white" : "bg-pengu-blue/10 text-pengu-blue"
                      }`}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className={label}>stake (USDC)</div>
                  <input className={`mt-1.5 ${input}`} value={stake} onChange={(e) => setStake(e.target.value)} inputMode="decimal" />
                </div>
                <div>
                  <div className={label}>max entrants</div>
                  <input className={`mt-1.5 ${input}`} value={maxEntrants} onChange={(e) => setMaxEntrants(e.target.value)} inputMode="numeric" />
                </div>
                <div>
                  <div className={label}>join window (min)</div>
                  <input className={`mt-1.5 ${input}`} value={joinMin} onChange={(e) => setJoinMin(e.target.value)} inputMode="numeric" />
                </div>
                <div>
                  <div className={label}>resolve window (min)</div>
                  <input className={`mt-1.5 ${input}`} value={resolveMin} onChange={(e) => setResolveMin(e.target.value)} inputMode="numeric" />
                  <div className="mt-1 font-mono text-[10px] text-pengu-dark/45">min 10. shorter windows risk a cancel.</div>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-pengu-dark/70">
                <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
                invite-only (private)
              </label>
            </div>
            {error ? <p className="mt-4 font-mono text-xs text-[#e0466e]">{error}</p> : null}
            <button onClick={create} disabled={busy} className={`mt-5 ${chunky}`}>
              {busy ? "creating…" : "create challenge"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
