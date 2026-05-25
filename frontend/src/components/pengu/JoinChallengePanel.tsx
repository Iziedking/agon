"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { CONTRACTS, USDC, publicClient } from "@/lib/arc";
import { erc20Abi, fetchFirstAgent, type AgentState } from "@/lib/agents";
import {
  challengeArenaAbi,
  fetchChallengePayout,
  hasClaimedChallenge,
  hasJoined,
  hasRefunded,
} from "@/lib/challenges";
import { formatUsdc } from "@/lib/contests";
import { friendlyError } from "@/lib/errors";
import { reportEvent } from "@/lib/report";
import { LoginCTA } from "@/components/pengu/LoginCTA";

const card =
  "rounded-card border border-pengu-blue/15 bg-white p-6 shadow-[0_10px_30px_rgba(70,45,150,0.08)] lg:sticky lg:top-20";
const chunky =
  "block w-full rounded-pill bg-pengu-blue px-6 py-3 text-center font-display text-sm uppercase tracking-wide text-white shadow-[0_4px_0_0_#5b34d6] transition-all duration-100 hover:translate-y-[2px] hover:shadow-[0_2px_0_0_#5b34d6] active:translate-y-[3px] disabled:opacity-60";

type Payout = { amount: bigint; proof: `0x${string}`[] };

