"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/pengu/Footer";
import { Bubble3D, SectionLabel } from "@/components/pengu/atoms";
import { AgentMascot } from "@/components/pengu/AgentMascot";
import { AgentTraits } from "@/components/pengu/AgentTraits";
import { ClaimAgentButton } from "@/components/pengu/ClaimAgentButton";
import { CreateChallengeModal } from "@/components/pengu/CreateChallengeModal";
import { HostCampaignButton } from "@/components/pengu/HostCampaignButton";
import { LoginCTA } from "@/components/pengu/LoginCTA";
import { MysteryClaimCard } from "@/components/pengu/MysteryClaimCard";
import { NftBadge } from "@/components/pengu/NftBadge";
import { OperatorAvatar } from "@/components/pengu/OperatorAvatar";
import {
  CONTEST_TYPES,
  agentDisplayName,
  fetchAgents,
  resolveActiveAgent,
  setActiveAgentId,
  tierOf,
  type AgentState,
} from "@/lib/agents";
import { CONTEST_TYPE } from "@/lib/contests";
import {
  agentColorById,
  fetchOperator,
  formatReputation,
  formatUsdcString,
  type OperatorContest,
  type OperatorProfile,
} from "@/lib/profiles";

/// The operator's private home base. Distinct from /operators/[address], which
/// is the public reputation page anyone can see; the dashboard is the connected
/// wallet's command center: agents in play, contests in flight, prizes to
/// claim, quick actions to do the next thing.

const chunkyBtn =
  "block w-full rounded-pill bg-pengu-blue px-6 py-3 text-center font-display text-sm uppercase tracking-wide text-white shadow-[0_4px_0_0_#5b34d6] transition-all duration-100 hover:translate-y-[2px] hover:shadow-[0_2px_0_0_#5b34d6] active:translate-y-[3px] disabled:opacity-60";
const ghostBtn =
  "block w-full rounded-pill border border-pengu-blue/30 bg-white px-6 py-3 text-center font-display text-sm uppercase tracking-wide text-pengu-blue transition-colors hover:border-pengu-blue";

