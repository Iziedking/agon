"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { CONTRACTS, publicClient } from "@/lib/arc";
import { contestEngineAbi, hasEntered, hasClaimed, fetchPayout, formatUsdc } from "@/lib/contests";
import { fetchFirstAgent, type AgentState } from "@/lib/agents";
import { friendlyError } from "@/lib/errors";
import { reportEvent } from "@/lib/report";
import { LoginCTA } from "@/components/pengu/LoginCTA";

const card =
  "rounded-card border border-pengu-blue/15 bg-white p-6 shadow-[0_10px_30px_rgba(70,45,150,0.08)] lg:sticky lg:top-20";
const chunky =
  "block w-full rounded-pill bg-pengu-blue px-6 py-3 text-center font-display text-sm uppercase tracking-wide text-white shadow-[0_4px_0_0_#5b34d6] transition-all duration-100 hover:translate-y-[2px] hover:shadow-[0_2px_0_0_#5b34d6] active:translate-y-[3px] disabled:opacity-60";

type Payout = { amount: bigint; proof: `0x${string}`[] };

/// The contest side panel. Enter while open, claim once settled. Gated on a
/// connected wallet and an agent.
export function EnterPanel({ contestId, status, endTime }: { contestId: number; status: number; endTime: number }) {
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [agent, setAgent] = useState<AgentState | null | undefined>(undefined);
  const [entered, setEntered] = useState(false);
  const [payout, setPayout] = useState<Payout | null | undefined>(undefined);
  const [claimed, setClaimed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nowOpen = status === 1 && Math.floor(Date.now() / 1000) < endTime;

  const load = useCallback(async () => {
    if (!address) {
      setAgent(null);
      setEntered(false);
      setPayout(null);
      setClaimed(false);
      return;
    }
    if (status === 1) {
      const a = await fetchFirstAgent(address).catch(() => null);
      setAgent(a);
      setEntered(a ? await hasEntered(contestId, a.id) : false);
    } else if (status === 3) {
      setPayout(await fetchPayout(contestId, address));
      setClaimed(await hasClaimed(contestId, address as `0x${string}`));
    }
  }, [address, contestId, status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function enter() {
    if (!address || !agent) return;
    setBusy(true);
    setError(null);
    try {
      const hash = await writeContractAsync({
        address: CONTRACTS.ContestEngine,
        abi: contestEngineAbi,
        functionName: "registerEntry",
        args: [BigInt(contestId), BigInt(agent.id), 0n],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setEntered(true);
      reportEvent("contest_enter", { context: { contestId, agentId: agent.id }, address });
    } catch (e) {
      setError(friendlyError(e, "could not enter."));
      reportEvent("contest_enter_error", { level: "error", message: e instanceof Error ? e.message : String(e), context: { contestId }, address });
    } finally {
      setBusy(false);
    }
  }

  async function claim() {
    if (!address || !payout) return;
    setBusy(true);
    setError(null);
    try {
      const hash = await writeContractAsync({
        address: CONTRACTS.ContestEngine,
        abi: contestEngineAbi,
        functionName: "claimPrize",
        args: [BigInt(contestId), payout.amount, payout.proof],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setClaimed(true);
      reportEvent("prize_claim", { context: { contestId, amount: payout.amount.toString() }, address });
    } catch (e) {
      setError(friendlyError(e, "could not claim."));
      reportEvent("prize_claim_error", { level: "error", message: e instanceof Error ? e.message : String(e), context: { contestId }, address });
    } finally {
      setBusy(false);
    }
  }

  function body() {
    // Settled: claim flow.
    if (status === 3) {
      if (!isConnected) {
        return (
          <>
            <p className="mt-2 text-sm text-pengu-dark/65">log in to check your winnings.</p>
            <div className="mt-5">
              <LoginCTA label="log in" className={chunky} />
            </div>
          </>
        );
      }
      if (payout === undefined) return <p className="mt-3 font-mono text-sm text-pengu-dark/55">checking your result…</p>;
      if (payout === null) {
        return <p className="mt-3 text-sm text-pengu-dark/65">no prize this contest. your agent is ready for the next one.</p>;
      }
      if (claimed) {
        return <p className="mt-3 text-sm text-pengu-dark/65">claimed {formatUsdc(payout.amount)}. nicely done.</p>;
      }
      return (
        <>
          <p className="mt-2 text-sm text-pengu-dark/65">you won {formatUsdc(payout.amount)}. claim it to your wallet.</p>
          <button onClick={claim} disabled={busy} className={`mt-5 ${chunky}`}>
            {busy ? "claiming…" : `claim ${formatUsdc(payout.amount)}`}
          </button>
        </>
      );
    }

    // Open and in window: enter flow.
    if (nowOpen) {
      if (!isConnected) {
        return (
          <>
            <p className="mt-2 text-sm text-pengu-dark/65">log in, then enter your agent to compete for the pool.</p>
            <div className="mt-5">
              <LoginCTA label="log in to enter" className={chunky} />
            </div>
          </>
        );
      }
      if (agent === undefined) return <p className="mt-3 font-mono text-sm text-pengu-dark/55">reading your agent…</p>;
      if (agent === null) {
        return (
          <>
            <p className="mt-2 text-sm text-pengu-dark/65">you need an agent first. claim one in the workshop.</p>
            <a href="/workshop" className={`mt-5 ${chunky}`}>
              go to workshop
            </a>
          </>
        );
      }
      if (entered) {
        return (
          <>
            <p className="mt-2 text-sm text-pengu-dark/65">agent #{agent.id} is entered. it competes for the window. you can leave the page.</p>
            <a href="/live" className={`mt-5 ${chunky}`}>
              watch live
            </a>
          </>
        );
      }
      return (
        <>
          <p className="mt-2 text-sm text-pengu-dark/65">entering commits agent #{agent.id} for the contest window.</p>
          <button onClick={enter} disabled={busy} className={`mt-5 ${chunky}`}>
            {busy ? "entering…" : "enter contest"}
          </button>
        </>
      );
    }

    // Closed but not settled yet (scoring, or window just passed).
    if (status === 2 || status === 1) {
      return <p className="mt-3 text-sm text-pengu-dark/60">entries closed. results are coming.</p>;
    }
    if (status === 4) {
      return <p className="mt-3 text-sm text-pengu-dark/60">this contest was cancelled and the pool refunded.</p>;
    }
    return <p className="mt-3 text-sm text-pengu-dark/60">entries are closed for this contest.</p>;
  }

  return (
    <div className={card}>
      <h2 className="font-bubble text-xl uppercase text-pengu-dark">{status === 3 ? "your winnings" : "enter this contest"}</h2>
      {body()}
      {error ? <p className="mt-4 font-mono text-xs text-[#e0466e]">{error}</p> : null}
    </div>
  );
}
