"use client";

import { useCallback, useEffect, useState } from "react";
import { ActivityLedger, BracketedCell } from "@/components/redesign";
import { EXPLORER } from "@/lib/arc";

/// Dashboard surface for the weekly syndicate reward pool. Shows the operator's
/// unclaimed share with a CLAIM button that pulls every unclaimed week in one
/// transfer. Hides itself when there's nothing to claim, so the dashboard stays
/// quiet for operators with no share (or when the pool is unfunded).

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

interface PoolWeek { weekId: string; shareUsdc6: string; claimed: boolean; claimTx: string | null }

const fmt = (usdc6: string | bigint) => (Number(usdc6) / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;

export function SyndicatePoolCard({ address }: { address: `0x${string}` }) {
  const [unclaimed6, setUnclaimed6] = useState<bigint | null>(null);
  const [weeks, setWeeks] = useState<PoolWeek[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`${AUTH_URL}/operators/${address}/syndicate-pool`, { cache: "no-store" });
      if (!res.ok) { setUnclaimed6(0n); return; }
      const data = (await res.json()) as { unclaimedUsdc6: string; weeks: PoolWeek[] };
      setUnclaimed6(BigInt(data.unclaimedUsdc6 ?? "0"));
      setWeeks(data.weeks ?? []);
    } catch {
      setUnclaimed6(0n);
    }
  }, [address]);

  useEffect(() => { void reload(); }, [reload]);

  async function claim() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`${AUTH_URL}/syndicate-pool/claim`, { method: "POST", credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? `http ${res.status}`);
      setResult({ ok: true, text: (data as { hash: string }).hash });
      await reload();
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : "claim failed" });
    }
    setBusy(false);
  }

  // Quiet until loaded; hide entirely when nothing is owed.
  if (unclaimed6 === null) return null;
  const claimedHistory = weeks.filter((w) => w.claimed);
  if (unclaimed6 <= 0n && claimedHistory.length === 0) return null;

  return (
    <section className="mx-auto max-w-[1600px] px-6 pb-10">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
          <span aria-hidden className="text-accent">■</span> SYNDICATE POOL
        </span>
        {unclaimed6 > 0n ? (
          <span className="font-mono text-[11px] text-ink-3">{fmt(unclaimed6)} USDC TO CLAIM</span>
        ) : null}
      </div>
      <BracketedCell pad="sm">
        {unclaimed6 > 0n ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--hairline)] pb-3">
            <p className="min-w-0 font-mono text-[12px] leading-[1.5] text-ink-2">
              your share of the weekly syndicate pool, split by what you contributed. pull it all in one transfer.
            </p>
            <button
              onClick={claim}
              disabled={busy}
              className="inline-flex items-center gap-2 bg-accent px-4 py-2 font-mono text-[12px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press disabled:opacity-60"
            >
              {busy ? "CLAIMING…" : `CLAIM ${fmt(unclaimed6)} USDC`} <span aria-hidden>→</span>
            </button>
          </div>
        ) : null}

        {result ? (
          result.ok ? (
            <a href={`${EXPLORER}/tx/${result.text}`} target="_blank" rel="noreferrer" className="mt-3 block font-mono text-[11px] text-[color:var(--ok)] hover:underline">
              claimed · {short(result.text)} ↗
            </a>
          ) : (
            <p className="mt-3 font-mono text-[11px] text-[color:var(--err)]">{result.text}</p>
          )
        ) : null}

        {weeks.length > 0 ? (
          <ActivityLedger>
            {weeks.map((w) => (
              <div key={w.weekId} className="flex items-center justify-between gap-3 border-b border-[color:var(--hairline)] py-2.5 last:border-0">
                <div className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink">{w.weekId}</div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[13px] text-ink">{fmt(w.shareUsdc6)} USDC</span>
                  <span className={`font-mono text-[10px] uppercase tracking-[0.12em] ${w.claimed ? "text-ink-3" : "text-accent"}`}>
                    {w.claimed ? "CLAIMED" : "PENDING"}
                  </span>
                </div>
              </div>
            ))}
          </ActivityLedger>
        ) : null}
      </BracketedCell>
    </section>
  );
}