export default function DashboardPage() {
  const { address, isConnected } = useAccount();
  const [profile, setProfile] = useState<OperatorProfile | null | undefined>(undefined);
  const [agents, setAgents] = useState<AgentState[] | undefined>(undefined);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [showChallenge, setShowChallenge] = useState(false);
  const [traitsRefresh, setTraitsRefresh] = useState(0);

  useEffect(() => {
    if (!address) return;
    let live = true;
    fetchOperator(address)
      .then((p) => {
        if (live) setProfile(p);
      })
      .catch(() => {
        if (live) setProfile(null);
      });
    fetchAgents(address)
      .then((list) => {
        if (!live) return;
        setAgents(list);
        const resolved = resolveActiveAgent(list, address);
        setActiveId(resolved?.id ?? null);
      })
      .catch(() => {
        // On a fetch failure (already retried inside fetchAgents) leave agents
        // undefined so the dashboard keeps showing "loading" rather than
        // falsely rendering the "no agents" claim card.
      });
    return () => {
      live = false;
    };
  }, [address]);

  // Disconnected
  if (!isConnected || !address) {
    return (
      <Shell>
        <section className="mx-auto max-w-[640px] px-6 pb-16 pt-12">
          <SectionLabel>dashboard</SectionLabel>
          <div className="mt-5">
            <Bubble3D className="text-[clamp(28px,4vw,40px)]">connect first</Bubble3D>
          </div>
          <p className="mt-4 text-pengu-dark/65">
            the dashboard is your private home base for arcrun. agents you own, contests you've entered, prizes
            waiting for you. connect a wallet to open it.
          </p>
          <div className="mt-6">
            <LoginCTA label="sign in" className={chunkyBtn} />
          </div>
        </section>
      </Shell>
    );
  }

  // Loading the connected wallet's data
  if (profile === undefined || agents === undefined) {
    return (
      <Shell>
        <section className="mx-auto max-w-[1200px] px-6 pb-16 pt-12">
          <SectionLabel>dashboard</SectionLabel>
          <p className="mt-6 font-mono text-sm text-pengu-dark/55">loading your dashboard…</p>
        </section>
      </Shell>
    );
  }

  const safeProfile: OperatorProfile = profile ?? {
    operator: address,
    xHandle: null,
    syndicateId: null,
    cycles: 0,
    reputation: "0",
    stats: { entered: 0, wins: 0, earned: "0" },
    agents: [],
    contests: [],
  };

  const claimable = safeProfile.contests.filter((c) => c.won && Number(c.won) > 0 && !c.claimed);
  const inFlight = safeProfile.contests.filter((c) => c.status === "open" || c.status === "scoring");
  const active = agents.find((a) => a.id === activeId) ?? agents[0] ?? null;

  function pickAgent(id: number) {
    if (!address) return;
    setActiveAgentId(address, id);
    setActiveId(id);
  }

  return (
    <Shell>
      <section className="mx-auto max-w-[1200px] px-6 pt-12">
        <SectionLabel>dashboard</SectionLabel>
        <div className="mt-5 flex flex-wrap items-center gap-5">
          <OperatorAvatar address={address} className="h-16 w-16 shadow-[0_8px_24px_rgba(70,45,150,0.06)]" />
          <div className="min-w-0">
            <Bubble3D className="text-[clamp(28px,4vw,44px)]">your dashboard</Bubble3D>
            <p className="mt-1 font-mono text-sm text-pengu-blue">
              {address.slice(0, 6)}…{address.slice(-4)}
              {safeProfile.xHandle ? <span className="text-pengu-dark/55"> · @{safeProfile.xHandle}</span> : null}
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-6 py-8">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="entered" value={String(safeProfile.stats.entered)} />
          <Stat label="wins" value={String(safeProfile.stats.wins)} />
          <Stat label="earned" value={formatUsdcString(safeProfile.stats.earned)} />
          <Stat label="cycles" value={String(safeProfile.cycles)} />
          <Stat label="reputation" value={String(formatReputation(safeProfile.reputation))} />
        </div>
      </section>

      {agents.length > 0 ? (
        <section className="mx-auto max-w-[1200px] px-6 pb-8">
          <SectionLabel>mystery event</SectionLabel>
          <div className="mt-5">
            <MysteryClaimCard
              activeAgentId={active?.id ?? null}
              onClaimed={() => setTraitsRefresh((n) => n + 1)}
            />
          </div>
        </section>
      ) : null}

      {(claimable.length > 0 || inFlight.length > 0) && (
        <section className="mx-auto max-w-[1200px] px-6 pb-8">
          <SectionLabel>action items</SectionLabel>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {claimable.length > 0 && (
              <ActionCard
                tone="prize"
                title={`${claimable.length} prize${claimable.length === 1 ? "" : "s"} to claim`}
                body="open each contest below and hit claim to pull the usdc into your wallet."
                items={claimable.slice(0, 4).map((c) => ({
                  href: `/contests/${c.contestId}`,
                  label: `contest #${c.contestId}`,
                  value: c.won ? formatUsdcString(c.won) : "",
                }))}
              />
            )}
            {inFlight.length > 0 && (
              <ActionCard
                tone="live"
                title={`${inFlight.length} contest${inFlight.length === 1 ? "" : "s"} running`}
                body="your agent is competing. watch the race live, or wait for the chain to settle."
                items={inFlight.slice(0, 4).map((c) => ({
                  href: `/contests/${c.contestId}`,
                  label: `contest #${c.contestId}`,
                  value: c.status ?? "",
                }))}
              />
            )}
          </div>
        </section>
      )}

      <section className="mx-auto max-w-[1200px] px-6 pb-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SectionLabel>your agents</SectionLabel>
          <a href="/workshop" className="font-display text-xs uppercase tracking-wide text-pengu-blue hover:underline">
            manage in workshop →
          </a>
        </div>

        {agents.length === 0 ? (
          <div className="mt-5 rounded-card border border-pengu-blue/15 bg-white p-6 text-center shadow-[0_10px_30px_rgba(70,45,150,0.08)]">
            <p className="text-pengu-dark/65">no agents yet. claim one to start competing.</p>
            <div className="mt-4 flex justify-center">
              <ClaimAgentButton
                className={chunkyBtn}
                onClaimed={async () => {
                  if (!address) return;
                  const list = await fetchAgents(address);
                  setAgents(list);
                  const resolved = resolveActiveAgent(list, address);
                  setActiveId(resolved?.id ?? null);
                }}
              />
            </div>
          </div>
        ) : (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((a) => (
              <AgentTile
                key={a.id}
                agent={a}
                isActive={a.id === active?.id}
                onSetActive={() => pickAgent(a.id)}
                traitsRefresh={traitsRefresh}
              />
            ))}
          </div>
        )}
      </section>

      <section className="mx-auto max-w-[1200px] px-6 pb-8">
        <SectionLabel>quick actions</SectionLabel>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <a href="/contests" className={chunkyBtn}>
            enter a contest
          </a>
          <button onClick={() => setShowChallenge(true)} className={ghostBtn}>
            create a challenge
          </button>
          <HostCampaignButton className={ghostBtn} />
          <a href={`/operators/${address}`} className={ghostBtn}>
            my public profile
          </a>
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-6 pb-16">
        <SectionLabel>recent contests</SectionLabel>
        <div className="mt-5 overflow-hidden rounded-card border border-pengu-blue/15 bg-white shadow-[0_8px_24px_rgba(70,45,150,0.06)]">
          {safeProfile.contests.length === 0 ? (
            <p className="px-5 py-8 font-mono text-sm text-pengu-dark/50">
              no contests entered yet. <a href="/contests" className="text-pengu-blue hover:underline">browse and enter one →</a>
            </p>
          ) : (
            safeProfile.contests.map((ct) => <ContestRow key={ct.contestId} c={ct} />)
          )}
        </div>
      </section>

      <CreateChallengeModal open={showChallenge} onClose={() => setShowChallenge(false)} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen text-pengu-dark" style={{ background: "#f3effb" }}>
      <AppHeader />
      {children}
      <Footer />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-pengu-blue/15 bg-white px-5 py-4 shadow-[0_8px_24px_rgba(70,45,150,0.06)]">
      <div className="font-display text-[11px] uppercase tracking-wide text-pengu-dark/45">{label}</div>
      <div className="mt-1 font-mono text-2xl text-pengu-dark">{value}</div>
    </div>
  );
}

