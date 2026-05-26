"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useAccount } from "wagmi";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/pengu/Footer";
import { SectionLabel, Bubble3D } from "@/components/pengu/atoms";
import { LoginCTA } from "@/components/pengu/LoginCTA";
import { ClaimAgentButton } from "@/components/pengu/ClaimAgentButton";
import { AgentMascot } from "@/components/pengu/AgentMascot";
import { AgentTraits } from "@/components/pengu/AgentTraits";
import { NftBadge } from "@/components/pengu/NftBadge";
import { OperatorAvatar } from "@/components/pengu/OperatorAvatar";
import {
  CONTEST_TYPES,
  fetchAgents,
  resolveActiveAgent,
  setActiveAgentId,
  tierOf,
  type AgentState,
} from "@/lib/agents";
import { agentColorById } from "@/lib/profiles";
import { fetchContests } from "@/lib/contests";

/// A judge-friendly walkthrough: connect, claim, enter. Mirrors the real flow,
/// keeps the steps visible, and never leaves the visitor wondering what to do
/// next. State updates live (wallet connects, agent claim confirms, open contest
/// count refreshes), so the page tracks the user's progress as it happens.

const chunkyBtn =
  "rounded-pill bg-pengu-blue px-6 py-3 font-display text-sm uppercase tracking-wide text-white shadow-[0_4px_0_0_#5b34d6] transition-all duration-100 hover:translate-y-[2px] hover:shadow-[0_2px_0_0_#5b34d6] active:translate-y-[3px] disabled:opacity-60";

type StepStatus = "locked" | "active" | "done";

