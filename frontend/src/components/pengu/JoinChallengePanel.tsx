"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { useOperatorAddress } from "@/hooks/useAuth";
import { CONTRACTS, USDC, publicClient } from "@/lib/arc";
import {
  agentDisplayName,
  erc20Abi,
  fetchAgents,
  resolveActiveAgent,
  setActiveAgentId,
  type AgentState,
} from "@/lib/agents";
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
import { AgentPicker } from "@/components/pengu/AgentPicker";

const card =
  "relative border border-[color:var(--hairline)] bg-canvas p-6 lg:sticky lg:top-20";
const chunky =
  "flex w-full items-center justify-center gap-2 bg-accent px-4 py-3 text-center font-mono text-[13px] uppercase tracking-[0.12em] text-accent-ink transition-colors duration-150 hover:bg-accent-press disabled:opacity-60";

type Payout = { amount: bigint; proof: `0x${string}`[] };

/// The challenge side panel. Join while open, claim once resolved, refund if it
/// was cancelled. Gated on a connected wallet and at least one agent. When the
/// operator owns more than one agent, a picker lets them choose which agent
/// joins; the choice persists via the active-agent helpers in `lib/agents`.
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
  const { address, isSignedIn: isConnected } = useOperatorAddress();
  const { writeContractAsync } = useWriteContract();
  const stakeWei = BigInt(stake);
  const [agents, setAgents] = useState<AgentState[] | undefined>(undefined);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [joined, setJoined] = useState(false);
  const [payout, setPayout] = useState<Payout | null | undefined>(undefined);
  const [claimed, setClaimed] = useState(false);
  const [refunded, setRefunded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = agents?.find((a) => a.id === activeId) ?? null;
  const joinOpen = status === 0 && Math.floor(Date.now() / 1000) < joinDeadline;

  const load = useCallback(async () => {
    if (!address) {
      setAgents([]);
      setActiveId(null);
      setJoined(false);
      setPayout(null);
      setClaimed(false);
      setRefunded(false);
      return;
    }
    if (status === 0) {
      const list = await fetchAgents(address).catch(() => []);
      setAgents(list);
      const resolved = resolveActiveAgent(list, address);
      setActiveId(resolved?.id ?? null);
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

  function pick(picked: number) {
    if (!address) return;
    setActiveAgentId(address, picked);
    setActiveId(picked);
  }

  async function join() {
    if (!address || !active) return;
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
        args: [BigInt(id), BigInt(active.id)],
      });
      await publicClient.waitForTransactionReceipt({ hash: h });
      setJoined(true);
      reportEvent("challenge_join", { context: { id, agentId: active.id }, address });
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
      if (payout === undefined) return <p className="mt-3 font-mono text-sm text-ink-3">checking your result…</p>;
      if (payout === null) return <p className="mt-3 text-sm text-ink-2">no prize this challenge. your agent is ready for the next one.</p>;
      if (claimed) return <p className="mt-3 text-sm text-ink-2">claimed {formatUsdc(payout.amount)}. nicely done.</p>;
      return (
        <>
          <p className="mt-2 text-sm text-ink-2">you won {formatUsdc(payout.amount)}. claim it to your wallet.</p>
          <button onClick={claim} disabled={busy} className={`mt-5 ${chunky}`}>
            {busy ? "claiming…" : `claim ${formatUsdc(payout.amount)}`}
          </button>
        </>
      );
    }

    if (status === 3) {
      if (!isConnected) return <p className="mt-3 text-sm text-ink-2">this challenge was cancelled. log in to pull your stake back.</p>;
      if (!joined) return <p className="mt-3 text-sm text-ink-2">this challenge was cancelled. nothing staked from this wallet.</p>;
      if (refunded) return <p className="mt-3 text-sm text-ink-2">stake refunded. agent ready for the next one.</p>;
      return (
        <>
          <p className="mt-2 text-sm text-ink-2">this challenge was cancelled. pull your {formatUsdc(stakeWei)} stake back.</p>
          <button onClick={doRefund} disabled={busy} className={`mt-5 ${chunky}`}>
            {busy ? "refunding…" : "refund stake"}
          </button>
        </>
      );
    }

    if (status === 1) {
      return <p className="mt-3 text-sm text-ink-2">challenge locked. the coordinator is scoring the field.</p>;
    }

    // OPEN
    if (!isConnected) return <LoginGate label="log in to join" />;
    if (!joinOpen) return <p className="mt-3 text-sm text-ink-2">the join window has closed. scoring is next.</p>;
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
    if (joined) {
      return (
        <>
          <AgentPicker agents={agents} activeId={active.id} onPick={pick} />
          <p className="mt-3 text-sm text-ink-2">{agentDisplayName(active)} is staked in. results come when the window closes.</p>
        </>
      );
    }
    return (
      <>
        <AgentPicker agents={agents} activeId={active.id} onPick={pick} />
        <p className="mt-3 text-sm text-ink-2">join stakes {formatUsdc(stakeWei)} and commits {agentDisplayName(active)}.</p>
        <button onClick={join} disabled={busy} className={`mt-5 ${chunky}`}>
          {busy ? (step ?? "working…") : `join for ${formatUsdc(stakeWei)}`}
        </button>
      </>
    );
  }

  return (
    <div className={card}>
      <h2 className="font-stencil uppercase text-ink" style={{ fontSize: 22, lineHeight: 1, letterSpacing: "-0.01em" }}>
        {status === 2 ? "YOUR WINNINGS" : status === 3 ? "REFUND" : "JOIN THIS CHALLENGE"}
      </h2>
      {body()}
      {error ? <p className="mt-4 font-mono text-xs text-[#e0466e]">{error}</p> : null}
    </div>
  );

  function LoginGate({ label }: { label: string }) {
    return (
      <>
        <p className="mt-2 text-sm text-ink-2">log in, then join with your agent.</p>
        <div className="mt-5">
          <LoginCTA label={label} className={chunky} />
        </div>
      </>
    );
  }
}
