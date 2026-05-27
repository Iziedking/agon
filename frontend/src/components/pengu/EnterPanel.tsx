"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { useOperatorAddress } from "@/hooks/useAuth";
import { CONTRACTS, publicClient } from "@/lib/arc";
import { contestEngineAbi, hasEntered, hasClaimed, fetchPayout, formatUsdc } from "@/lib/contests";
import {
  agentDisplayName,
  fetchAgents,
  resolveActiveAgent,
  setActiveAgentId,
  type AgentState,
} from "@/lib/agents";
import { friendlyError } from "@/lib/errors";
import { reportEvent } from "@/lib/report";
import { LoginCTA } from "@/components/pengu/LoginCTA";
import { AgentPicker } from "@/components/pengu/AgentPicker";

const card =
  "relative border border-[color:var(--hairline)] bg-canvas p-6 lg:sticky lg:top-20";
const chunky =
  "flex w-full items-center justify-center gap-2 bg-accent px-4 py-3 text-center font-mono text-[13px] uppercase tracking-[0.12em] text-accent-ink transition-colors duration-150 hover:bg-accent-press disabled:opacity-60";

type Payout = { amount: bigint; proof: `0x${string}`[] };

/// The contest side panel. Enter while open, claim once settled. Gated on a
/// connected wallet and at least one agent. When the operator owns more than one
/// agent, a picker lets them choose which agent enters; the choice persists in
/// localStorage via the active-agent helpers in `lib/agents`.
export function EnterPanel({ contestId, status, endTime }: { contestId: number; status: number; endTime: number }) {
  const { address, isSignedIn: isConnected } = useOperatorAddress();
  const { writeContractAsync } = useWriteContract();
  const [agents, setAgents] = useState<AgentState[] | undefined>(undefined);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [entered, setEntered] = useState(false);
  const [payout, setPayout] = useState<Payout | null | undefined>(undefined);
  const [claimed, setClaimed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = agents?.find((a) => a.id === activeId) ?? null;
  const nowOpen = status === 1 && Math.floor(Date.now() / 1000) < endTime;

  const load = useCallback(async () => {
    if (!address) {
      setAgents([]);
      setActiveId(null);
      setEntered(false);
      setPayout(null);
      setClaimed(false);
      return;
    }
    if (status === 1) {
      const list = await fetchAgents(address).catch(() => []);
      setAgents(list);
      const resolved = resolveActiveAgent(list, address);
      setActiveId(resolved?.id ?? null);
    } else if (status === 3) {
      setPayout(await fetchPayout(contestId, address));
      setClaimed(await hasClaimed(contestId, address as `0x${string}`));
    }
  }, [address, contestId, status]);

  useEffect(() => {
    void load();
  }, [load]);

  // Recheck the entered flag whenever the chosen agent changes: different
  // agents have separate entries on the contract.
  useEffect(() => {
    if (status !== 1 || !active) {
      setEntered(false);
      return;
    }
    let live = true;
    hasEntered(contestId, active.id)
      .then((v) => {
        if (live) setEntered(v);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [active?.id, contestId, status]);

  function pick(id: number) {
    if (!address) return;
    setActiveAgentId(address, id);
    setActiveId(id);
  }

  async function enter() {
    if (!address || !active) return;
    setBusy(true);
    setError(null);
    try {
      const hash = await writeContractAsync({
        address: CONTRACTS.ContestEngine,
        abi: contestEngineAbi,
        functionName: "registerEntry",
        args: [BigInt(contestId), BigInt(active.id), 0n],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setEntered(true);
      reportEvent("contest_enter", { context: { contestId, agentId: active.id }, address });
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
            <p className="mt-2 text-sm text-ink-2">log in to check your winnings.</p>
            <div className="mt-5">
              <LoginCTA label="log in" className={chunky} />
            </div>
          </>
        );
      }
      if (payout === undefined) return <p className="mt-3 font-mono text-sm text-ink-3">checking your result…</p>;
      if (payout === null) {
        return <p className="mt-3 text-sm text-ink-2">no prize this contest. your agent is ready for the next one.</p>;
      }
      if (claimed) {
        return <p className="mt-3 text-sm text-ink-2">claimed {formatUsdc(payout.amount)}. nicely done.</p>;
      }
      return (
        <>
          <p className="mt-2 text-sm text-ink-2">you won {formatUsdc(payout.amount)}. claim it to your wallet.</p>
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
            <p className="mt-2 text-sm text-ink-2">log in, then enter your agent to compete for the pool.</p>
            <div className="mt-5">
              <LoginCTA label="log in to enter" className={chunky} />
            </div>
          </>
        );
      }
      if (agents === undefined) return <p className="mt-3 font-mono text-sm text-ink-3">reading your agents…</p>;
      if (agents.length === 0 || !active) {
        return (
          <>
            <p className="mt-2 text-sm text-ink-2">you need an agent first. claim one in the workshop.</p>
            <a href="/workshop" className={`mt-5 ${chunky}`}>
              go to workshop
            </a>
          </>
        );
      }
      if (entered) {
        return (
          <>
            <AgentPicker agents={agents} activeId={active.id} onPick={pick} />
            <p className="mt-3 text-sm text-ink-2">{agentDisplayName(active)} is entered. it competes for the window. you can leave the page.</p>
            <a href="/live" className={`mt-5 ${chunky}`}>
              watch live
            </a>
          </>
        );
      }
      return (
        <>
          <AgentPicker agents={agents} activeId={active.id} onPick={pick} />
          <p className="mt-3 text-sm text-ink-2">entering commits {agentDisplayName(active)} for the contest window.</p>
          <button onClick={enter} disabled={busy} className={`mt-5 ${chunky}`}>
            {busy ? "entering…" : "enter contest"}
          </button>
        </>
      );
    }

    // Closed but not settled yet (scoring, or window just passed).
    if (status === 2 || status === 1) {
      return <p className="mt-3 text-sm text-ink-2">entries closed. results are coming.</p>;
    }
    if (status === 4) {
      return <p className="mt-3 text-sm text-ink-2">this contest was cancelled and the pool refunded.</p>;
    }
    return <p className="mt-3 text-sm text-ink-2">entries are closed for this contest.</p>;
  }

  return (
    <div className={card}>
      <h2 className="font-stencil uppercase text-ink" style={{ fontSize: 22, lineHeight: 1, letterSpacing: "-0.01em" }}>{status === 3 ? "YOUR WINNINGS" : "ENTER THIS CONTEST"}</h2>
      {body()}
      {error ? <p className="mt-4 font-mono text-xs text-[#e0466e]">{error}</p> : null}
    </div>
  );
}