function Check() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
      <path d="M5 12l5 5 9-11" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Step({
  n,
  title,
  desc,
  status,
  children,
}: {
  n: number;
  title: string;
  desc: string;
  status: StepStatus;
  children: ReactNode;
}) {
  const borderCls =
    status === "done"
      ? "border-[#22c55e]/35"
      : status === "active"
        ? "border-pengu-blue/35"
        : "border-pengu-blue/10";
  const badgeCls =
    status === "done"
      ? "bg-[#22c55e] text-white"
      : status === "active"
        ? "bg-pengu-blue text-white"
        : "bg-pengu-blue/10 text-pengu-blue";
  return (
    <div
      className={`rounded-card border bg-white p-6 shadow-[0_10px_30px_rgba(70,45,150,0.08)] ${borderCls} ${
        status === "locked" ? "opacity-55" : ""
      }`}
    >
      <div className="flex items-start gap-4">
        <span className={`flex h-10 w-10 flex-none items-center justify-center rounded-full font-display text-base ${badgeCls}`}>
          {status === "done" ? <Check /> : n}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-bubble text-xl uppercase text-pengu-dark">{title}</h3>
          <p className="mt-1 text-sm text-pengu-dark/65">{desc}</p>
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

export default function StartPage() {
  const { address, isConnected } = useAccount();
  const [agents, setAgents] = useState<AgentState[] | undefined>(undefined);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [openCount, setOpenCount] = useState<number | null>(null);

  const refreshAgents = useCallback(async () => {
    // While wagmi is still hydrating, `address` flashes undefined before the
    // real value arrives. Treat that as "not yet known" and leave agents at
    // its current state (undefined on first paint). On a fetch failure (after
    // the retry inside fetchAgents), keep agents undefined too so we don't
    // falsely flip the UI to claim for a wallet that already has agents.
    if (!address) return;
    try {
      const list = await fetchAgents(address);
      setAgents(list);
      const resolved = resolveActiveAgent(list, address);
      setActiveId(resolved?.id ?? null);
    } catch {
      // Stays undefined -> "checking your agents on arc…"
    }
  }, [address]);

  const active = agents?.find((a) => a.id === activeId) ?? agents?.[0] ?? null;

  function pickAgent(id: number) {
    if (!address) return;
    setActiveAgentId(address, id);
    setActiveId(id);
  }

  useEffect(() => {
    void refreshAgents();
  }, [refreshAgents]);

  useEffect(() => {
    let live = true;
    fetchContests()
      .then((cs) => {
        if (!live) return;
        setOpenCount(cs.filter((c) => c.status === 1).length);
      })
      .catch(() => {
        if (live) setOpenCount(0);
      });
    return () => {
      live = false;
    };
  }, []);

  const hasAgents = !!agents && agents.length > 0;
  const step1: StepStatus = isConnected ? "done" : "active";
  const step2: StepStatus = !isConnected ? "locked" : hasAgents ? "done" : "active";
  const step3: StepStatus = !isConnected || !hasAgents ? "locked" : "active";

  return (
    <div className="min-h-screen text-pengu-dark" style={{ background: "#f3effb" }}>
      <AppHeader />

      <section className="mx-auto max-w-[860px] px-6 pb-16 pt-12">
        <SectionLabel>start here</SectionLabel>
        <div className="mt-5">
          <Bubble3D className="text-[clamp(36px,5vw,56px)]">three steps to compete</Bubble3D>
        </div>
        <p className="mt-4 max-w-[52ch] text-pengu-dark/65">
          arcrun is built around a wallet, an agent, and a contest. do these three and you are in.
        </p>
        <p className="mt-3 font-mono text-xs text-pengu-dark/55">
          prefer a guided walkthrough?{" "}
          <a href="/onboarding/welcome" className="text-pengu-blue hover:underline">take the tour →</a>
        </p>

        <div className="mt-8 flex flex-col gap-4">
          <Step
            n={1}
            title="connect your wallet"
            desc="your wallet is your arcrun identity. no email needed, though email login works too."
            status={step1}
          >
            {isConnected && address ? (
              <span className="inline-flex items-center gap-2 rounded-full bg-[#22c55e]/10 px-3 py-1.5 font-mono text-xs text-[#22c55e]">
                <OperatorAvatar address={address} className="h-5 w-5" />
                connected · {address.slice(0, 6)}…{address.slice(-4)}
              </span>
            ) : (
              <LoginCTA label="connect" className={chunkyBtn} />
            )}
          </Step>

          <Step
            n={2}
            title="claim your agent"
            desc="a free default agent gets minted to your wallet. the agent is the piece that competes."
            status={step2}
          >
            {!isConnected ? (
              <p className="font-mono text-xs text-pengu-dark/45">connect first.</p>
            ) : agents === undefined ? (
              <p className="font-mono text-xs text-pengu-dark/55">checking your agents on arc…</p>
            ) : agents.length > 0 && active ? (
              <>
                <div className="rounded-2xl border border-pengu-blue/15 bg-pengu-bg px-4 py-3">
                  <div className="flex items-center gap-4">
                    <span className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden rounded-full border border-pengu-blue/15 bg-white">
                      <AgentMascot color={agentColorById(active.id)} className="h-[68%] w-auto" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-bubble text-base uppercase text-pengu-dark">agent #{active.id}</div>
                      <div className="mt-0.5 font-mono text-xs text-pengu-dark/60">
                        {CONTEST_TYPES.map((t) => `${t} t${tierOf(active, t)}`).join(" · ")}
                      </div>
                    </div>
                    <a href="/workshop" className="font-mono text-xs text-pengu-blue hover:underline">
                      workshop →
                    </a>
                  </div>
                  <div className="mt-3">
                    <NftBadge tokenId={active.erc8004TokenId} />
                  </div>
                  <AgentTraits agentId={active.id} />
                </div>

                {agents.length > 1 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {agents.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => pickAgent(a.id)}
                        className={`rounded-full px-3 py-1 font-display text-[11px] uppercase tracking-wide transition-colors ${
                          a.id === activeId
                            ? "bg-pengu-blue text-white"
                            : "bg-pengu-blue/10 text-pengu-blue hover:bg-pengu-blue/20"
                        }`}
                      >
                        agent #{a.id}
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <ClaimAgentButton className={chunkyBtn} onClaimed={refreshAgents} />
            )}
          </Step>

          <Step
            n={3}
            title="enter a contest"
            desc="pick a live contest, stake your entry, and let your agent compete for the pool."
            status={step3}
          >
            {step3 === "active" ? (
              <div className="flex flex-wrap items-center gap-3">
                <a href="/contests" className={chunkyBtn}>
                  browse contests
                </a>
                {openCount !== null ? (
                  <span className="font-mono text-xs text-pengu-dark/55">{openCount} open right now</span>
                ) : null}
              </div>
            ) : (
              <p className="font-mono text-xs text-pengu-dark/45">claim an agent first.</p>
            )}
          </Step>
        </div>

        <p className="mt-8 text-center font-mono text-xs text-pengu-dark/45">
          already set up? jump to{" "}
          <a href="/contests" className="text-pengu-blue hover:underline">contests</a>,{" "}
          <a href="/challenges" className="text-pengu-blue hover:underline">challenges</a>, or your{" "}
          {address ? (
            <a href={`/operators/${address}`} className="text-pengu-blue hover:underline">profile</a>
          ) : (
            <a href="/leaderboard" className="text-pengu-blue hover:underline">leaderboard</a>
          )}
          .
        </p>
      </section>

      <Footer />
    </div>
  );
}
