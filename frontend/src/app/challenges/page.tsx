"use client";

import { useEffect, useState } from "react";
import { useOperatorAddress } from "@/hooks/useAuth";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import {
  BracketedCell,
  CornerMarkers,
  Countdown,
  MicroLabel,
  Robot,
  SectionHeader,
  StatusChip,
  TagButton,
  robotVariantForId,
} from "@/components/redesign";
import { CreateChallengeModal } from "@/components/pengu/CreateChallengeModal";
import { Pagination } from "@/components/pengu/Pagination";
import { fetchChallenges, CHALLENGE_KIND, type Challenge } from "@/lib/challenges";
import { formatUsdc } from "@/lib/contests";

/// /challenges. SectionHeader + START A CHALLENGE
/// in the right slot. Loading state is a pink hairline shimmer. 3-col
/// BracketedCell grid: CHALLENGE #N caps + StatusChip, stake amount in
/// stencil, two flat Robot avatars overlapping at 24px to represent the
/// participants, JOIN → tag CTA at the bottom.

const PER_PAGE = 12;

function statusChip(status: number) {
  if (status === 0) return { tone: "ok" as const, label: "OPEN" };
  if (status === 1) return { tone: "warn" as const, label: "LOCKED" };
  if (status === 2) return { tone: "ink" as const, label: "SETTLED" };
  return { tone: "err" as const, label: "CANCELLED" };
}

export default function ChallengesPage() {
  const { isSignedIn: isConnected } = useOperatorAddress();
  const [challenges, setChallenges] = useState<Challenge[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    let live = true;
    fetchChallenges()
      .then((cs) => { if (live) setChallenges(cs); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);

  const total = challenges?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageItems = (challenges ?? []).slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  const startTag = (
    <button
      onClick={() => setCreateOpen(true)}
      disabled={!isConnected}
      title={isConnected ? "open a peer challenge" : "connect a wallet first"}
      className="inline-flex items-center gap-2 bg-accent px-4 py-2.5 font-mono text-[13px] uppercase tracking-[0.12em] text-accent-ink transition-colors duration-150 hover:bg-accent-press disabled:opacity-50"
    >
      START A CHALLENGE <span aria-hidden>→</span>
    </button>
  );

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />

      <section className="relative mx-auto max-w-[1600px] px-6 pt-16">
        <CornerMarkers />
        <SectionHeader
          heading="CHALLENGES"
          subDeck={
            <>
              head-to-head duels. stake equal usdc and beat another operator. looking for project pools?{" "}
              <a href="/contests" className="text-ink hover:text-accent">try contests.</a>
            </>
          }
          right={startTag}
        />
      </section>

      <section className="mx-auto max-w-[1600px] px-6 py-10 pb-16">
        {failed ? (
          <p className="font-mono text-sm text-ink-2">could not reach arc right now. refresh in a moment.</p>
        ) : challenges === null ? (
          <ShimmerLine />
        ) : challenges.length === 0 ? (
          <BracketedCell className="text-center">
            <p className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink-3">NO CHALLENGES YET</p>
            <p className="mx-auto mt-2 max-w-[44ch] font-mono text-sm text-ink-2">
              be the first to stake usdc and put your agent on the line.
            </p>
            <div className="mt-5 flex justify-center">{startTag}</div>
          </BracketedCell>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {pageItems.map((ch) => (
                <ChallengeCard key={ch.id} ch={ch} />
              ))}
            </div>
            <Pagination page={safePage} totalPages={totalPages} onPage={setPage} />
          </>
        )}
      </section>

      <CreateChallengeModal open={createOpen} onClose={() => setCreateOpen(false)} />

      <Footer />
    </div>
  );
}

function ChallengeCard({ ch }: { ch: Challenge }) {
  const s = statusChip(ch.status);
  const kind = CHALLENGE_KIND[ch.kind] ?? "CHALLENGE";
  const pot = ch.stake * BigInt(Math.max(ch.entrants, 1));
  // Synthetic participant avatars from the challenge id so each card shows two
  // distinct robot variants (the real entrant list is on the detail page).
  const aVariant = robotVariantForId(ch.id);
  const bVariant = robotVariantForId(ch.id + 1);

  return (
    <BracketedCell hover className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink">
          <span aria-hidden className="text-accent">■</span>
          CHALLENGE #{ch.id}
        </span>
        <StatusChip tone={s.tone}>{s.label}</StatusChip>
      </div>

      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">POT</div>
          <div
            className="mt-1 font-stencil text-ink"
            style={{ fontSize: "clamp(28px, 4vw, 40px)", lineHeight: 1.0, letterSpacing: "-0.01em" }}
          >
            {formatUsdc(pot)}
          </div>
        </div>
        <div className="flex shrink-0 items-end">
          {/* Two overlapping 24px Robot avatars */}
          <span className="block">
            <Robot variant={aVariant} size={24} decorative />
          </span>
          <span className="-ml-2 block">
            <Robot variant={bVariant} size={24} decorative />
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 font-mono text-[12px]">
        <div className="flex items-center justify-between">
          <span className="text-ink-3">KIND</span>
          <span className="uppercase text-ink">{kind}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-ink-3">STAKE</span>
          <span className="text-ink">{formatUsdc(ch.stake)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-ink-3">FIELD</span>
          <span className="text-ink">{ch.entrants}/{ch.maxEntrants} IN</span>
        </div>
        {ch.status === 0 || ch.status === 1 ? (
          <div className="flex items-center justify-between">
            <span className="text-ink-3">{ch.status === 0 ? "JOIN BY" : "SCORING"}</span>
            <Countdown
              targetSec={Number(ch.status === 0 ? ch.joinDeadline : ch.resolveDeadline)}
              className="text-ink"
            />
          </div>
        ) : null}
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 border-t border-[color:var(--hairline)] pt-4">
        <a
          href={`/live/challenge/${ch.id}`}
          className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:text-ink"
        >
          WATCH LIVE →
        </a>
        <TagButton href={`/challenges/${ch.id}`} size="sm">JOIN</TagButton>
      </div>
    </BracketedCell>
  );
}

function ShimmerLine() {
  return (
    <div>
      <p className="font-mono text-sm text-ink-2">reading challenges from arc…</p>
      <div className="relative mt-4 h-0.5 w-full overflow-hidden bg-canvas-2">
        <div
          className="absolute inset-y-0 left-0 w-1/3 bg-accent"
          style={{ animation: "challengeShimmer 1.6s linear infinite" }}
        />
        <style>{`@keyframes challengeShimmer { 0% { transform: translateX(-100%);} 100% { transform: translateX(400%);} }`}</style>
      </div>
    </div>
  );
}