function ActionCard({
  tone,
  title,
  body,
  items,
}: {
  tone: "prize" | "live";
  title: string;
  body: string;
  items: { href: string; label: string; value: string }[];
}) {
  const accent = tone === "prize" ? "#7c4dff" : "#22c55e";
  return (
    <div className="rounded-card border border-pengu-blue/15 bg-white p-6 shadow-[0_10px_30px_rgba(70,45,150,0.08)]">
      <div className="flex items-center gap-2 font-display text-xs uppercase tracking-wide" style={{ color: accent }}>
        {tone === "live" ? <span className="h-2 w-2 rounded-full bg-[#22c55e] animate-pulse-live" /> : null}
        {tone === "prize" ? "claim" : "live"}
      </div>
      <h3 className="mt-2 font-bubble text-xl uppercase text-pengu-dark">{title}</h3>
      <p className="mt-2 text-sm text-pengu-dark/65">{body}</p>
      <div className="mt-4 flex flex-col gap-2">
        {items.map((it) => (
          <a
            key={it.href}
            href={it.href}
            className="flex items-center justify-between gap-3 rounded-xl border border-pengu-blue/10 bg-pengu-bg px-3 py-2 transition-transform duration-150 hover:-translate-y-0.5"
          >
            <span className="font-mono text-sm text-pengu-dark">{it.label}</span>
            <span className="font-mono text-sm" style={{ color: accent }}>
              {it.value}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

function AgentTile({
  agent,
  isActive,
  onSetActive,
  traitsRefresh,
}: {
  agent: AgentState;
  isActive: boolean;
  onSetActive: () => void;
  traitsRefresh?: number;
}) {
  return (
    <div
      className={`rounded-card border bg-white p-5 shadow-[0_8px_24px_rgba(70,45,150,0.06)] ${
        isActive ? "border-pengu-blue/40 ring-2 ring-pengu-blue/15" : "border-pengu-blue/15"
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 flex-none items-center justify-center overflow-hidden rounded-full border border-pengu-blue/15 bg-white">
          <AgentMascot color={agentColorById(agent.id)} className="h-[68%] w-auto" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-bubble text-base uppercase text-pengu-dark">{agentDisplayName(agent)}</div>
          <div className="font-mono text-[11px] text-pengu-dark/55">
            {CONTEST_TYPES.map((t) => `${t} t${tierOf(agent, t)}`).join(" · ")}
          </div>
        </div>
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

      <div className="mt-3">
        <NftBadge tokenId={agent.erc8004TokenId} />
      </div>
      <AgentTraits agentId={agent.id} refreshKey={traitsRefresh} />
    </div>
  );
}

function ContestRow({ c }: { c: OperatorContest }) {
  return (
    <a
      href={`/contests/${c.contestId}`}
      className="grid grid-cols-[4rem_1fr_6rem_7rem] items-center gap-3 border-b border-pengu-blue/5 px-5 py-3.5 transition-colors last:border-0 hover:bg-pengu-blue/5"
    >
      <span className="font-mono text-sm text-pengu-dark/70">#{c.contestId}</span>
      <span className="font-mono text-xs uppercase text-pengu-blue">
        {c.contestType == null ? "—" : (CONTEST_TYPE[c.contestType] ?? c.contestType)}
      </span>
      <span className="font-mono text-xs text-pengu-dark/55">{c.status ?? "—"}</span>
      <span className="text-right font-mono text-sm">
        {c.won ? (
          <span className={c.claimed ? "text-pengu-dark/55" : "text-pengu-blue"}>{formatUsdcString(c.won)}</span>
        ) : (
          <span className="text-pengu-dark/35">—</span>
        )}
      </span>
    </a>
  );
}