/// The challenge side panel. Join while open, claim once resolved, refund if it
/// was cancelled. Gated on a connected wallet and an agent.
export function JoinChallengePanel({
  id,
  status,
  stake,
  joinDeadline,
}: {
  id: number;
  status: number;
  stake: string; // USDC wei, as a string (bigint is not serializable across the boundary)
  joinDeadline: number; // epoch seconds
}) {
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const stakeWei = BigInt(stake);
  const [agent, setAgent] = useState<AgentState | null | undefined>(undefined);
  const [joined, setJoined] = useState(false);
  const [payout, setPayout] = useState<Payout | null | undefined>(undefined);
  const [claimed, setClaimed] = useState(false);
  const [refunded, setRefunded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const joinOpen = status === 0 && Math.floor(Date.now() / 1000) < joinDeadline;

  const load = useCallback(async () => {
    if (!address) {
      setAgent(null);
      setJoined(false);
      setPayout(null);
      setClaimed(false);
      setRefunded(false);
      return;
    }
    if (status === 0) {
      const a = await fetchFirstAgent(address).catch(() => null);
      setAgent(a);
      setJoined(await hasJoined(id, address as `0x${string}`));
    } else if (status === 2) {
      setPayout(await fetchChallengePayout(id, address));
      setClaimed(await hasClaimedChallenge(id, address as `0x${string}`));
    } else if (status === 3) {
      setJoined(await hasJoined(id, address as `0x${string}`));
      setRefunded(await hasRefunded(id, address as `0x${string}`));
    }
  }, [address, id, status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function join() {
    if (!address || !agent) return;
    setBusy(true);
    setError(null);
    try {
      setStep("approving usdc…");
      const ah = await writeContractAsync({
        address: USDC,
        abi: erc20Abi,
        functionName: "approve",
        args: [CONTRACTS.PrizeEscrow, stakeWei],
      });
      await publicClient.waitForTransactionReceipt({ hash: ah });

      setStep("joining…");
      const h = await writeContractAsync({
        address: CONTRACTS.ChallengeArena,
        abi: challengeArenaAbi,
        functionName: "joinChallenge",
        args: [BigInt(id), BigInt(agent.id)],
      });
      await publicClient.waitForTransactionReceipt({ hash: h });
      setJoined(true);
      reportEvent("challenge_join", { context: { id, agentId: agent.id }, address });
    } catch (e) {
      setError(friendlyError(e, "could not join."));
      reportEvent("challenge_join_error", { level: "error", message: e instanceof Error ? e.message : String(e), context: { id }, address });
    } finally {
      setBusy(false);
      setStep(null);
    }
  }

  async function claim() {
    if (!address || !payout) return;
    setBusy(true);
    setError(null);
    try {
      const h = await writeContractAsync({
        address: CONTRACTS.ChallengeArena,
        abi: challengeArenaAbi,
        functionName: "claimChallengePayout",
        args: [BigInt(id), payout.amount, payout.proof],
      });
      await publicClient.waitForTransactionReceipt({ hash: h });
      setClaimed(true);
      reportEvent("challenge_claim", { context: { id, amount: payout.amount.toString() }, address });
    } catch (e) {
      setError(friendlyError(e, "could not claim."));
      reportEvent("challenge_claim_error", { level: "error", message: e instanceof Error ? e.message : String(e), context: { id }, address });
    } finally {
      setBusy(false);
    }
  }

  async function doRefund() {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      const h = await writeContractAsync({
        address: CONTRACTS.ChallengeArena,
        abi: challengeArenaAbi,
        functionName: "refund",
        args: [BigInt(id)],
      });
      await publicClient.waitForTransactionReceipt({ hash: h });
      setRefunded(true);
      reportEvent("challenge_refund", { context: { id }, address });
    } catch (e) {
      setError(friendlyError(e, "could not refund."));
      reportEvent("challenge_refund_error", { level: "error", message: e instanceof Error ? e.message : String(e), context: { id }, address });
    } finally {
      setBusy(false);
    }
  }

  function body() {
    if (status === 2) {
      if (!isConnected) return <LoginGate label="log in" />;
      if (payout === undefined) return <p className="mt-3 font-mono text-sm text-pengu-dark/55">checking your result…</p>;
      if (payout === null) return <p className="mt-3 text-sm text-pengu-dark/65">no prize this challenge. your agent is ready for the next one.</p>;
      if (claimed) return <p className="mt-3 text-sm text-pengu-dark/65">claimed {formatUsdc(payout.amount)}. nicely done.</p>;
      return (
        <>
          <p className="mt-2 text-sm text-pengu-dark/65">you won {formatUsdc(payout.amount)}. claim it to your wallet.</p>
          <button onClick={claim} disabled={busy} className={`mt-5 ${chunky}`}>
            {busy ? "claiming…" : `claim ${formatUsdc(payout.amount)}`}
          </button>
        </>
      );
    }

    if (status === 3) {
      if (!isConnected) return <p className="mt-3 text-sm text-pengu-dark/60">this challenge was cancelled. log in to pull your stake back.</p>;
      if (!joined) return <p className="mt-3 text-sm text-pengu-dark/60">this challenge was cancelled. nothing staked from this wallet.</p>;
      if (refunded) return <p className="mt-3 text-sm text-pengu-dark/65">stake refunded. agent ready for the next one.</p>;
      return (
        <>
          <p className="mt-2 text-sm text-pengu-dark/65">this challenge was cancelled. pull your {formatUsdc(stakeWei)} stake back.</p>
          <button onClick={doRefund} disabled={busy} className={`mt-5 ${chunky}`}>
            {busy ? "refunding…" : "refund stake"}
          </button>
        </>
      );
    }

    if (status === 1) {
      return <p className="mt-3 text-sm text-pengu-dark/60">challenge locked. the coordinator is scoring the field.</p>;
    }

    // OPEN
    if (!isConnected) return <LoginGate label="log in to join" />;
    if (!joinOpen) return <p className="mt-3 text-sm text-pengu-dark/60">the join window has closed. scoring is next.</p>;
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
    if (joined) {
      return <p className="mt-2 text-sm text-pengu-dark/65">agent #{agent.id} is staked in. results come when the window closes.</p>;
    }
    return (
      <>
        <p className="mt-2 text-sm text-pengu-dark/65">join stakes {formatUsdc(stakeWei)} and commits agent #{agent.id}.</p>
        <button onClick={join} disabled={busy} className={`mt-5 ${chunky}`}>
          {busy ? (step ?? "working…") : `join for ${formatUsdc(stakeWei)}`}
        </button>
      </>
    );
  }

  return (
    <div className={card}>
      <h2 className="font-bubble text-xl uppercase text-pengu-dark">
        {status === 2 ? "your winnings" : status === 3 ? "refund" : "join this challenge"}
      </h2>
      {body()}
      {error ? <p className="mt-4 font-mono text-xs text-[#e0466e]">{error}</p> : null}
    </div>
  );

  function LoginGate({ label }: { label: string }) {
    return (
      <>
        <p className="mt-2 text-sm text-pengu-dark/65">log in, then join with your agent.</p>
        <div className="mt-5">
          <LoginCTA label={label} className={chunky} />
        </div>
      </>
    );
  }
}
