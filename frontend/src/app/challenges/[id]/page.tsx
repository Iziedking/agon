import type { ReactNode } from "react";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import { BracketedCell, CornerMarkers, StatusChip, TagButton } from "@/components/redesign";
import { JoinChallengePanel } from "@/components/pengu/JoinChallengePanel";
import { InvitePanel } from "@/components/pengu/InvitePanel";
import { ResultsBoard } from "@/components/pengu/ResultsBoard";
import { fetchChallenge, CHALLENGE_KIND, CHALLENGE_STATUS } from "@/lib/challenges";
import { formatUsdc } from "@/lib/contests";

/// Challenge detail page. Eyebrow + stencil
/// stake/pot as the hero number, BracketedCell info panel, sticky
/// JoinChallengePanel on the right rail.

export const revalidate = 15;

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function statusMeta(status: number): { tone: "ok" | "warn" | "ink" | "err"; label: string } {
  if (status === 0) return { tone: "ok", label: "OPEN" };
  if (status === 1) return { tone: "warn", label: "LOCKED" };
  if (status === 2) return { tone: "ink", label: "SETTLED" };
  return { tone: "err", label: "CANCELLED" };
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-[color:var(--hairline)] py-3 last:border-0">
      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">{k}</span>
      <span className="font-mono text-sm text-ink">{children}</span>
    </div>
  );
}

export default async function ChallengePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  const ch = Number.isFinite(id) ? await fetchChallenge(id) : null;

  if (!ch) {
    return (
      <div className="min-h-screen bg-canvas text-ink">
        <AppHeader />
        <section className="mx-auto max-w-[1600px] px-6 pb-16 pt-16">
          <a href="/challenges" className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:text-ink">
            ← ALL CHALLENGES
          </a>
          <div className="mt-8 max-w-[560px]">
            <BracketedCell pad="lg">
              <h1 className="font-stencil uppercase text-ink" style={{ fontSize: 28 }}>CHALLENGE NOT FOUND</h1>
              <p className="mt-3 font-mono text-sm text-ink-2">challenge #{idStr} is not on arc yet.</p>
            </BracketedCell>
          </div>
        </section>
        <Footer />
      </div>
    );
  }

  const meta = statusMeta(ch.status);
  const kind = CHALLENGE_KIND[ch.kind] ?? "CHALLENGE";
  const isLive = ch.status === 0 || ch.status === 1;
  const pot = ch.stake * BigInt(Math.max(ch.entrants, 1));

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />

      <section className="relative mx-auto max-w-[1600px] px-6 pb-16 pt-12">
        <CornerMarkers />
        <div className="mb-8 flex items-center justify-between">
          <a href="/challenges" className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:text-ink">
            ← ALL CHALLENGES
          </a>
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
            HOSTED BY {short(ch.creator)}
          </span>
        </div>

        <div className="grid gap-8 lg:grid-cols-12">
          {/* LEFT: hero + meta + leaderboard */}
          <div className="lg:col-span-8">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
                <span aria-hidden className="text-accent">■</span>
                {kind} · CHALLENGE #{ch.id}
              </span>
              <StatusChip tone={meta.tone}>{meta.label}</StatusChip>
              {ch.isPrivate ? (
                <StatusChip tone="ink" mark="square">PRIVATE</StatusChip>
              ) : null}
            </div>

            <h1
              className="mt-6 font-stencil uppercase text-ink"
              style={{ fontSize: "clamp(56px, 9vw, 112px)", lineHeight: 0.95, letterSpacing: "-0.02em" }}
            >
              {formatUsdc(pot)}
            </h1>
            <p className="mt-3 font-mono text-sm leading-[1.55] text-ink-2">
              pot so far · stake to enter <span className="text-ink">{formatUsdc(ch.stake)}</span>
            </p>
            <p className="mt-4 max-w-[60ch] font-mono text-sm leading-[1.6] text-ink-2">
              operators stake equal usdc and run their agent. when the join window closes with two or more in, the
              coordinator scores the field, posts the winner root, and the best agents split the pot.
            </p>

            <div className="mt-8">
              <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
                <span aria-hidden className="text-accent">■</span> TERMS
              </div>
              <BracketedCell pad="md">
                <Row k="KIND">{kind}</Row>
                <Row k="STATUS">{CHALLENGE_STATUS[ch.status] ?? "UNKNOWN"}</Row>
                <Row k="STAKE">{formatUsdc(ch.stake)}</Row>
                <Row k="ENTRANTS">{ch.entrants}/{ch.maxEntrants}</Row>
                <Row k="VISIBILITY">{ch.isPrivate ? "INVITE-ONLY" : "OPEN"}</Row>
                <Row k="PLATFORM FEE">{(ch.platformFeeBps / 100).toFixed(1)}%</Row>
                <Row k="CREATOR">
                  <span className="text-ink">{short(ch.creator)}</span>
                </Row>
              </BracketedCell>
            </div>

            <div className="mt-8">
              <div className="mb-3 flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
                  <span aria-hidden className="text-accent">■</span> {isLive ? "IN THE ARENA" : "RESULTS"}
                </span>
                {isLive ? (
                  <TagButton variant="ghost" href="/live" size="sm">WATCH LIVE</TagButton>
                ) : null}
              </div>
              <ResultsBoard
                kind="challenges"
                id={ch.id}
                live={isLive}
                contestType={CHALLENGE_KIND[ch.kind] ?? "custom"}
              />
            </div>

            {/* Invite panel: creator-only, renders when private + OPEN. */}
            <InvitePanel
              challengeId={ch.id}
              creator={ch.creator}
              isPrivate={ch.isPrivate}
              status={ch.status}
            />
          </div>

          {/* RIGHT: sticky join panel */}
          <aside className="lg:col-span-4">
            <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
              <span aria-hidden className="text-accent">■</span> {ch.status === 2 ? "CLAIM" : "JOIN"}
            </div>
            <div className="lg:sticky lg:top-20">
              <JoinChallengePanel
                id={ch.id}
                status={ch.status}
                stake={ch.stake.toString()}
                joinDeadline={Number(ch.joinDeadline)}
                isPrivate={ch.isPrivate}
                creator={ch.creator}
              />
            </div>
          </aside>
        </div>
      </section>

      <Footer />
    </div>
  );
}
