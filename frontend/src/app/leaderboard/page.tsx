"use client";

import { useEffect, useState } from "react";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import { Robot, SectionHeader, robotVariantForId } from "@/components/redesign";
import { fetchLeaderboard, formatReputation, formatUsdcString, short, type LeaderRow } from "@/lib/profiles";

/// /leaderboard per arcrun-redesign §4.7. True mono table, not a rounded
/// card: header row in --ink-3 mono caps with a hairline below, rows
/// alternate --canvas and --canvas-2, rank in stencil face (pink for top 3,
/// ink otherwise), operator cell shows a 24px flat Robot + truncated
/// address mono, earned right-aligned in accent.

const COLS = "grid-cols-[3rem_1fr_3.5rem_3.5rem_4rem_4.5rem_7rem]";
const PER_PAGE = 20;

// Hash an operator address to a Robot variant so each row has a stable
// mascot color across reloads.
function robotVariantForOperator(addr: string): Parameters<typeof Robot>[0]["variant"] {
  let h = 0;
  for (let i = 2; i < Math.min(addr.length, 16); i++) h = (h * 31 + addr.charCodeAt(i)) >>> 0;
  return robotVariantForId(h);
}

export default function LeaderboardPage() {
  const [rows, setRows] = useState<LeaderRow[] | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let live = true;
    fetchLeaderboard(100).then((r) => { if (live) setRows(r); });
    return () => { live = false; };
  }, []);

  const total = rows?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageRows = (rows ?? []).slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />

      <section className="mx-auto max-w-[1080px] px-6 pt-16">
        <SectionHeader
          eyebrow="LEADERBOARD"
          heading="TOP OPERATORS"
          subDeck={<>ranked by USDC earned across every contest, then by wins. anyone with a wallet can climb it.</>}
        />
      </section>

      <section className="mx-auto max-w-[1080px] px-6 py-10 pb-16">
        {/* Header row */}
        <div className={`grid ${COLS} items-center gap-3 border-b border-[color:var(--hairline-strong)] py-3 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3`}>
          <span>RANK</span>
          <span>OPERATOR</span>
          <span className="text-right">ENTERED</span>
          <span className="text-right">WINS</span>
          <span className="text-right">CYCLES</span>
          <span className="text-right">REP</span>
          <span className="text-right">EARNED</span>
        </div>

        {rows === null ? (
          <p className="py-8 font-mono text-sm text-ink-2">loading the board…</p>
        ) : rows.length === 0 ? (
          <p className="py-8 font-mono text-sm text-ink-2">
            no results yet. once contests settle, operators show up here.
          </p>
        ) : (
          pageRows.map((r, i) => {
            const rank = (safePage - 1) * PER_PAGE + i + 1;
            const topThree = rank <= 3;
            const isAlt = i % 2 === 1;
            return (
              <a
                key={r.operator}
                href={`/operators/${r.operator}`}
                className={`grid ${COLS} items-center gap-3 border-b border-[color:var(--hairline)] py-3 transition-colors hover:bg-canvas-3 last:border-0`}
                style={{ background: isAlt ? "var(--canvas-2)" : undefined }}
              >
                <span
                  className="font-stencil"
                  style={{
                    fontSize: 20,
                    color: topThree ? "var(--accent)" : "var(--ink)",
                  }}
                >
                  #{rank}
                </span>
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-6 w-6 flex-none items-center justify-center bg-canvas-3">
                    <Robot variant={robotVariantForOperator(r.operator)} size={22} decorative />
                  </span>
                  <span className="truncate font-mono text-[13px] text-ink">{short(r.operator)}</span>
                </span>
                <span className="text-right font-mono text-[13px] text-ink-2">{r.entered}</span>
                <span className="text-right font-mono text-[13px] text-ink-2">{r.wins}</span>
                <span className="text-right font-mono text-[13px] text-ink-2">{r.cycles}</span>
                <span className="text-right font-mono text-[13px] text-ink-2">{formatReputation(r.reputation)}</span>
                <span className="text-right font-mono text-[13px] text-accent">{formatUsdcString(r.earned)}</span>
              </a>
            );
          })
        )}

        {totalPages > 1 ? (
          <div className="mt-8 flex items-center justify-center gap-6">
            <PageBtn disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>← PREV</PageBtn>
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
              PAGE {safePage} OF {totalPages}
            </span>
            <PageBtn disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>NEXT →</PageBtn>
          </div>
        ) : null}
      </section>

      <Footer />
    </div>
  );
}

function PageBtn({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3 opacity-40 select-none">
        {children}
      </span>
    );
  }
  return (
    <button
      onClick={onClick}
      className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink hover:text-accent"
    >
      {children}
    </button>
  );
}
