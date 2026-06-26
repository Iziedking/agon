"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import { CornerMarkers, Robot, SectionHeader, robotVariantForId } from "@/components/redesign";
import { fetchLeaderboard, formatReputation, formatUsdcString, short, type LeaderRow } from "@/lib/profiles";
import { fetchSyndicateLeaderboard, type SyndicateLeaderRow } from "@/lib/syndicates";

type View = "operators" | "syndicates";

/// /leaderboard. True mono table, not a rounded
/// card: header row in --ink-3 mono caps with a hairline below, rows
/// alternate --canvas and --canvas-2, rank in stencil face (pink for top 3,
/// ink otherwise), operator cell shows a 24px flat Robot + truncated
/// address mono, earned right-aligned in accent.

/// On mobile we drop ENTERED, CYCLES and REP to keep the row scannable
/// inside a 360px viewport. WINS and EARNED carry the ranking, OPERATOR
/// is the identity. Tablet (sm) brings ENTERED back, desktop (md) adds
/// CYCLES + REP.
const COLS =
  "grid-cols-[2.25rem_1fr_3rem_7rem] " +
  "sm:grid-cols-[3rem_1fr_3rem_3.5rem_7rem] " +
  "md:grid-cols-[3rem_1fr_3.5rem_3.5rem_4rem_4.5rem_7rem]";
const PER_PAGE = 20;

// Hash an operator address to a Robot variant so each row has a stable
// mascot color across reloads.
function robotVariantForOperator(addr: string): Parameters<typeof Robot>[0]["variant"] {
  let h = 0;
  for (let i = 2; i < Math.min(addr.length, 16); i++) h = (h * 31 + addr.charCodeAt(i)) >>> 0;
  return robotVariantForId(h);
}

type RankedRow = LeaderRow & { rank: number };

