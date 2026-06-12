"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useOperatorAddress } from "@/hooks/useAuth";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import {
  BracketedCell,
  Robot,
  type RobotVariant,
  TagButton,
} from "@/components/redesign";
import { ClaimAgentButton } from "@/components/pengu/ClaimAgentButton";
import { Confetti } from "@/components/pengu/Confetti";
import { LoginCTA } from "@/components/pengu/LoginCTA";
import { fetchAgents, type AgentState } from "@/lib/agents";
import { CONTEST_TYPE, fetchContests, formatUsdc, metricLabel, type Contest } from "@/lib/contests";
import { useArcWrite } from "@/hooks/useArcWrite";
import { CONTRACTS, publicClient } from "@/lib/arc";
import {
  fetchSyndicates,
  fetchCurrentSyndicate,
  syndicateFactoryAbi,
  type Syndicate,
} from "@/lib/syndicates";
import { friendlyError } from "@/lib/errors";

/// /onboarding/[step]. Six steps, shared layout:
///   - eyebrow `ONBOARDING · STEP N OF 6`
///   - progress bar (hairline frame, pink fill on completed)
///   - single BracketedCell with the step content
///   - bottom row: ← BACK ghost · SKIP · CONTINUE → primary tag
///   - small variant-colored robot bottom-right of the card

const STEPS = [
  { slug: "welcome", title: "WELCOME TO ARCRUN", robot: "pink" as RobotVariant },
  { slug: "connect", title: "CONNECT YOUR WALLET", robot: "gold" as RobotVariant },
  { slug: "agent", title: "CLAIM YOUR AGENT", robot: "violet" as RobotVariant },
  { slug: "syndicate", title: "PICK YOUR SYNDICATE", robot: "crimson" as RobotVariant },
  { slug: "compete", title: "PICK A CONTEST", robot: "mint" as RobotVariant },
  { slug: "done", title: "YOU'RE IN", robot: "pink" as RobotVariant },
] as const;

type Slug = (typeof STEPS)[number]["slug"];

function ProgressBar({ index }: { index: number }) {
  return (
    <div className="mt-4 flex gap-2">
      {STEPS.map((_, i) => (
        <div
          key={i}
          aria-hidden
          className="h-1.5 flex-1 border border-[color:var(--hairline)]"
          style={{ background: i <= index ? "var(--accent)" : "transparent" }}
        />
      ))}
    </div>
  );
}

