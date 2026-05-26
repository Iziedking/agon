"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/pengu/Footer";
import { SectionLabel } from "@/components/pengu/atoms";
import { AgentTraits } from "@/components/pengu/AgentTraits";
import { ClaimAgentButton } from "@/components/pengu/ClaimAgentButton";
import { NftBadge } from "@/components/pengu/NftBadge";
import { WorkshopScene } from "@/components/pengu/WorkshopScene";
import { UpgradeFlow } from "@/components/pengu/UpgradeFlow";
import { LoginCTA } from "@/components/pengu/LoginCTA";
import {
  ABILITIES,
  CONTEST_TYPES,
  fetchAgents,
  resolveActiveAgent,
  setActiveAgentId,
  tierOf,
  type AgentState,
} from "@/lib/agents";

const chunkyBtn =
  "rounded-pill bg-pengu-blue px-6 py-3 font-display text-sm uppercase tracking-wide text-white shadow-[0_4px_0_0_#5b34d6] transition-all duration-100 hover:translate-y-[2px] hover:shadow-[0_2px_0_0_#5b34d6] active:translate-y-[3px] disabled:opacity-60";
const chunkyBtnSmall =
  "block w-full rounded-pill bg-pengu-blue px-4 py-2 text-center font-display text-xs uppercase tracking-wide text-white shadow-[0_3px_0_0_#5b34d6] transition-all duration-100 hover:translate-y-[2px] hover:shadow-[0_1px_0_0_#5b34d6] active:translate-y-[3px] disabled:opacity-60";
const secondaryBtn =
  "rounded-pill border border-pengu-blue/30 bg-white px-5 py-2.5 font-display text-xs uppercase tracking-wide text-pengu-blue hover:border-pengu-blue";

/// The operator's workshop. Lists every agent owned by the connected wallet,
/// marks one as active (used by EnterPanel and JoinChallengePanel by default),
/// and exposes per-agent upgrade. A second "claim another agent" button at the
/// bottom mints additional agents to the same wallet.
export default function WorkshopPage() {
  const { address, isConnected } = useAccount();
  const [agents, setAgents] = useState<AgentState[] | undefined>(undefined);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [upgradingId, setUpgradingId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    // Wagmi flashes address=undefined while hydrating; don't pre-empt that
    // with an empty list (would briefly show the "claim your first agent"
    // card for someone who already has one).
    if (!address) return;
    try {
      const list = await fetchAgents(address);
      setAgents(list);
      const resolved = resolveActiveAgent(list, address);
      setActiveId(resolved?.id ?? null);
    } catch {
      setAgents([]);
      setActiveId(null);
    }
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function pickActive(id: number) {
    if (!address) return;
    setActiveAgentId(address, id);
    setActiveId(id);
  }

  const active = agents?.find((a) => a.id === activeId) ?? null;
  const upgrading = agents?.find((a) => a.id === upgradingId) ?? null;
  const level = active ? Math.max(active.scoutTier, active.analystTier, active.solverTier) : 0;

  return (
    <div className="min-h-screen text-pengu-dark" style={{ background: "#f3effb" }}>
      <AppHeader />

      <section className="mx-auto max-w-[1200px] px-6 pb-16 pt-12">
        <SectionLabel>workshop</SectionLabel>
        <h1 className="mt-5 font-bubble text-[clamp(36px,5vw,64px)] uppercase leading-tight text-pengu-dark">your workshop</h1>
        <p className="mt-3 max-w-[52ch] text-pengu-dark/65">
          your agents and their skills. one is active and enters by default; you can switch any time. upgrade a tier to
          compete harder.
        </p>

        {!isConnected ? (
          <div className="mt-10 rounded-card border border-pengu-blue/15 bg-white p-8 text-center shadow-[0_10px_30px_rgba(70,45,150,0.08)]">
            <p className="text-pengu-dark/65">connect a wallet to open your workshop and manage your agents.</p>
            <div className="mt-5 flex justify-center">
              <LoginCTA label="log in" className={chunkyBtn} />
            </div>
          </div>
        ) : agents === undefined ? (
          <p className="mt-10 font-mono text-sm text-pengu-dark/55">reading your agents from arc…</p>
        ) : agents.length === 0 ? (
          <div className="mt-10 rounded-card border border-pengu-blue/15 bg-white p-8 text-center shadow-[0_10px_30px_rgba(70,45,150,0.08)]">
            <h2 className="font-bubble text-2xl uppercase text-pengu-dark">claim your first agent</h2>
            <p className="mx-auto mt-2 max-w-[44ch] text-pengu-dark/65">
              you do not have an agent yet. claim a free default agent to start competing. this mints your onchain
              identity.
            </p>
            <div className="mt-5 flex justify-center">
              <ClaimAgentButton className={chunkyBtn} onClaimed={refresh} />
            </div>
          </div>
        ) : (
          <>
            <div className="mt-10">
              <WorkshopScene level={level} />
            </div>

            <div className="mt-12 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-bubble text-2xl uppercase text-pengu-dark">your agents</h2>
                <p className="mt-1 text-sm text-pengu-dark/60">
                  the active agent enters contests and joins challenges by default. switch it any time.
                </p>
              </div>
              <ClaimAgentButton className={secondaryBtn} label="claim another agent" onClaimed={refresh} />
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {agents.map((a) => (
                <AgentCard
                  key={a.id}
                  agent={a}
                  isActive={a.id === activeId}
                  onSetActive={() => pickActive(a.id)}
                  onUpgrade={() => setUpgradingId(a.id)}
                />
              ))}
            </div>
          </>
        )}
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

function AgentCard({
  agent,
  isActive,
  onSetActive,
  onUpgrade,
}: {
  agent: AgentState;
  isActive: boolean;
  onSetActive: () => void;
  onUpgrade: () => void;
}) {
  return (
    <div
      className={`rounded-card border bg-white p-5 shadow-[0_8px_24px_rgba(70,45,150,0.06)] ${
        isActive ? "border-pengu-blue/40 ring-2 ring-pengu-blue/15" : "border-pengu-blue/15"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-bubble text-lg uppercase text-pengu-dark">agent #{agent.id}</span>
        {isActive ? (
          <span className="rounded-full bg-pengu-blue px-2.5 py-0.5 font-display text-[10px] uppercase tracking-wide text-white">
            active
          </span>
        ) : (
          <button
            onClick={onSetActive}
            className="rounded-full bg-pengu-blue/10 px-2.5 py-0.5 font-display text-[10px] uppercase tracking-wide text-pengu-blue hover:bg-pengu-blue/20"
          >
            set active
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {CONTEST_TYPES.map((t) => {
          const cur = tierOf(agent, t);
          return (
            <div key={t} className="rounded-xl border border-pengu-blue/10 p-2.5">
              <div className="flex items-center justify-between">
                <span className="font-display text-xs uppercase text-pengu-dark">{t}</span>
                <span className="rounded-pill bg-pengu-blue/10 px-2 py-0.5 font-mono text-[11px] text-pengu-blue">
                  tier {cur}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-pengu-dark/55">{ABILITIES[t][cur]}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <NftBadge tokenId={agent.erc8004TokenId} />
      </div>
      <AgentTraits agentId={agent.id} />

      <button onClick={onUpgrade} className={`mt-4 ${chunkyBtnSmall}`}>
        upgrade
      </button>
    </div>
  );
}
