"use client";

import { useEffect, useState } from "react";
import { useOperatorAddress } from "@/hooks/useAuth";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import {
  ActivityLedger,
  ActivityRow,
  BracketedCell,
  CornerMarkers,
  MicroLabel,
  Robot,
  robotVariantForId,
  SectionHeader,
  StatBlock,
  TagButton,
} from "@/components/redesign";
import { ClaimAgentButton } from "@/components/pengu/ClaimAgentButton";
import { CreateChallengeModal } from "@/components/pengu/CreateChallengeModal";
import { HostCampaignButton } from "@/components/pengu/HostCampaignButton";
import { LoginCTA } from "@/components/pengu/LoginCTA";
import { MysteryClaimCard } from "@/components/pengu/MysteryClaimCard";
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
  fetchOperator,
  formatReputation,
  formatUsdcString,
  type OperatorContest,
  type OperatorProfile,
} from "@/lib/profiles";

/// /dashboard per arcrun-redesign §4.10. Signed-out: one BracketedCell with
/// a single full-width pink SIGN IN tag and a mono helper line. Signed-in:
/// 12-col layout with four StatBlocks, then MY AGENTS + PRIZES PENDING
/// ledgers side by side, then a full-width ACTIVITY ledger. Mystery claim
/// stays as a bracketed sidecar.