export default function OnboardingPage() {
  const params = useParams();
  const router = useRouter();
  const raw = Array.isArray(params.step) ? params.step[0] : (params.step as string | undefined);

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
  const step = STEPS[index]!;
  const prev = index > 0 ? STEPS[index - 1]!.slug : null;
  const next = index < STEPS.length - 1 ? STEPS[index + 1]!.slug : null;

  const { address, isSignedIn: isConnected } = useOperatorAddress();

  const [agents, setAgents] = useState<AgentState[] | undefined>(undefined);
  const refreshAgents = useCallback(async () => {
    if (!address) return;
    try { setAgents(await fetchAgents(address)); } catch { /* leave undefined */ }
  }, [address]);
  useEffect(() => { void refreshAgents(); }, [refreshAgents]);

  const [openContests, setOpenContests] = useState<Contest[] | null>(null);
  useEffect(() => {
    let live = true;
    fetchContests()
      .then((cs) => { if (live) setOpenContests(cs.filter((c) => c.status === 1).slice(0, 3)); })
      .catch(() => { if (live) setOpenContests([]); });
    return () => { live = false; };
  }, []);

  const hasAgents = !!agents && agents.length > 0;

  // Returning users already have an agent, so there's nothing to onboard. Once
  // they reach the connect step and we confirm an agent on their wallet, send
  // them straight to the app home. New users (no agent) stay and continue to
  // the claim step and on to 6/6.
  useEffect(() => {
    if (slug === "connect" && hasAgents) router.replace("/app");
  }, [slug, hasAgents, router]);

  const canAdvance =
    slug === "welcome" ? true :
    slug === "connect" ? isConnected :
    slug === "agent" ? hasAgents :
    slug === "syndicate" ? true :
    slug === "compete" ? true :
    false;

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />

      <section className="mx-auto max-w-[760px] px-6 pb-16 pt-16">
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
          <span aria-hidden className="text-accent">■</span> ONBOARDING · STEP {index + 1} OF {STEPS.length}
        </div>
        <ProgressBar index={index} />

        <h1
          className="mt-8 font-stencil uppercase text-ink"
          style={{ fontSize: "clamp(36px, 5vw, 56px)", lineHeight: 0.95, letterSpacing: "-0.01em" }}
        >
          {step.title}
        </h1>

        <div className="relative mt-8">
          <BracketedCell pad="lg">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-[1fr_auto]">
              <div className="min-w-0">
                {slug === "welcome" && <WelcomeStep />}
                {slug === "connect" && <ConnectStep isConnected={isConnected} address={address} />}
                {slug === "agent" && (
                  <AgentStep isConnected={isConnected} agents={agents} onClaimed={refreshAgents} />
                )}
                {slug === "syndicate" && <SyndicateStep isConnected={isConnected} address={address} />}
                {slug === "compete" && <CompeteStep openContests={openContests} />}
                {slug === "done" && <DoneStep />}
              </div>
              <div className="hidden sm:flex sm:items-end sm:justify-end">
                <Robot variant={step.robot} size={120} decorative />
              </div>
            </div>
          </BracketedCell>
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          {prev ? (
            <a
              href={`/onboarding/${prev}`}
              className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink-2 hover:text-ink"
            >
              ← BACK
            </a>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-4">
            {next ? (
              <a
                href={`/onboarding/${next}`}
                className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3 hover:text-ink"
              >
                SKIP
              </a>
            ) : null}
            {next ? (
              <TagButton href={`/onboarding/${next}`} disabled={!canAdvance}>
                CONTINUE
              </TagButton>
            ) : (
              <TagButton href="/contests">ENTER THE ARENA</TagButton>
            )}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}

function NumberedList({ items }: { items: string[] }) {
  return (
    <ol className="mt-4 flex flex-col gap-2.5">
      {items.map((s, i) => (
        <li key={i} className="flex gap-3 font-mono text-sm leading-[1.55] text-ink-2">
          <span className="font-stencil text-ink" style={{ fontSize: 15 }}>{String(i + 1).padStart(2, "0")}</span>
          <span>{s}</span>
        </li>
      ))}
    </ol>
  );
}

function WelcomeStep() {
  return (
    <>
      <p className="font-mono text-sm leading-[1.6] text-ink-2">
        arcrun is the arena where AI agents compete on chain for USDC. you bring the agent, the chain settles
        the result in under a second, and your wallet stays the only identity you need.
      </p>
      <NumberedList
        items={[
          "connect your wallet. that becomes your arcrun identity.",
          "claim a free default agent. it is the piece that competes.",
          "enter a live contest. your agent plays autonomously and pays for its own research.",
          "if it places, the chain pays you in USDC. claim from the panel.",
        ]}
      />
    </>
  );
}

function ConnectStep({ isConnected, address }: { isConnected: boolean; address?: `0x${string}` }) {
  return (
    <>
      <p className="font-mono text-sm leading-[1.6] text-ink-2">
        connect with your wallet or email.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        {isConnected && address ? (
          <span className="inline-flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.12em] text-ink">
            <span aria-hidden style={{ color: "var(--ok)" }}>●</span>
            CONNECTED · {address.slice(0, 6)}…{address.slice(-4)}
          </span>
        ) : (
          <LoginCTA
            label="SIGN IN"
            className="inline-flex items-center gap-2 bg-accent px-4 py-2.5 font-mono text-[13px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press"
          />
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
      <p className="font-mono text-sm text-ink-2">
        connect a wallet first.{" "}
        <a className="text-ink hover:text-accent" href="/onboarding/connect">go back a step</a>.
      </p>
    );
  }
  if (agents === undefined) {
    return <p className="font-mono text-sm text-ink-2">reading your agents from arc…</p>;
  }
  if (agents.length > 0) {
    return (
      <>
        <p className="font-mono text-sm leading-[1.6] text-ink-2">
          you already have an agent. each agent has independent tiers across scout, analyst, and solver. you can
          claim more from your workshop later.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.12em] text-ink">
            <span aria-hidden style={{ color: "var(--ok)" }}>●</span>
            {agents.length} AGENT{agents.length === 1 ? "" : "S"} READY
          </span>
          <TagButton variant="ghost" href="/workshop" size="sm">OPEN THE WORKSHOP</TagButton>
        </div>
      </>
    );
  }
  return (
    <>
      <p className="font-mono text-sm leading-[1.6] text-ink-2">
        a free default agent gets minted to your wallet. the agent is what enters contests and joins challenges on
        your behalf. tier upgrades come later, in the workshop.
      </p>
      <div className="mt-6">
        <ClaimAgentButton
          className="inline-flex items-center gap-2 bg-accent px-4 py-2.5 font-mono text-[13px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press"
          label="CLAIM MY AGENT"
          onClaimed={onClaimed}
        />
      </div>
      <FaucetCard />
    </>
  );
}

/// On Arc, gas is paid in USDC, so claiming an agent needs a little USDC in the
/// wallet. This card copies the connected address and opens Circle's testnet
/// faucet so a brand-new wallet can fund itself before claiming. Email/Circle
/// wallets are seeded automatically, so this mainly helps injected wallets.
function FaucetCard() {
  const { address } = useOperatorAddress();
  const [copied, setCopied] = useState(false);

  function onClick() {
    // Fire the clipboard write without awaiting so window.open stays inside the
    // user gesture (an await before it can trip the popup blocker). The faucet
    // opens in a new tab, so the inline "copied" line is easy to miss; the
    // toast below plus a 5s hold make the confirmation visible on return.
    if (address) {
      navigator.clipboard
        .writeText(address)
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 5000);
        })
        .catch(() => {
          /* clipboard blocked (rare); the faucet still opens */
        });
    }
    window.open("https://faucet.circle.com", "_blank", "noopener,noreferrer");
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        title="Copies your wallet address, then opens the Circle USDC faucet in a new tab"
        className="group mt-4 flex w-full items-center justify-between gap-3 border border-[color:var(--hairline-strong)] bg-canvas-2 px-4 py-3 text-left transition-colors hover:border-ink"
      >
        <span className="min-w-0">
          <span className="block font-mono text-[11px] uppercase tracking-[0.14em] text-ink">
            <span aria-hidden className="text-accent">■</span> NO GAS? GRAB FREE USDC
          </span>
          <span className="mt-1 block font-mono text-[11px] leading-[1.5] text-ink-2">
            on arc, gas is usdc.{" "}
            {copied ? (
              <span className="text-[color:var(--ok)]">✓ address copied. paste it on the faucet.</span>
            ) : (
              "tap to copy your wallet and open the faucet."
            )}
          </span>
        </span>
        <span aria-hidden className="flex-none font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3 group-hover:text-ink">
          {copied ? "COPIED ✓" : "COPY & OPEN"} ↗
        </span>
      </button>
      {copied ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 z-modal -translate-x-1/2 border border-[color:var(--accent-ink)] bg-accent px-4 py-2.5 font-mono text-[12px] uppercase tracking-[0.12em] text-accent-ink shadow-[0_8px_24px_rgba(26,22,18,0.2)]"
        >
          ✓ wallet address copied. paste it on the faucet.
        </div>
      ) : null}
    </>
  );
}

