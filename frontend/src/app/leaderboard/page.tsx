"use client";

import { useEffect, useState } from "react";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/pengu/Footer";
import { SectionLabel } from "@/components/pengu/atoms";
import { fetchLeaderboard, formatUsdcString, short, type LeaderRow } from "@/lib/profiles";

export default function LeaderboardPage() {
  const [rows, setRows] = useState<LeaderRow[] | null>(null);

  useEffect(() => {
    let live = true;
    fetchLeaderboard(100).then((r) => {
      if (live) setRows(r);
    });
    return () => {
      live = false;
    };
  }, []);

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
          <div className="grid grid-cols-[3rem_1fr_5rem_5rem_8rem] items-center gap-4 border-b border-pengu-blue/10 px-5 py-3 font-display text-[11px] uppercase tracking-wide text-pengu-dark/45">
            <span>rank</span>
            <span>operator</span>
            <span className="text-right">entered</span>
            <span className="text-right">wins</span>
            <span className="text-right">earned</span>
          </div>

          {rows === null && <p className="px-5 py-8 font-mono text-sm text-pengu-dark/50">loading the board…</p>}
          {rows !== null && rows.length === 0 && (
            <p className="px-5 py-8 font-mono text-sm text-pengu-dark/50">
              no results yet. once contests settle, operators show up here.
            </p>
          )}

          {rows?.map((r, i) => {
            const rank = i + 1;
            const top = rank === 1;
            return (
              <a
                key={r.operator}
                href={`/operators/${r.operator}`}
                className={`grid grid-cols-[3rem_1fr_5rem_5rem_8rem] items-center gap-4 border-b border-pengu-blue/5 px-5 py-3.5 transition-colors last:border-0 hover:bg-pengu-blue/5 ${
                  top ? "bg-[#F59E0B]/5" : ""
                }`}
              >
                <span className={`font-mono text-lg ${top ? "text-[#F59E0B]" : "text-pengu-dark/45"}`}>#{rank}</span>
                <span className="truncate font-mono text-sm text-pengu-dark">{short(r.operator)}</span>
                <span className="text-right font-mono text-sm text-pengu-dark/65">{r.entered}</span>
                <span className="text-right font-mono text-sm text-pengu-dark/65">{r.wins}</span>
                <span className="text-right font-mono text-sm font-medium text-pengu-blue">{formatUsdcString(r.earned)}</span>
              </a>
            );
          })}
        </div>
      </section>

      <Footer />
    </div>
  );
}
