"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAccount } from "wagmi";
import { useAuth } from "@/hooks/useAuth";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import {
  BracketedCell,
  CornerMarkers,
  Robot,
  robotVariantForId,
  SectionHeader,
  StatBlock,
  TagButton,
  WorkshopScene,
} from "@/components/redesign";
import { TrainingPanel } from "@/components/redesign/TrainingPanel";
import { ArcanaWalletPanel } from "@/components/redesign/ArcanaWalletPanel";
import { StrengthBreakdown } from "@/components/pengu/StrengthBreakdown";
import { AgentAvatar } from "@/components/pengu/AgentAvatar";
import { AgentTraits } from "@/components/pengu/AgentTraits";
import { ClaimAgentButton } from "@/components/pengu/ClaimAgentButton";
import { NftBadge } from "@/components/pengu/NftBadge";
import { UpgradeFlow } from "@/components/pengu/UpgradeFlow";
import { LoginCTA } from "@/components/pengu/LoginCTA";
import {
  ABILITIES,
  agentDisplayName,
  CONTEST_TYPES,
  fetchAgents,
  resolveActiveAgent,
  setActiveAgentId,
  tierOf,
  type AgentState,
} from "@/lib/agents";

/// /workshop. Disconnected: one BracketedCell + a
/// pink SIGN IN tag. Connected: two-column layout. Left = agent list as
/// ledger rows. Right = the active agent's Robot + bracketed STATS block.
///
/// useSearchParams() forces a CSR bailout on this route, so Next 15 requires
/// the consumer to live inside a Suspense boundary for the static build to
/// succeed. The outer default export is the Suspense wrapper; the body is
/// WorkshopPageBody below.

export default function WorkshopPage() {
  return (
    <Suspense fallback={null}>
      <WorkshopPageBody />
    </Suspense>
  );
}