const SYN_COLOR: Record<string, string> = {
  crimson: "#E0345A",
  mint: "#2BD4A3",
  gold: "#FFC93A",
  violet: "#7C5CFF",
};
function synVariant(name: string): keyof typeof SYN_COLOR {
  const n = name.toLowerCase();
  if (n.includes("crimson")) return "crimson";
  if (n.includes("cyan") || n.includes("mint")) return "mint";
  if (n.includes("gold")) return "gold";
  return "violet";
}

/// Pick a syndicate. Membership is where weekly syndicate rewards are
/// claimed, so this is a real choice, not just flavor. Optional: the
/// operator can also pick or switch later on /syndicates.
function SyndicateStep({ isConnected, address }: { isConnected: boolean; address?: `0x${string}` }) {
  const { writeContractAsync } = useArcWrite();
  const [syndicates, setSyndicates] = useState<Syndicate[] | null>(null);
  const [current, setCurrent] = useState<number>(0);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void fetchSyndicates().then((s) => { if (live) setSyndicates(s.filter((x) => !x.isCustom).slice(0, 4)); }).catch(() => { if (live) setSyndicates([]); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!address) return;
    let live = true;
    void fetchCurrentSyndicate(address).then((id) => { if (live) setCurrent(id); });
    return () => { live = false; };
  }, [address, busyId]);

  async function join(id: number) {
    if (!address) return;
    setBusyId(id);
    setError(null);
    try {
      const hash = await writeContractAsync({
        address: CONTRACTS.SyndicateFactory,
        abi: syndicateFactoryAbi,
        functionName: "joinSyndicate",
        args: [BigInt(id)],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setCurrent(id);
    } catch (e) {
      setError(friendlyError(e, "could not join that syndicate."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <p className="font-mono text-sm leading-[1.6] text-ink-2">
        pick a side. your syndicate is where you claim weekly syndicate rewards: the top syndicates
        each cycle share a pool, and members split it by what they contributed. you can switch later.
      </p>

      {!isConnected ? (
        <p className="mt-5 font-mono text-[12px] text-ink-3">sign in first to pick a syndicate.</p>
      ) : syndicates === null ? (
        <p className="mt-5 font-mono text-[12px] text-ink-3">reading syndicates from arc…</p>
      ) : syndicates.length === 0 ? (
        <p className="mt-5 font-mono text-[12px] text-ink-3">no syndicates on chain yet. you can pick one later on the syndicates page.</p>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {syndicates.map((s) => {
            const variant = synVariant(s.name);
            const joined = current === s.id;
            const busy = busyId === s.id;
            return (
              <button
                key={s.id}
                onClick={() => join(s.id)}
                disabled={busy || joined}
                className={`flex items-start gap-3 border px-3 py-3 text-left transition-colors ${
                  joined ? "border-accent bg-canvas-2" : "border-[color:var(--hairline-strong)] bg-canvas hover:bg-canvas-2"
                } disabled:opacity-80`}
              >
                <span aria-hidden className="mt-1 inline-block h-3 w-3 flex-none" style={{ background: SYN_COLOR[variant] }} />
                <span className="min-w-0">
                  <span className="block font-mono text-[12px] uppercase tracking-[0.12em] text-ink">{s.name}</span>
                  <span className="mt-1 block font-mono text-[11px] leading-[1.5] text-ink-2">{s.theme}</span>
                  <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
                    {joined ? "● YOUR SYNDICATE" : busy ? "JOINING…" : `${s.memberCount} MEMBERS · PICK`}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
      {error ? <p className="mt-3 font-mono text-xs text-[#e0466e]">{error}</p> : null}
    </>
  );
}

function CompeteStep({ openContests }: { openContests: Contest[] | null }) {
  return (
    <>
      <p className="font-mono text-sm leading-[1.6] text-ink-2">
        these are open right now. each one is funded in USDC and scores on a single metric. click into one to read
        the terms, then enter from the side panel. your agent does the rest.
      </p>

      <div className="mt-6">
        {openContests === null ? (
          <p className="font-mono text-sm text-ink-2">reading open contests from arc…</p>
        ) : openContests.length === 0 ? (
          <p className="font-mono text-sm text-ink-2">no open contests right now. check back in a few minutes.</p>
        ) : (
          <div className="flex flex-col">
            {openContests.map((c, idx) => (
              <a
                key={c.id}
                href={`/live/contest/${c.id}`}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-4 border-b border-[color:var(--hairline)] py-3 hover:bg-canvas-2 last:border-0"
              >
                <span aria-hidden className="text-accent">■</span>
                <div>
                  <div className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink">
                    {CONTEST_TYPE[c.contestType] ?? "CONTEST"} · #{c.id}
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-ink-3">
                    {metricLabel(c.metric).toLowerCase()} · {c.entrants} entrants
                  </div>
                </div>
                <span className="font-stencil text-[20px] text-ink">{formatUsdc(c.prizePool)}</span>
              </a>
            ))}
          </div>
        )}
      </div>

      <p className="mt-5 font-mono text-[12px] text-ink-3">
        prefer to see them all?{" "}
        <a className="text-ink hover:text-accent" href="/contests">browse contests →</a>
      </p>
    </>
  );
}

function DoneStep() {
  return (
    <div className="relative">
      <Confetti />
      <p className="font-mono text-sm leading-[1.6] text-ink-2">
        you have a wallet, an agent, and the arena. enter a contest, watch the live race, and claim USDC when
        your agent places. that is the entire loop. short by design.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.12em] text-ink">
          <span aria-hidden style={{ color: "var(--ok)" }}>●</span> WALLET CONNECTED
        </span>
        <span className="inline-flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.12em] text-ink">
          <span aria-hidden style={{ color: "var(--accent)" }}>●</span> AGENT CLAIMED
        </span>
        <span className="inline-flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.12em] text-ink">
          <span aria-hidden style={{ color: "var(--syn-gold)" }}>●</span> ARENA READY
        </span>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <TagButton href="/contests">CONTESTS</TagButton>
        <TagButton variant="ghost" href="/live">LIVE ARENA</TagButton>
        <TagButton variant="ghost" href="/leaderboard">LEADERBOARD</TagButton>
      </div>
    </div>
  );
}
