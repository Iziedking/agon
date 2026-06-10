"use client";

import { useCallback, useEffect, useState } from "react";
import { useOperatorAddress } from "@/hooks/useAuth";
import { useArcWrite } from "@/hooks/useArcWrite";
import { CONTRACTS, USDC, publicClient } from "@/lib/arc";
import {
  agentDisplayName,
  erc20Abi,
  fetchAgents,
  resolveActiveAgent,
  setActiveAgentId,
  tierOf,
  type AgentState,
  type ContestTypeName,
} from "@/lib/agents";
import { fetchTierGate, gateLabel, tierAllowed, type TierGate } from "@/lib/tierGate";
import {
  challengeArenaAbi,
  fetchChallengePayout,
  hasClaimedChallenge,
  hasJoined,
  hasRefunded,
  isInvited,
} from "@/lib/challenges";
import { formatUsdc } from "@/lib/contests";
import { friendlyError } from "@/lib/errors";
import { reportEvent } from "@/lib/report";
import { LoginCTA } from "@/components/pengu/LoginCTA";
import { AgentPicker } from "@/components/pengu/AgentPicker";
import { EquipTraitsPanel } from "@/components/pengu/EquipTraitsPanel";
import { fetchEntryCaps, fetchInEvent, fetchSwapBudget } from "@/lib/loadouts";

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
  isPrivate = false,
  creator,
  kind,
}: {
  id: number;
  status: number;
  stake: string; // USDC wei, as a string (bigint is not serializable across the boundary)
  joinDeadline: number; // epoch seconds
  isPrivate?: boolean;
  creator?: string;
  kind?: number; // 0 prediction, 1 puzzle, 2 volume, 3 custom
}) {
  const { address, isSignedIn: isConnected } = useOperatorAddress();
  const { writeContractAsync } = useArcWrite();
  const stakeWei = BigInt(stake);
  const isCreator = !!address && !!creator && address.toLowerCase() === creator.toLowerCase();
  // For private challenges, joining requires being in the on-chain invited
  // set. The creator is not auto-invited at creation, so we track this to
  // both gate non-invited operators and auto-invite the creator on join.
  const [invited, setInvited] = useState(false);
  const [agents, setAgents] = useState<AgentState[] | undefined>(undefined);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [joined, setJoined] = useState(false);
  const [payout, setPayout] = useState<Payout | null | undefined>(undefined);
  const [claimed, setClaimed] = useState(false);
  const [refunded, setRefunded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capInfo, setCapInfo] = useState<{ liveCount: number; maxLive: number; atCap: boolean } | null>(null);
  const [opAlreadyIn, setOpAlreadyIn] = useState(false);
  const [outOfSwaps, setOutOfSwaps] = useState(false);
  const [gate, setGate] = useState<TierGate | null>(null);

  // The agent family this challenge kind scores on, used to read the right
  // tier for the gate check (volume = scout, puzzle = solver, prediction =
  // analyst; custom defaults to scout).
  const family: ContestTypeName = kind === 1 ? "solver" : kind === 0 ? "analyst" : "scout";

  useEffect(() => {
    if (!address || status !== 0) return;
    let live = true;
    void Promise.all([
      fetchEntryCaps(address, "challenge"),
      fetchInEvent(address, "challenge", id),
    ]).then(([caps, inEvent]) => {
      if (!live) return;
      setCapInfo(caps);
      setOpAlreadyIn(inEvent);
    });
    return () => { live = false; };
  }, [address, id, status, joined]);

  // Tier gate for this challenge (null when open to all tiers).
  useEffect(() => {
    if (status !== 0) return;
    let live = true;
    void fetchTierGate("challenge", id).then((g) => { if (live) setGate(g); });
    return () => { live = false; };
  }, [id, status]);

  // Volume challenges run real swaps; if this agent has spent its shared daily
  // swap budget on other events, it can't run another one until the reset.
  useEffect(() => {
    if (status !== 0 || kind !== 2 || activeId == null) {
      setOutOfSwaps(false);
      return;
    }
    let live = true;
    void fetchSwapBudget(activeId).then((b) => {
      if (live) setOutOfSwaps(b.enabled && b.remaining <= 0);
    });
    return () => { live = false; };
  }, [status, kind, activeId, joined]);

  // Fall back to the first agent when the active-id resolution is racing
  // the agents fetch. Without this fallback the panel briefly renders the
  // "no agents - go to workshop" branch and the user can click it.
  const active = agents?.find((a) => a.id === activeId) ?? agents?.[0] ?? null;
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
      if (isPrivate) {
        setInvited(await isInvited(id, address as `0x${string}`));
      }
    } else if (status === 2) {
      setPayout(await fetchChallengePayout(id, address));
      setClaimed(await hasClaimedChallenge(id, address as `0x${string}`));
    } else if (status === 3) {
      setJoined(await hasJoined(id, address as `0x${string}`));
      setRefunded(await hasRefunded(id, address as `0x${string}`));
    }
  }, [address, id, status, isPrivate]);

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
      // Private challenges gate join on the on-chain invited set. The
      // creator is never auto-invited at creation, so if they are joining
      // their own private challenge, invite themselves first (creator-only
      // call) so the join doesn't revert with NotInvited.
      if (isPrivate && isCreator && !invited) {
        setStep("unlocking your seat…");
        const ih = await writeContractAsync({
          address: CONTRACTS.ChallengeArena,
          abi: challengeArenaAbi,
          functionName: "invite",
          args: [BigInt(id), [address as `0x${string}`]],
        });
        await publicClient.waitForTransactionReceipt({ hash: ih });
        setInvited(true);
      }

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
    // Private challenge, this wallet is neither the host nor invited.
    if (isPrivate && !isCreator && !invited) {
      return (
        <p className="mt-3 text-sm text-ink-2">
          this is an invite-only challenge. ask the host to add your wallet, then refresh.
        </p>
      );
    }
    const atLiveCap = capInfo?.atCap ?? false;
    const blockedByOtherAgent = opAlreadyIn && !joined;
    const agentTier = tierOf(active, family);
    const tierBlocked = Boolean(gate) && !tierAllowed(gate, agentTier);
    const disabled = busy || atLiveCap || blockedByOtherAgent || outOfSwaps || tierBlocked;
    const buttonLabel = busy
      ? (step ?? "working…")
      : atLiveCap
        ? `${capInfo!.liveCount} / ${capInfo!.maxLive} live challenges`
        : blockedByOtherAgent
          ? "another agent already joined"
          : tierBlocked
            ? `requires ${gateLabel(gate)?.toLowerCase()}`
            : outOfSwaps
              ? "agent out of swaps today"
              : `join for ${formatUsdc(stakeWei)}`;
    return (
      <>
        {gate ? (
          <div className="mb-3 inline-flex items-center gap-2 border border-[color:var(--hairline-strong)] bg-canvas-2 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2">
            <span aria-hidden className="text-accent">■</span> REQUIRES {gateLabel(gate)}
          </div>
        ) : null}
        <AgentPicker agents={agents} activeId={active.id} onPick={pick} />
        <p className="mt-3 text-sm text-ink-2">join stakes {formatUsdc(stakeWei)} and commits {agentDisplayName(active)}.</p>
        {gate && !tierAllowed(gate, tierOf(active, family)) ? (
          <p className="mt-2 font-mono text-xs text-[#e0466e]">
            {agentDisplayName(active)} is {family} tier {tierOf(active, family)}. this challenge is {gateLabel(gate)?.toLowerCase()}. pick a qualifying agent or upgrade.
          </p>
        ) : null}
        {address ? (
          <EquipTraitsPanel
            address={address as `0x${string}`}
            source="challenge"
            eventId={id}
            agentId={active.id}
            disabled={busy}
          />
        ) : null}
        <button onClick={join} disabled={disabled} className={`mt-5 ${chunky}`}>
          {buttonLabel}
        </button>
        {outOfSwaps ? (
          <p className="mt-3 font-mono text-xs text-ink-2">
            this agent used its daily swap budget on other events. it can enter another volume event after the daily reset, or pick a different agent.
          </p>
        ) : null}
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
