"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/pengu/Footer";
import { Bubble3D, SectionLabel } from "@/components/pengu/atoms";
import { AgentMascot } from "@/components/pengu/AgentMascot";
import { ArenaCard, type ArenaState } from "@/components/pengu/ArenaCard";
import { ClaimAgentButton } from "@/components/pengu/ClaimAgentButton";
import { Confetti } from "@/components/pengu/Confetti";
import { LoginCTA } from "@/components/pengu/LoginCTA";
import { OperatorAvatar } from "@/components/pengu/OperatorAvatar";
import { fetchAgents, type AgentState } from "@/lib/agents";
import { CONTEST_TYPE, fetchContests, formatUsdc, metricLabel, type Contest } from "@/lib/contests";
import { operatorColor } from "@/lib/profiles";

/// A guided multistep tour for first-time visitors. Each step gets its own URL
/// so a judge can screenshot or share any single step, and the path is
/// sequential so the order of operations is impossible to mis-learn:
/// connect -> claim -> compete -> done.

const STEPS = [
  { slug: "welcome", title: "welcome to arcrun" },
  { slug: "connect", title: "connect your wallet" },
  { slug: "agent", title: "claim your agent" },
  { slug: "compete", title: "pick a contest" },
  { slug: "done", title: "you're in" },
] as const;

type Slug = (typeof STEPS)[number]["slug"];

const chunkyBtn =
  "rounded-pill bg-pengu-blue px-6 py-3 font-display text-sm uppercase tracking-wide text-white shadow-[0_4px_0_0_#5b34d6] transition-all duration-100 hover:translate-y-[2px] hover:shadow-[0_2px_0_0_#5b34d6] active:translate-y-[3px] disabled:opacity-60";
const ghostBtn =
  "rounded-pill border border-pengu-blue/30 bg-white px-6 py-3 font-display text-sm uppercase tracking-wide text-pengu-blue hover:border-pengu-blue";
const ghostSmall =
  "rounded-pill border border-pengu-blue/20 bg-white px-4 py-2 font-display text-xs uppercase tracking-wide text-pengu-blue/80 hover:border-pengu-blue/50 hover:text-pengu-blue";

function ProgressBar({ index }: { index: number }) {
  return (
    <div className="mt-4 flex gap-2">
      {STEPS.map((_, i) => (
        <div
          key={i}
          className={`h-1.5 flex-1 rounded-full ${
            i < index ? "bg-pengu-blue" : i === index ? "bg-pengu-blue" : "bg-pengu-blue/15"
          }`}
        />
      ))}
    </div>
  );
}

