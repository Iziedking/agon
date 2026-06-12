"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth, useOperatorAddress } from "@/hooks/useAuth";
import { useArcWrite } from "@/hooks/useArcWrite";
import { CONTRACTS, publicClient } from "@/lib/arc";
import { contestEngineAbi, hasEntered, hasClaimed, fetchPayout, formatUsdc } from "@/lib/contests";
import {
  agentDisplayName,
  fetchAgents,
  resolveActiveAgent,
  setActiveAgentId,
  tierOf,
  type AgentState,
  type ContestTypeName,
} from "@/lib/agents";
import { friendlyError } from "@/lib/errors";
import { reportEvent } from "@/lib/report";
import { playJoin } from "@/lib/sounds";
import { LoginCTA } from "@/components/pengu/LoginCTA";
import { AgentPicker } from "@/components/pengu/AgentPicker";
import { EquipTraitsPanel } from "@/components/pengu/EquipTraitsPanel";
import { fetchEntryCaps, fetchInEvent, fetchSwapBudget } from "@/lib/loadouts";
import { fetchTierGate, gateLabel, tierAllowed, type TierGate } from "@/lib/tierGate";

const card =
  "relative border border-[color:var(--hairline)] bg-canvas p-6 lg:sticky lg:top-20";
const chunky =
  "flex w-full items-center justify-center gap-2 bg-accent px-4 py-3 text-center font-mono text-[13px] uppercase tracking-[0.12em] text-accent-ink transition-colors duration-150 hover:bg-accent-press disabled:opacity-60";

type Payout = { amount: bigint; proof: `0x${string}`[] };

/// The contest side panel. Enter while open, claim once settled. Gated on a
/// connected wallet and at least one agent. When the operator owns more than one
/// agent, a picker lets them choose which agent enters; the choice persists in
/// localStorage via the active-agent helpers in `lib/agents`.
export function EnterPanel({ contestId, status, endTime, contestType }: { contestId: number; status: number; endTime: number; contestType?: number }) {
  const { address, isSignedIn: isConnected } = useOperatorAddress();
  const { me } = useAuth();
  const { writeContractAsync } = useArcWrite();
  const [agents, setAgents] = useState<AgentState[] | undefined>(undefined);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [entered, setEntered] = useState(false);
  const [payout, setPayout] = useState<Payout | null | undefined>(undefined);
  const [claimed, setClaimed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capInfo, setCapInfo] = useState<{ liveCount: number; maxLive: number; atCap: boolean } | null>(null);
  const [opAlreadyIn, setOpAlreadyIn] = useState(false);
  const [outOfSwaps, setOutOfSwaps] = useState(false);
  const [gate, setGate] = useState<TierGate | null>(null);

  // The agent family this contest scores on, for the gate's tier check.
  const family: ContestTypeName = contestType === 1 ? "analyst" : contestType === 2 ? "solver" : "scout";

  // Fall back to the first agent when the active-id resolution is racing
  // the agents fetch. Without this fallback the panel briefly renders the
  // "no agents - go to workshop" branch and the user can click it.
  const active = agents?.find((a) => a.id === activeId) ?? agents?.[0] ?? null;
  const nowOpen = status === 1 && Math.floor(Date.now() / 1000) < endTime;

  useEffect(() => {
    if (!address || status !== 1) return;
    let live = true;
    void Promise.all([
      fetchEntryCaps(address, "contest"),
      fetchInEvent(address, "contest", contestId),
    ]).then(([caps, inEvent]) => {
      if (!live) return;
      setCapInfo(caps);
      setOpAlreadyIn(inEvent);
    });
    return () => { live = false; };
  }, [address, contestId, status, entered]);

  // Tier gate for this contest (null when open to all tiers).
  useEffect(() => {
    if (status !== 1) return;
    let live = true;
    void fetchTierGate("contest", contestId).then((g) => { if (live) setGate(g); });
    return () => { live = false; };
  }, [contestId, status]);

  // Scout contests run real swaps; gate on the agent's shared daily budget.
  useEffect(() => {
    if (status !== 1 || contestType !== 0 || activeId == null) {
      setOutOfSwaps(false);
      return;
    }
    let live = true;
    void fetchSwapBudget(activeId).then((b) => {
      if (live) setOutOfSwaps(b.enabled && b.remaining <= 0);
    });
    return () => { live = false; };
  }, [status, contestType, activeId, entered]);

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
      playJoin();
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
      const atLiveCap = capInfo?.atCap ?? false;
      const blockedByOtherAgent = opAlreadyIn && !entered;
      // PointsLedger qualification: when QUALIFY_MIN_POINTS is set on
      // the backend, the operator's cycles balance has to clear the
      // floor or the scoring pass drops them at settlement. Block the
      // entry up front so they don't burn gas on a tx that won't earn.
      const cyclesShort = Boolean(
        me &&
          typeof me.cyclesRequired === "number" &&
          me.cyclesRequired > 0 &&
          !me.canEnterContests,
      );
      const cyclesNeeded =
        cyclesShort && me && typeof me.cycles === "number"
          ? Math.max(0, (me.cyclesRequired ?? 0) - me.cycles)
          : 0;
      const agentTier = tierOf(active, family);
      const tierBlocked = Boolean(gate) && !tierAllowed(gate, agentTier);
      const disabled = busy || atLiveCap || blockedByOtherAgent || cyclesShort || outOfSwaps || tierBlocked;
      const buttonLabel = busy
        ? "entering…"
        : cyclesShort
          ? `need ${cyclesNeeded} more cycles`
          : atLiveCap
            ? `${capInfo!.liveCount} / ${capInfo!.maxLive} live contests`
            : blockedByOtherAgent
              ? "another agent already entered"
              : tierBlocked
                ? `requires ${gateLabel(gate)?.toLowerCase()}`
                : outOfSwaps
                  ? "agent out of swaps today"
                  : "enter contest";
      return (
        <>
          {gate ? (
            <div className="mb-3 inline-flex items-center gap-2 border border-[color:var(--hairline-strong)] bg-canvas-2 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2">
              <span aria-hidden className="text-accent">■</span> REQUIRES {gateLabel(gate)}
            </div>
          ) : null}
          <AgentPicker agents={agents} activeId={active.id} onPick={pick} />
          <p className="mt-3 text-sm text-ink-2">entering commits {agentDisplayName(active)} for the contest window.</p>
          {tierBlocked ? (
            <p className="mt-2 font-mono text-xs text-[#e0466e]">
              {agentDisplayName(active)} is {family} tier {agentTier}. this contest is {gateLabel(gate)?.toLowerCase()}. pick a qualifying agent or upgrade.
            </p>
          ) : null}
          {address ? (
            <EquipTraitsPanel
              address={address as `0x${string}`}
              source="contest"
              eventId={contestId}
              agentId={active.id}
              disabled={busy}
            />
          ) : null}
          <button onClick={enter} disabled={disabled} className={`mt-5 ${chunky}`}>
            {buttonLabel}
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