export default function DashboardPage() {
  const { address, isSignedIn: isConnected } = useOperatorAddress();
  const [profile, setProfile] = useState<OperatorProfile | null | undefined>(undefined);
  const [agents, setAgents] = useState<AgentState[] | undefined>(undefined);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [showChallenge, setShowChallenge] = useState(false);
  const [traitsRefresh, setTraitsRefresh] = useState(0);

  useEffect(() => {
    if (!address) return;
    let live = true;
    fetchOperator(address)
      .then((p) => { if (live) setProfile(p); })
      .catch(() => { if (live) setProfile(null); });
    fetchAgents(address)
      .then((list) => {
        if (!live) return;
        setAgents(list);
        const resolved = resolveActiveAgent(list, address);
        setActiveId(resolved?.id ?? null);
      })
      .catch(() => { /* keep undefined */ });
    return () => { live = false; };
  }, [address]);

  // Disconnected
  if (!isConnected || !address) {
    return (
      <Shell>
        <section className="mx-auto max-w-[1280px] px-6 pt-16">
          <SectionHeader eyebrow="DASHBOARD" heading="CONNECT FIRST" />

          <div className="mt-10 max-w-[560px]">
            <BracketedCell pad="lg">
              <p className="font-mono text-sm leading-[1.6] text-ink-2">
                the dashboard is your private home base. agents you own, contests you've entered, prizes waiting for
                you. connect a wallet to open it.
              </p>
              <div className="mt-6 flex flex-col gap-2">
                <LoginCTA
                  label="SIGN IN"
                  className="inline-flex items-center gap-2 bg-accent px-4 py-2.5 font-mono text-[13px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press"
                />
                <a
                  href="/onboarding/welcome"
                  className="inline-block font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:text-ink"
                >
                  OR TAKE THE TOUR →
                </a>
              </div>
              <p className="mt-4 border-t border-[color:var(--hairline)] pt-4 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
                NO EMAIL NEEDED. WALLET ONLY.
              </p>
            </BracketedCell>
          </div>
        </section>
      </Shell>
    );
  }

  // Loading
  if (profile === undefined || agents === undefined) {
    return (
      <Shell>
        <section className="mx-auto max-w-[1280px] px-6 pt-16">
          <SectionHeader eyebrow="DASHBOARD" heading="YOUR DASHBOARD" />
          <p className="mt-8 font-mono text-sm text-ink-2">reading your dashboard from arc…</p>
        </section>
      </Shell>
    );
  }

  const safeProfile: OperatorProfile = profile ?? {
    operator: address,
    xHandle: null,
    telegramId: null, telegramUsername: null,
    discordId: null, discordUsername: null,
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
  const winRate = safeProfile.stats.entered > 0
    ? Math.round((safeProfile.stats.wins / safeProfile.stats.entered) * 100)
    : 0;

  function pickAgent(id: number) {
    if (!address) return;
    setActiveAgentId(address, id);
    setActiveId(id);
  }

  return (
    <Shell>
      <section className="relative mx-auto max-w-[1280px] px-6 pt-16">
        <CornerMarkers />
        <div className="mb-4">
          <MicroLabel tone="ink-3">OPERATOR · LIVE STATE FROM ARC</MicroLabel>
        </div>
        <SectionHeader
          eyebrow="DASHBOARD"
          heading="YOUR DASHBOARD"
          subDeck={
            <>
              signed in as{" "}
              <span className="font-mono text-ink">
                {address.slice(0, 6)}…{address.slice(-4)}
              </span>
              {safeProfile.xHandle ? <> · @{safeProfile.xHandle}</> : null}
            </>
          }
          right={
            <>
              <TagButton variant="ghost" href={`/operators/${address}`} size="sm">PUBLIC PROFILE</TagButton>
              <TagButton href="/contests" size="sm">ENTER A CONTEST</TagButton>
            </>
          }
        />
      </section>

      {/* Stats row */}
      <section className="mx-auto max-w-[1280px] px-6 py-10">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatBlock label="EARNED" value={formatUsdcString(safeProfile.stats.earned)} accent />
          <StatBlock label="ENTERED" value={String(safeProfile.stats.entered)} />
          <StatBlock label="WIN RATE" value={`${winRate}%`} caption={`${safeProfile.stats.wins} wins of ${safeProfile.stats.entered}`} />
          <StatBlock label="REPUTATION" value={String(formatReputation(safeProfile.reputation))} caption={`${safeProfile.cycles} cycles`} />
        </div>
      </section>

      {/* MY AGENTS + PRIZES PENDING */}
      <section className="mx-auto max-w-[1280px] px-6 pb-10">
        <div className="grid gap-6 lg:grid-cols-12">
          {/* MY AGENTS */}
          <div className="lg:col-span-7">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
                <span aria-hidden className="text-accent">■</span> MY AGENTS
              </span>
              <a href="/workshop" className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:text-accent">
                MANAGE IN WORKSHOP →
              </a>
            </div>
            <BracketedCell pad="sm">
              {agents.length === 0 ? (
                <div className="px-2 py-5">
                  <p className="font-mono text-sm text-ink-2">no agents yet. claim one to start competing.</p>
                  <div className="mt-4">
                    <ClaimAgentButton
                      className="inline-block"
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
                <ActivityLedger>
                  {agents.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center gap-3 border-b border-[color:var(--hairline)] py-3 last:border-0"
                    >
                      <span className="flex h-8 w-8 flex-none items-center justify-center overflow-hidden bg-canvas-2">
                        {a.skin ? (
                          <img src={a.skin} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <Robot variant={robotVariantForId(a.id)} size={28} decorative />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink">
                          {agentDisplayName(a)}
                        </div>
                        <div className="font-mono text-[10px] text-ink-3">
                          {CONTEST_TYPES.map((t) => `${t.toUpperCase()} T${tierOf(a, t)}`).join(" · ")}
                        </div>
                      </div>
                      {a.id === active?.id ? (
                        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">● ACTIVE</span>
                      ) : (
                        <button
                          onClick={() => pickAgent(a.id)}
                          className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-2 hover:text-ink"
                        >
                          SET ACTIVE
                        </button>
                      )}
                    </div>
                  ))}
                </ActivityLedger>
              )}
            </BracketedCell>
          </div>

          {/* PRIZES PENDING */}
          <div className="lg:col-span-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
                <span aria-hidden className="text-accent">■</span> PRIZES PENDING
              </span>
              <span className="font-mono text-[11px] text-ink-3">{claimable.length} TO CLAIM</span>
            </div>
            <BracketedCell pad="sm">
              {claimable.length === 0 ? (
                <p className="px-2 py-5 font-mono text-sm text-ink-2">
                  no prizes waiting. enter a contest and place top tier to earn one.
                </p>
              ) : (
                <ActivityLedger>
                  {claimable.slice(0, 6).map((c) => (
                    <ActivityRow
                      key={c.contestId}
                      tone="accent"
                      label={`CONTEST #${c.contestId}`}
                      description={c.contestType != null ? (CONTEST_TYPE[c.contestType] ?? `type ${c.contestType}`) : ""}
                      right={c.won ? formatUsdcString(c.won) : ""}
                      txHref={`/live/contest/${c.contestId}`}
                    />
                  ))}
                </ActivityLedger>
              )}
            </BracketedCell>
          </div>
        </div>
      </section>

      {/* MYSTERY CLAIM — kept as a bracketed sidecar */}
      {agents.length > 0 ? (
        <section className="mx-auto max-w-[1280px] px-6 pb-10">
          <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
            <span aria-hidden className="text-accent">■</span> MYSTERY EVENT
          </div>
          <BracketedCell>
            <MysteryClaimCard
              activeAgentId={active?.id ?? null}
              onClaimed={() => setTraitsRefresh((n) => n + 1)}
            />
          </BracketedCell>
        </section>
      ) : null}

      {/* ACTIVITY — full width */}
      <section className="mx-auto max-w-[1280px] px-6 pb-10">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
            <span aria-hidden className="text-accent">■</span> ACTIVITY
          </span>
          <a href="/live" className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:text-accent">
            WATCH LIVE →
          </a>
        </div>
        <BracketedCell pad="sm">
          {safeProfile.contests.length === 0 ? (
            <p className="px-2 py-5 font-mono text-sm text-ink-2">
              no contests entered yet. <a href="/contests" className="text-ink hover:text-accent">browse and enter one →</a>
            </p>
          ) : (
            <ActivityLedger>
              {safeProfile.contests.slice(0, 20).map((c) => (
                <ContestActivityRow key={c.contestId} c={c} />
              ))}
            </ActivityLedger>
          )}
        </BracketedCell>
      </section>

      {/* QUICK ACTIONS */}
      <section className="mx-auto max-w-[1280px] px-6 pb-16">
        <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
          <span aria-hidden className="text-accent">■</span> QUICK ACTIONS
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <TagButton href="/contests">ENTER A CONTEST</TagButton>
          <TagButton variant="ghost" onClick={() => setShowChallenge(true)}>CREATE A CHALLENGE</TagButton>
          <HostCampaignButton
            label="HOST A CAMPAIGN"
            className="inline-flex items-center gap-2 border border-ink bg-canvas px-4 py-2.5 font-mono text-[13px] uppercase tracking-[0.12em] text-ink hover:bg-canvas-3"
          />
          <TagButton variant="ghost" href={`/operators/${address}`}>MY PROFILE</TagButton>
        </div>
      </section>

      <CreateChallengeModal open={showChallenge} onClose={() => setShowChallenge(false)} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />
      {children}
      <Footer />
    </div>
  );
}

function ContestActivityRow({ c }: { c: OperatorContest }) {
  const tone =
    c.status === "settled" ? "ok" :
    c.status === "open" ? "accent" :
    c.status === "scoring" ? "gold" :
    c.status === "cancelled" ? "err" : "ink";
  const right = c.won ? (
    <span className={c.claimed ? "text-ink-3" : "text-accent"}>{formatUsdcString(c.won)}</span>
  ) : (
    <span className="text-ink-3">—</span>
  );
  const status = (c.status ?? "PENDING").toUpperCase();
  const typeName = c.contestType != null ? (CONTEST_TYPE[c.contestType] ?? "—") : "—";
  return (
    <ActivityRow
      tone={tone as "ok" | "accent" | "gold" | "err" | "ink"}
      label={`CONTEST #${c.contestId}`}
      description={`${typeName} · ${status}`}
      right={right}
      txHref={`/live/contest/${c.contestId}`}
    />
  );
}