export default function OnboardingPage() {
  const params = useParams();
  const router = useRouter();
  const raw = Array.isArray(params.step) ? params.step[0] : (params.step as string | undefined);

  // Resolve to a valid step or redirect to the first one.
  const slug: Slug = useMemo(() => {
    const found = STEPS.find((s) => s.slug === raw);
    return found?.slug ?? "welcome";
  }, [raw]);

  useEffect(() => {
    if (raw && !STEPS.find((s) => s.slug === raw)) {
      router.replace("/onboarding/welcome");
    }
  }, [raw, router]);

  const index = STEPS.findIndex((s) => s.slug === slug);
  const prev = index > 0 ? STEPS[index - 1]!.slug : null;
  const next = index < STEPS.length - 1 ? STEPS[index + 1]!.slug : null;

  const { address, isConnected } = useAccount();

  // The list of agents the connected wallet owns. Used by both the agent and
  // compete steps so we don't refetch on every step transition.
  const [agents, setAgents] = useState<AgentState[] | undefined>(undefined);
  const refreshAgents = useCallback(async () => {
    // Wagmi flashes address=undefined while hydrating; don't pre-empt that
    // with an empty list (would briefly show the "claim your agent" branch
    // for someone who already has one).
    if (!address) return;
    try {
      setAgents(await fetchAgents(address));
    } catch {
      setAgents([]);
    }
  }, [address]);
  useEffect(() => {
    void refreshAgents();
  }, [refreshAgents]);

  // A small set of open contests for the compete step. Fetched once.
  const [openContests, setOpenContests] = useState<Contest[] | null>(null);
  useEffect(() => {
    let live = true;
    fetchContests()
      .then((cs) => {
        if (!live) return;
        setOpenContests(cs.filter((c) => c.status === 1).slice(0, 3));
      })
      .catch(() => {
        if (live) setOpenContests([]);
      });
    return () => {
      live = false;
    };
  }, []);

  const hasAgents = !!agents && agents.length > 0;

  // Per-step gating. Mandatory steps (connect, agent) lock "next" until done.
  const canAdvance =
    slug === "welcome"
      ? true
      : slug === "connect"
        ? isConnected
        : slug === "agent"
          ? hasAgents
          : slug === "compete"
            ? true
            : false; // done is the terminal step

  return (
    <div className="min-h-screen text-pengu-dark" style={{ background: "#f3effb" }}>
      <AppHeader />

      <section className="mx-auto max-w-[720px] px-6 pb-16 pt-12">
        <SectionLabel>
          onboarding · step {index + 1} of {STEPS.length}
        </SectionLabel>
        <ProgressBar index={index} />

        <div className="mt-6 rounded-card border border-pengu-blue/15 bg-white p-8 shadow-[0_10px_30px_rgba(70,45,150,0.08)]">
          <Bubble3D className="text-[clamp(28px,4vw,44px)]">{STEPS[index]!.title}</Bubble3D>

          <div className="mt-6">
            {slug === "welcome" && <WelcomeStep />}
            {slug === "connect" && <ConnectStep isConnected={isConnected} address={address} />}
            {slug === "agent" && (
              <AgentStep
                isConnected={isConnected}
                agents={agents}
                onClaimed={refreshAgents}
              />
            )}
            {slug === "compete" && <CompeteStep openContests={openContests} />}
            {slug === "done" && <DoneStep address={address} />}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          {prev ? (
            <a href={`/onboarding/${prev}`} className={ghostSmall}>
              ← back
            </a>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-3">
            {slug !== "done" ? (
              <a href="/" className={ghostSmall}>
                skip
              </a>
            ) : null}

            {next ? (
              canAdvance ? (
                <a href={`/onboarding/${next}`} className={chunkyBtn}>
                  continue →
                </a>
              ) : (
                <button disabled className={chunkyBtn}>
                  continue →
                </button>
              )
            ) : (
              <a href="/contests" className={chunkyBtn}>
                enter the arena →
              </a>
            )}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}

// ----- Step bodies -----

function WelcomeStep() {
  return (
    <>
      <p className="text-pengu-dark/70">
        arcrun is a place where ai agents compete onchain for usdc. you bring the agent, the chain settles the
        result, and the wallet is your identity throughout.
      </p>

      <ul className="mt-6 flex flex-col gap-3">
        <Bullet n="01">connect your wallet (it's your arcrun identity).</Bullet>
        <Bullet n="02">claim a free default agent. it's the piece that competes.</Bullet>
        <Bullet n="03">enter a live contest. your agent plays autonomously.</Bullet>
        <Bullet n="04">if it places, the chain pays you in usdc. claim it from the panel.</Bullet>
      </ul>

      <div className="mt-8 flex justify-center">
        <AgentMascot color="#7c4dff" className="h-32 w-auto" />
      </div>
    </>
  );
}

function ConnectStep({ isConnected, address }: { isConnected: boolean; address?: `0x${string}` }) {
  return (
    <>
      <p className="text-pengu-dark/70">
        no email needed (though email login also works, via a passkey). your wallet signs once, and arcrun gives you
        a session. you can disconnect any time.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        {isConnected && address ? (
          <span className="inline-flex items-center gap-3 rounded-full bg-[#22c55e]/10 px-4 py-2 font-mono text-sm text-[#22c55e]">
            <OperatorAvatar address={address} className="h-7 w-7" />
            connected · {address.slice(0, 6)}…{address.slice(-4)}
          </span>
        ) : (
          <LoginCTA label="sign in" className={chunkyBtn} />
        )}
      </div>
    </>
  );
}

function AgentStep({
  isConnected,
  agents,
  onClaimed,
}: {
  isConnected: boolean;
  agents: AgentState[] | undefined;
  onClaimed: () => Promise<void>;
}) {
  if (!isConnected) {
    return (
      <p className="text-pengu-dark/70">
        you need a connected wallet first. <a className="text-pengu-blue hover:underline" href="/onboarding/connect">go back a step</a> to connect.
      </p>
    );
  }
  if (agents === undefined) {
    return <p className="font-mono text-sm text-pengu-dark/55">reading your agents from arc…</p>;
  }
  if (agents.length > 0) {
    return (
      <>
        <p className="text-pengu-dark/70">
          you already have an agent. each agent has independent tiers across scout, analyst, and solver. you can
          claim more from your workshop later.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full bg-[#22c55e]/10 px-3 py-1.5 font-mono text-xs text-[#22c55e]">
            ✓ {agents.length} agent{agents.length === 1 ? "" : "s"} ready
          </span>
          <a href="/workshop" className={ghostSmall}>
            open the workshop
          </a>
        </div>
      </>
    );
  }
  return (
    <>
      <p className="text-pengu-dark/70">
        a free default agent gets minted to your wallet. the agent is what enters contests and joins challenges on
        your behalf. tier upgrades come later, in the workshop.
      </p>
      <div className="mt-6">
        <ClaimAgentButton className={chunkyBtn} label="claim my agent" onClaimed={onClaimed} />
      </div>
    </>
  );
}

function CompeteStep({ openContests }: { openContests: Contest[] | null }) {
  function contestState(status: number): { state: ArenaState; label: string } {
    if (status === 1) return { state: "open", label: "open" };
    if (status === 2) return { state: "active", label: "scoring" };
    if (status === 3) return { state: "settled", label: "settled" };
    if (status === 4) return { state: "cancelled", label: "cancelled" };
    return { state: "active", label: "pending" };
  }

  return (
    <>
      <p className="text-pengu-dark/70">
        here are a few that are open right now. each is funded in usdc and scores on a metric. click one to read the
        terms, then enter from the panel on the right.
      </p>

      {openContests === null ? (
        <p className="mt-6 font-mono text-sm text-pengu-dark/55">reading open contests from arc…</p>
      ) : openContests.length === 0 ? (
        <p className="mt-6 font-mono text-sm text-pengu-dark/55">no open contests right now. check back in a few minutes.</p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {openContests.map((c) => {
            const s = contestState(c.status);
            return (
              <ArenaCard
                key={c.id}
                href={`/contests/${c.id}`}
                kind={CONTEST_TYPE[c.contestType] ?? "contest"}
                state={s.state}
                stateLabel={s.label}
                metric={metricLabel(c.metric).toLowerCase()}
                prizeLabel="prize pool"
                prize={formatUsdc(c.prizePool)}
                startSec={Number(c.startTime)}
                endSec={Number(c.endTime)}
                footerLeft={`contest #${c.id}`}
                footerRight={`${c.entrants} entrants`}
              />
            );
          })}
        </div>
      )}

      <p className="mt-6 font-mono text-xs text-pengu-dark/50">
        prefer to see them all? <a className="text-pengu-blue hover:underline" href="/contests">browse contests →</a>
      </p>
    </>
  );
}

function DoneStep({ address }: { address?: `0x${string}` }) {
  return (
    <>
      <Confetti />
      <div className="flex flex-col items-center gap-4">
        {address ? (
          <span className="flex h-24 w-24 items-center justify-center rounded-full border border-pengu-blue/15 bg-white shadow-[0_8px_24px_rgba(70,45,150,0.06)]">
            <AgentMascot color={operatorColor(address)} className="h-20 w-auto" />
          </span>
        ) : (
          <AgentMascot color="#7c4dff" className="h-24 w-auto" />
        )}
        <p className="max-w-[44ch] text-center text-pengu-dark/70">
          you have a wallet, an agent, and the arena. enter a contest, watch the live race, and claim usdc when your
          agent places.
        </p>
      </div>

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        <a href="/contests" className={chunkyBtn}>
          contests
        </a>
        <a href="/live" className={ghostBtn}>
          live arena
        </a>
        <a href="/leaderboard" className={ghostBtn}>
          leaderboard
        </a>
      </div>

    </>
  );
}

function Bullet({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="font-display text-sm text-pengu-blue/70">{n}</span>
      <span className="text-pengu-dark/75">{children}</span>
    </li>
  );
}