/// True if the row's wallet, X handle, Discord username, or custom name
/// contains the query. Case-insensitive, `@` and `0x` prefixes ignored so
/// "izie", "@izie", "0xab" all match naturally.
function matchesQuery(r: RankedRow, q: string): boolean {
  const needle = q.trim().toLowerCase().replace(/^[@#]/, "");
  if (!needle) return true;
  const hay = [
    r.operator,
    r.primaryName,
    r.xHandle ? `@${r.xHandle}` : null,
    r.xHandle,
    r.discordUsername,
    r.customName,
  ];
  return hay.some((h) => h != null && h.toLowerCase().includes(needle));
}

export default function LeaderboardPage() {
  const { address } = useAccount();
  const me = address?.toLowerCase();
  const [view, setView] = useState<View>("operators");
  const [rows, setRows] = useState<LeaderRow[] | null>(null);
  const [synRows, setSynRows] = useState<SyndicateLeaderRow[] | null>(null);
  const [page, setPage] = useState(1);
  const [queryText, setQueryText] = useState("");

  useEffect(() => {
    let live = true;
    fetchLeaderboard(200).then((r) => { if (live) setRows(r); });
    fetchSyndicateLeaderboard().then((r) => { if (live) setSynRows(r); });
    return () => { live = false; };
  }, []);

  // Absolute rank is the position in the full sorted board, stamped once so it
  // survives searching and paging (a filtered row still shows its real rank).
  const ranked: RankedRow[] = useMemo(
    () => (rows ?? []).map((r, i) => ({ ...r, rank: i + 1 })),
    [rows],
  );
  const searching = queryText.trim().length > 0;
  const filtered = useMemo(
    () => (searching ? ranked.filter((r) => matchesQuery(r, queryText)) : ranked),
    [ranked, searching, queryText],
  );

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  // Searching shows every match on one screen so the operator finds their
  // position without paging; the normal board stays paginated.
  const pageRows = searching ? filtered : filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />

      <section className="relative mx-auto max-w-[1600px] px-6 pt-16">
        <CornerMarkers />
        <SectionHeader
          heading="LEADERBOARD"
          subDeck={
            view === "operators" ? (
              <>ranked by wins, then usdc earned.</>
            ) : (
              <>syndicates ranked by lifetime reputation their members have earned.</>
            )
          }
        />
      </section>

      {/* OPERATORS / SYNDICATES toggle */}
      <section className="mx-auto max-w-[1600px] px-6 pt-6">
        <div className="inline-flex border border-[color:var(--hairline-strong)]">
          {(["operators", "syndicates"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => { setView(v); setPage(1); }}
              className={`px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors ${
                view === v ? "bg-accent text-accent-ink" : "bg-canvas text-ink-2 hover:text-ink"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </section>

      {view === "operators" ? (
      <>
      <section className="mx-auto max-w-[1600px] px-6 pt-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px] max-w-[420px]">
            <span
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[12px] text-ink-3"
            >
              ⌕
            </span>
            <input
              value={queryText}
              onChange={(e) => { setQueryText(e.target.value); setPage(1); }}
              placeholder="SEARCH WALLET · X · DISCORD · NAME"
              aria-label="Search the leaderboard by wallet, X handle, Discord, or custom name"
              className="w-full border border-[color:var(--hairline-strong)] bg-canvas py-2.5 pl-8 pr-3 font-mono text-[12px] uppercase tracking-[0.08em] text-ink placeholder:text-ink-3 focus:border-ink focus:outline-none"
            />
          </div>
          {queryText ? (
            <button
              onClick={() => { setQueryText(""); setPage(1); }}
              className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3 hover:text-accent"
            >
              CLEAR ✕
            </button>
          ) : null}
          {searching ? (
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
              {total} {total === 1 ? "MATCH" : "MATCHES"}
            </span>
          ) : null}
        </div>
      </section>

      <section className="mx-auto max-w-[1600px] px-6 py-6 pb-16">
        {/* Header row. Column visibility tracks the grid breakpoints. */}
        <div className={`grid ${COLS} items-center gap-3 border-b border-[color:var(--hairline-strong)] py-3 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3`}>
          <span>RANK</span>
          <span>OPERATOR</span>
          <span className="hidden text-right sm:block">ENTERED</span>
          <span className="text-right">WINS</span>
          <span className="hidden text-right md:block">CYCLES</span>
          <span className="hidden text-right md:block">REP</span>
          <span className="text-right">EARNED</span>
        </div>

        {rows === null ? (
          <p className="py-8 font-mono text-sm text-ink-2">loading the board…</p>
        ) : rows.length === 0 ? (
          <p className="py-8 font-mono text-sm text-ink-2">
            no results yet. once contests settle, operators show up here.
          </p>
        ) : pageRows.length === 0 ? (
          <p className="py-8 font-mono text-sm text-ink-2">
            no operator matches “{queryText.trim()}”. try a wallet, @x handle, discord, or name.
          </p>
        ) : (
          pageRows.map((r, i) => {
            const rank = r.rank;
            const topThree = rank <= 3;
            const isAlt = i % 2 === 1;
            const mine = !!me && r.operator.toLowerCase() === me;
            return (
              <a
                key={r.operator}
                href={`/operators/${r.operator}`}
                className={`grid ${COLS} items-center gap-3 border-b border-[color:var(--hairline)] py-3 transition-colors hover:bg-canvas-3 last:border-0`}
                style={{ background: mine ? "var(--canvas-3)" : isAlt ? "var(--canvas-2)" : undefined }}
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
                  <span className="flex h-6 w-6 flex-none items-center justify-center overflow-hidden bg-canvas-3">
                    {r.primarySkin ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.primarySkin}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <Robot variant={robotVariantForOperator(r.operator)} size={22} decorative />
                    )}
                  </span>
                  <span className="truncate font-mono text-[13px] text-ink" title={r.operator}>
                    {r.primaryName ?? short(r.operator)}
                  </span>
                  {mine ? (
                    <span className="flex-none border border-ink bg-canvas px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink">
                      YOU
                    </span>
                  ) : null}
                </span>
                <span className="hidden text-right font-mono text-[13px] text-ink-2 sm:block">{r.entered}</span>
                <span className="text-right font-mono text-[13px] text-ink-2">{r.wins}</span>
                <span className="hidden text-right font-mono text-[13px] text-ink-2 md:block">{r.cycles}</span>
                <span className="hidden text-right font-mono text-[13px] text-ink-2 md:block">{formatReputation(r.reputation)}</span>
                <span className="whitespace-nowrap text-right font-mono text-[12px] text-accent sm:text-[13px]">{formatUsdcString(r.earned)}</span>
              </a>
            );
          })
        )}

        {!searching && totalPages > 1 ? (
          <div className="mt-8 flex items-center justify-center gap-6">
            <PageBtn disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>← PREV</PageBtn>
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
              PAGE {safePage} OF {totalPages}
            </span>
            <PageBtn disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>NEXT →</PageBtn>
          </div>
        ) : null}
      </section>
      </>
      ) : (
        <SyndicateBoard rows={synRows} />
      )}

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

/// Lifetime syndicate board: each syndicate by cumulative reputation its members
/// have contributed. Links to the syndicate page.
function SyndicateBoard({ rows }: { rows: SyndicateLeaderRow[] | null }) {
  const COLS = "grid-cols-[2.25rem_1fr_4rem_6rem] sm:grid-cols-[3rem_1fr_5rem_7rem]";
  return (
    <section className="mx-auto max-w-[1600px] px-6 py-6 pb-16">
      <div className={`grid ${COLS} items-center gap-3 border-b border-[color:var(--hairline-strong)] py-3 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3`}>
        <span>RANK</span>
        <span>SYNDICATE</span>
        <span className="text-right">MEMBERS</span>
        <span className="text-right">REPUTATION</span>
      </div>

      {rows === null ? (
        <p className="py-8 font-mono text-sm text-ink-2">loading syndicates…</p>
      ) : rows.length === 0 ? (
        <p className="py-8 font-mono text-sm text-ink-2">
          no syndicate reputation yet. once members compete and contests settle, syndicates rank here.
        </p>
      ) : (
        rows.map((r, i) => {
          const topThree = r.rank <= 3;
          const isAlt = i % 2 === 1;
          return (
            <a
              key={r.syndicateId}
              href={`/syndicates/${r.syndicateId}`}
              className={`grid ${COLS} items-center gap-3 border-b border-[color:var(--hairline)] py-3 transition-colors hover:bg-canvas-3 last:border-0`}
              style={{ background: isAlt ? "var(--canvas-2)" : undefined }}
            >
              <span className="font-stencil" style={{ fontSize: 20, color: topThree ? "var(--accent)" : "var(--ink)" }}>
                #{r.rank}
              </span>
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-6 w-6 flex-none items-center justify-center overflow-hidden bg-canvas-3">
                  <Robot variant={robotVariantForId(r.syndicateId)} size={22} decorative />
                </span>
                <span className="truncate font-mono text-[13px] uppercase tracking-[0.08em] text-ink">
                  {r.name ?? `SYNDICATE ${r.syndicateId}`}
                </span>
              </span>
              <span className="text-right font-mono text-[13px] text-ink-2">{r.memberCount}</span>
              <span className="whitespace-nowrap text-right font-mono text-[12px] text-accent sm:text-[13px]">
                {formatReputation(r.reputation).toLocaleString()}
              </span>
            </a>
          );
        })
      )}
    </section>
  );
}