function WorkshopPageBody() {
  const { address: walletAddress, isConnected: walletConnected } = useAccount();
  const { me } = useAuth();
  // Accept either an injected-wallet connection or a SIWE session address.
  // Circle passkey users have me.address but no wagmi connection; gating
  // on isConnected alone locked them out of the workshop.
  const address = (walletAddress ?? me?.address) as `0x${string}` | undefined;
  const isConnected = walletConnected || !!me?.address;
  const searchParams = useSearchParams();
  const [agents, setAgents] = useState<AgentState[] | undefined>(undefined);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [upgradingId, setUpgradingId] = useState<number | null>(null);

  /// Deep-link target: /workshop?agent=14 selects agent #14 as active so the
  /// training panel below renders for that agent. Used by the operator profile
  /// "TRAIN WITH SKILLS" link.
  const requestedAgentId = (() => {
    const raw = searchParams?.get("agent");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  })();

  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      const list = await fetchAgents(address);
      setAgents(list);
      const requested = requestedAgentId && list.some((a) => a.id === requestedAgentId)
        ? list.find((a) => a.id === requestedAgentId)
        : null;
      const resolved = requested ?? resolveActiveAgent(list, address);
      setActiveId(resolved?.id ?? null);
      if (requested) setActiveAgentId(address, requested.id);
    } catch {
      // Leave undefined -> "reading your agents from arc…"
    }
  }, [address, requestedAgentId]);

  useEffect(() => { void refresh(); }, [refresh]);

  /// After the training section mounts for the requested agent, scroll it
  /// into view. One shot per requested-id change.
  useEffect(() => {
    if (!requestedAgentId || activeId !== requestedAgentId) return;
    const el = document.getElementById(`train-${requestedAgentId}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [requestedAgentId, activeId]);

  const active = agents?.find((a) => a.id === activeId) ?? null;
  const upgrading = agents?.find((a) => a.id === upgradingId) ?? null;

  function pickActive(id: number) {
    if (!address) return;
    setActiveAgentId(address, id);
    setActiveId(id);
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />

      <section className="relative mx-auto max-w-[1600px] px-6 pt-16">
        <CornerMarkers />
        <SectionHeader
          heading="WORKSHOP"
          subDeck={
            <>
              your agents and their skills. the active one enters contests for you.
            </>
          }
          right={isConnected && agents && agents.length > 0 ? (
            <ClaimAgentButton
              className="inline-flex items-center gap-2 border border-ink bg-canvas px-4 py-2.5 font-mono text-[13px] uppercase tracking-[0.12em] text-ink hover:bg-canvas-3"
              label="CLAIM ANOTHER AGENT"
              onClaimed={refresh}
            />
          ) : null}
        />
      </section>

      <section className="mx-auto max-w-[1600px] px-6 py-10 pb-16">
        {!isConnected ? (
          <BracketedCell className="max-w-[560px]" pad="lg">
            <p className="font-mono text-sm leading-[1.6] text-ink-2">
              connect a wallet to open your workshop and manage your agents.
            </p>
            <div className="mt-6">
              <LoginCTA
                label="SIGN IN"
                className="inline-flex items-center gap-2 bg-accent px-4 py-2.5 font-mono text-[13px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press"
              />
            </div>
          </BracketedCell>
        ) : agents === undefined ? (
          <p className="font-mono text-sm text-ink-2">reading your agents from arc…</p>
        ) : agents.length === 0 ? (
          <BracketedCell className="max-w-[560px]" pad="lg">
            <h2 className="font-stencil uppercase text-ink" style={{ fontSize: 28 }}>
              CLAIM YOUR FIRST AGENT
            </h2>
            <p className="mt-3 font-mono text-sm leading-[1.6] text-ink-2">
              you do not have an agent yet. claim a free default agent to start competing. this mints your onchain
              identity.
            </p>
            <div className="mt-6">
              <ClaimAgentButton
                className="inline-flex items-center gap-2 bg-accent px-4 py-2.5 font-mono text-[13px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press"
                label="CLAIM AGENT"
                onClaimed={refresh}
              />
            </div>
          </BracketedCell>
        ) : (
          <div className="grid gap-6 lg:grid-cols-12">
            {/* Left: agents as ledger rows */}
            <div className="lg:col-span-7">
              <div className="mb-3 flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
                  <span aria-hidden className="text-accent">■</span> MY AGENTS
                </span>
                <span className="font-mono text-[11px] text-ink-3">{agents.length} TOTAL</span>
              </div>
              <BracketedCell pad="sm">
                <div className="flex flex-col">
                  {agents.map((a) => {
                    const isActive = a.id === activeId;
                    return (
                      <button
                        key={a.id}
                        onClick={() => pickActive(a.id)}
                        className={`flex w-full items-center gap-3 border-b border-[color:var(--hairline)] py-3 text-left transition-colors last:border-0 hover:bg-canvas-2 ${
                          isActive ? "bg-canvas-2" : ""
                        }`}
                      >
                        <span className="flex h-8 w-8 flex-none items-center justify-center overflow-hidden bg-canvas-3">
                          <AgentAvatar agent={a} size={28} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink">
                            {agentDisplayName(a)}
                          </div>
                          <div className="font-mono text-[10px] text-ink-3">
                            {CONTEST_TYPES.map((t) => `${t.toUpperCase()} T${tierOf(a, t)}`).join(" · ")}
                          </div>
                        </div>
                        {isActive ? (
                          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">● ACTIVE</span>
                        ) : (
                          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">SELECT</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </BracketedCell>
            </div>

            {/* Right: active agent + stats + upgrade */}
            <div className="lg:col-span-5">
              {active ? (
                <ActiveAgentPanel
                  agent={active}
                  onUpgrade={() => setUpgradingId(active.id)}
                />
              ) : null}
            </div>
          </div>
        )}

        {/* Training panel: six stats per agent. Full-width below the grid
            so the six bars have horizontal room. Owner-only, read by
            the auth API which gates writes by SIWE ownership. */}
        {active ? (
          <div id={`train-${active.id}`} className="mt-10 scroll-mt-24">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
                <span aria-hidden className="text-accent">■</span> TRAINING ·{" "}
                <span className="text-ink-3">{agentDisplayName(active)}</span>
              </span>
              <span className="font-mono text-[11px] text-ink-3">PERMANENT PER-LEVEL BOOST</span>
            </div>
            <TrainingPanel agentId={active.id} />
            <StrengthBreakdown agentId={active.id} />
            <div className="mt-6">
              <ArcanaWalletPanel agentId={active.id} />
            </div>
          </div>
        ) : null}
      </section>

      <Footer />

      {upgrading ? (
        <UpgradeFlow
          open={upgradingId !== null}
          onClose={() => setUpgradingId(null)}
          agent={upgrading}
          onUpgraded={async () => {
            await refresh();
            setUpgradingId(null);
          }}
        />
      ) : null}
    </div>
  );
}

function ActiveAgentPanel({ agent, onUpgrade }: { agent: AgentState; onUpgrade: () => void }) {
  const maxTier = Math.max(agent.scoutTier, agent.analystTier, agent.solverTier);
  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
          <span aria-hidden className="text-accent">■</span> ACTIVE AGENT
        </span>
        <span className="font-mono text-[11px] text-ink-3">MAX TIER {maxTier}</span>
      </div>
      <div className="mb-3">
        <WorkshopScene maxTier={maxTier} variant={robotVariantForId(agent.id)} />
      </div>
      <BracketedCell>
        <div className="flex flex-col items-center text-center">
          <span className="flex h-32 w-32 items-center justify-center overflow-hidden bg-canvas-3">
            {agent.skin ? (
              <img src={agent.skin} alt={agent.nickname ?? `agent #${agent.id}`} className="h-full w-full object-cover" />
            ) : (
              <Robot variant={robotVariantForId(agent.id)} size={108} decorative />
            )}
          </span>
          <div className="mt-4 font-stencil uppercase text-ink" style={{ fontSize: 22, letterSpacing: "-0.01em" }}>
            {agentDisplayName(agent)}
          </div>
          <div className="mt-2">
            <NftBadge tokenId={agent.erc8004TokenId} />
          </div>
          <AgentTraits agentId={agent.id} />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3">
          {CONTEST_TYPES.map((t) => {
            const cur = tierOf(agent, t);
            return (
              <div key={t} className="border-t border-[color:var(--hairline)] pt-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">{t.toUpperCase()}</span>
                  <span className="font-stencil text-[18px] text-ink">T{cur}</span>
                </div>
                <p className="mt-1 font-mono text-[11px] text-ink-2">{ABILITIES[t][cur]}</p>
              </div>
            );
          })}
        </div>

        <div className="mt-6">
          <TagButton onClick={onUpgrade} className="w-full justify-center">UPGRADE</TagButton>
        </div>
      </BracketedCell>

      <div className="mt-4">
        <StatBlock label="ERC-8004 TOKEN" value={`#${agent.erc8004TokenId.toString()}`} caption="onchain identity" />
      </div>
    </>
  );
}
