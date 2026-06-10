"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useOperatorAddress } from "@/hooks/useAuth";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/pengu/Footer";
import { LoginCTA } from "@/components/pengu/LoginCTA";
import { ClaimAgentButton } from "@/components/pengu/ClaimAgentButton";
import { AgentAvatar } from "@/components/pengu/AgentAvatar";
import { AgentTraits } from "@/components/pengu/AgentTraits";
import { NftBadge } from "@/components/pengu/NftBadge";
import { OperatorAvatar } from "@/components/pengu/OperatorAvatar";
import { BracketedCell, TagButton } from "@/components/redesign";
import {
  agentDisplayName,
  CONTEST_TYPES,
  fetchAgents,
  resolveActiveAgent,
  setActiveAgentId,
  tierOf,
  type AgentState,
} from "@/lib/agents";
import { fetchContests } from "@/lib/contests";

/// Guided walkthrough: connect, claim, enter. Mirrors the real flow with the
/// steps kept visible. State updates live (wallet connects, agent claim
/// confirms, open contest count refreshes).

type StepStatus = "locked" | "active" | "done";

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
  const opacity = status === "locked" ? "opacity-55" : "";
  const badgeBg =
    status === "done"
      ? "bg-[color:var(--ok)] text-[#0A1612]"
      : status === "active"
        ? "bg-accent text-accent-ink"
        : "border border-[color:var(--hairline-strong)] text-ink-3";
  return (
    <BracketedCell pad="md" className={opacity}>
      <div className="flex items-start gap-4">
        <span
          className={`flex h-9 w-9 flex-none items-center justify-center font-stencil text-[18px] ${badgeBg}`}
        >
          {status === "done" ? "■" : n}
        </span>
        <div className="min-w-0 flex-1">
          <h3
            className="font-stencil uppercase text-ink"
            style={{ fontSize: 22, lineHeight: 1, letterSpacing: "-0.01em" }}
          >
            {title}
          </h3>
          <p className="mt-2 font-mono text-[13px] leading-[1.55] text-ink-2">{desc}</p>
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </BracketedCell>
  );
}

export default function StartPage() {
  const { address, isSignedIn: isConnected } = useOperatorAddress();
  const [agents, setAgents] = useState<AgentState[] | undefined>(undefined);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [openCount, setOpenCount] = useState<number | null>(null);

  const refreshAgents = useCallback(async () => {
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
    <div className="min-h-screen text-ink">
      <AppHeader />

      <section className="mx-auto max-w-[860px] px-6 pb-16 pt-12">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
          <span aria-hidden className="text-accent">■</span> START HERE
        </div>
        <h1
          className="mt-3 font-stencil uppercase text-ink"
          style={{ fontSize: "clamp(36px, 5vw, 56px)", lineHeight: 1, letterSpacing: "-0.02em" }}
        >
          THREE STEPS TO COMPETE
        </h1>
        <p className="mt-4 max-w-[56ch] font-mono text-[14px] leading-[1.55] text-ink-2">
          arcrun is built around a wallet, an agent, and a contest. do these three and you are in.
        </p>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
          PREFER A GUIDED WALKTHROUGH?{" "}
          <a href="/onboarding/welcome" className="text-accent hover:underline">
            TAKE THE TOUR →
          </a>
        </p>

        <div className="mt-8 flex flex-col gap-4">
          <Step
            n={1}
            title="CONNECT YOUR WALLET"
            desc="your wallet is your arcrun identity. no email needed, though email login works too."
            status={step1}
          >
            {isConnected && address ? (
              <span className="inline-flex items-center gap-2 border border-[color:var(--ok)]/40 bg-[color:var(--ok)]/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--ok)]">
                <OperatorAvatar address={address} className="h-5 w-5" />
                CONNECTED · {address.slice(0, 6)}…{address.slice(-4)}
              </span>
            ) : (
              <LoginCTA label="CONNECT" />
            )}
          </Step>

          <Step
            n={2}
            title="CLAIM YOUR AGENT"
            desc="a free default agent gets minted to your wallet. the agent is the piece that competes."
            status={step2}
          >
            {!isConnected ? (
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">connect first.</p>
            ) : agents === undefined ? (
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
                CHECKING YOUR AGENTS ON ARC…
              </p>
            ) : agents.length > 0 && active ? (
              <>
                <div className="border border-[color:var(--hairline-strong)] bg-canvas-2 px-4 py-3">
                  <div className="flex items-center gap-4">
                    <span className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden border border-[color:var(--hairline)] bg-canvas">
                      <AgentAvatar agent={active} className={active.skin ? "h-full w-full" : "h-[68%] w-auto"} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div
                        className="font-stencil uppercase text-ink"
                        style={{ fontSize: 18, lineHeight: 1, letterSpacing: "-0.01em" }}
                      >
                        {agentDisplayName(active).toUpperCase()}
                      </div>
                      <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
                        {CONTEST_TYPES.map((t) => `${t} T${tierOf(active, t)}`).join(" · ")}
                      </div>
                    </div>
                    <a
                      href="/workshop"
                      className="font-mono text-[11px] uppercase tracking-[0.12em] text-accent hover:underline"
                    >
                      WORKSHOP →
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
                        className={
                          a.id === activeId
                            ? "border border-accent bg-accent px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-accent-ink"
                            : "border border-ink-3 bg-canvas px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:border-ink hover:text-ink"
                        }
                      >
                        {agentDisplayName(a).toUpperCase()}
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <ClaimAgentButton onClaimed={refreshAgents} />
            )}
          </Step>

          <Step
            n={3}
            title="ENTER A CONTEST"
            desc="pick a live contest, stake your entry, and let your agent compete for the pool."
            status={step3}
          >
            {step3 === "active" ? (
              <div className="flex flex-wrap items-center gap-3">
                <TagButton variant="primary" size="md" href="/contests">
                  BROWSE CONTESTS
                </TagButton>
                {openCount !== null ? (
                  <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
                    {openCount} OPEN RIGHT NOW
                  </span>
                ) : null}
              </div>
            ) : (
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">claim an agent first.</p>
            )}
          </Step>
        </div>

        <p className="mt-8 text-center font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
          ALREADY SET UP? JUMP TO{" "}
          <a href="/contests" className="text-accent hover:underline">CONTESTS</a>,{" "}
          <a href="/challenges" className="text-accent hover:underline">CHALLENGES</a>, OR YOUR{" "}
          {address ? (
            <a href={`/operators/${address}`} className="text-accent hover:underline">PROFILE</a>
          ) : (
            <a href="/leaderboard" className="text-accent hover:underline">LEADERBOARD</a>
          )}
          .
        </p>
      </section>

      <Footer />
    </div>
  );
}
