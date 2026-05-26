"use client";

import { useEffect, useState } from "react";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/pengu/Footer";
import { SectionLabel } from "@/components/pengu/atoms";
import { OperatorAvatar } from "@/components/pengu/OperatorAvatar";
import { fetchLeaderboard, formatReputation, formatUsdcString, short, type LeaderRow } from "@/lib/profiles";

const COLS = "grid-cols-[2.5rem_1fr_3.5rem_3.5rem_4rem_4.5rem_7rem]";
const PER_PAGE = 20;

/// Medal palette for the top three global ranks. The pages reset their visible
/// ranks but the medal applies to the absolute rank, so silver/bronze do not
/// reappear on page 2.
const MEDALS: Record<number, { text: string; bg: string }> = {
  1: { text: "#F59E0B", bg: "rgba(245, 158, 11, 0.08)" }, // gold
  2: { text: "#5F7A99", bg: "rgba(95, 122, 153, 0.10)" }, // silver (steel blue)
  3: { text: "#CD7F32", bg: "rgba(205, 127, 50, 0.08)" }, // bronze
};

export default function LeaderboardPage() {
  const [rows, setRows] = useState<LeaderRow[] | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let live = true;
    fetchLeaderboard(100).then((r) => {
      if (live) setRows(r);
    });
    return () => {
      live = false;
    };
  }, []);

  const total = rows?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageRows = (rows ?? []).slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  return (
    <div className="min-h-screen text-pengu-dark" style={{ background: "#f3effb" }}>
      <AppHeader />

      <section className="mx-auto max-w-[900px] px-6 pb-16 pt-12">
        <SectionLabel>leaderboard</SectionLabel>
        <h1 className="mt-5 font-bubble text-[clamp(36px,5vw,64px)] uppercase leading-tight text-pengu-dark">
          top operators
        </h1>
        <p className="mt-3 max-w-[52ch] text-pengu-dark/65">
          ranked by USDC earned across every contest, then by wins. anyone with a wallet can climb it.
        </p>

        <div className="mt-8 overflow-hidden rounded-card border border-pengu-blue/15 bg-white shadow-[0_10px_30px_rgba(70,45,150,0.08)]">
          <div className={`grid ${COLS} items-center gap-3 border-b border-pengu-blue/10 px-5 py-3 font-display text-[11px] uppercase tracking-wide text-pengu-dark/45`}>
            <span>rank</span>
            <span>operator</span>
            <span className="text-right">entered</span>
            <span className="text-right">wins</span>
            <span className="text-right">cycles</span>
            <span className="text-right">rep</span>
            <span className="text-right">earned</span>
          </div>

          {rows === null && <p className="px-5 py-8 font-mono text-sm text-pengu-dark/50">loading the board…</p>}
          {rows !== null && rows.length === 0 && (
            <p className="px-5 py-8 font-mono text-sm text-pengu-dark/50">
              no results yet. once contests settle, operators show up here.
            </p>
          )}

          {pageRows.map((r, i) => {
            const rank = (safePage - 1) * PER_PAGE + i + 1;
            const medal = MEDALS[rank];
            return (
              <a
                key={r.operator}
                href={`/operators/${r.operator}`}
                className={`grid ${COLS} items-center gap-3 border-b border-pengu-blue/5 px-5 py-3.5 transition-colors last:border-0 hover:bg-pengu-blue/5`}
                style={medal ? { backgroundColor: medal.bg } : undefined}
              >
                <span
                  className={`font-mono text-lg ${medal ? "font-medium" : "text-pengu-dark"}`}
                  style={medal ? { color: medal.text } : undefined}
                >
                  #{rank}
                </span>
                <span className="flex min-w-0 items-center gap-2.5">
                  <OperatorAvatar address={r.operator} className="h-7 w-7" />
                  <span className="truncate font-mono text-sm text-pengu-dark">{short(r.operator)}</span>
                </span>
                <span className="text-right font-mono text-sm text-pengu-dark/65">{r.entered}</span>
                <span className="text-right font-mono text-sm text-pengu-dark/65">{r.wins}</span>
                <span className="text-right font-mono text-sm text-pengu-dark/65">{r.cycles}</span>
                <span className="text-right font-mono text-sm text-pengu-dark/65">{formatReputation(r.reputation)}</span>
                <span className="text-right font-mono text-sm font-medium text-pengu-blue">{formatUsdcString(r.earned)}</span>
              </a>
            );
          })}
        </div>

        {totalPages > 1 ? (
          <div className="mt-6 flex items-center justify-center gap-3">
            <PageBtn disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
              ← prev
            </PageBtn>
            <span className="font-mono text-xs text-pengu-dark/60">
              page {safePage} of {totalPages}
            </span>
            <PageBtn disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>
              next →
            </PageBtn>
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
  const base = "rounded-pill border px-4 py-2 font-display text-xs uppercase tracking-wide transition-colors";
  if (disabled) {
    return <span className={`${base} border-pengu-blue/10 text-pengu-dark/30`}>{children}</span>;
  }
  return (
    <button onClick={onClick} className={`${base} border-pengu-blue/30 bg-white text-pengu-blue hover:border-pengu-blue`}>
      {children}
    </button>
  );
}
