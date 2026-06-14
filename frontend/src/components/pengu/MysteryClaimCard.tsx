"use client";

import { useCallback, useEffect, useState } from "react";
import { BracketedCell, Robot, TagButton } from "@/components/redesign";
import {
  claimMystery,
  fetchMysteryCooldown,
  fetchMysteryPool,
  isClaimError,
  RARITY_COLOR,
  type CooldownStatus,
  type PoolStatus,
  type Trait,
} from "@/lib/traits";
import { playMystery } from "@/lib/sounds";

/// The mystery card on the dashboard. One UTC day, one claim per operator,
/// drawn from a finite global pool. Rarity-weighted; some boxes come up empty.
/// What you win sticks to the active agent and feeds the runner score
/// multiplier the coordinator applies on the next contest.

function fmtRemaining(targetMs: number): string {
  const left = Math.max(0, targetMs - Date.now());
  const h = Math.floor(left / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function MysteryClaimCard({
  activeAgentId,
  onClaimed,
}: {
  activeAgentId: number | null;
  onClaimed?: (trait: Trait) => void | Promise<void>;
}) {
  const [cd, setCd] = useState<CooldownStatus | null>(null);
  const [pool, setPool] = useState<PoolStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [awarded, setAwarded] = useState<Trait | null>(null);
  const [rugged, setRugged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);

  const refresh = useCallback(async () => {
    const [c, p] = await Promise.all([fetchMysteryCooldown(), fetchMysteryPool()]);
    setCd(c);
    setPool(p);
  }, []);

  useEffect(() => {
    void refresh();
    const poll = setInterval(() => {
      void fetchMysteryPool().then((p) => setPool(p));
    }, 10000);
    return () => clearInterval(poll);
  }, [refresh]);

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  async function roll() {
    if (!activeAgentId) return;
    setBusy(true);
    setError(null);
    setAwarded(null);
    setRugged(false);
    const res = await claimMystery(activeAgentId);
    if (isClaimError(res)) {
      setError(res.error);
      if (res.nextAvailable) {
        setCd({ ready: false, lastClaim: null, nextAvailable: res.nextAvailable, totalClaims: cd?.totalClaims ?? 0 });
      }
      await refresh();
    } else if (res.rugged) {
      setRugged(true);
      await refresh();
    } else if (res.trait) {
      setAwarded(res.trait);
      playMystery();
      await onClaimed?.(res.trait);
      await refresh();
    }
    setBusy(false);
  }

  const operatorReady = !!cd && cd.ready;
  const poolDrained = !!pool && pool.remaining <= 0;
  const nextReset = pool?.resetsAt ?? cd?.nextAvailable ?? 0;
  const canRoll = !!activeAgentId && operatorReady && !poolDrained;

  const claimedPct = pool ? Math.min(100, Math.round((pool.claimed / Math.max(1, pool.max)) * 100)) : 0;

  // A dry day (max 0) is intentional, not a drained pool, so it reads its own way.
  const dryDay = !!pool && pool.max === 0;
  let buttonLabel = "CLAIM MYSTERY";
  if (busy) buttonLabel = "ROLLING…";
  else if (!activeAgentId) buttonLabel = "NO ACTIVE AGENT";
  else if (dryDay) buttonLabel = "NO BOXES TODAY";
  else if (poolDrained) buttonLabel = "POOL DRAINED";
  else if (!operatorReady) buttonLabel = "CLAIMED TODAY";

  return (
    <BracketedCell pad="md">
      <div className="flex flex-col gap-5 sm:flex-row sm:flex-wrap sm:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-4 sm:gap-5">
          <span className="flex h-16 w-16 flex-none items-center justify-center border border-[color:var(--hairline-strong)] bg-canvas-2">
            <Robot variant="violet" size={48} decorative />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
              <span aria-hidden className="text-accent">■</span> MYSTERY EVENT
            </div>
            <h3
              className="mt-2 font-stencil uppercase text-ink"
              style={{ fontSize: 22, lineHeight: 1, letterSpacing: "-0.01em" }}
            >
              CLAIM A TRAIT
            </h3>
            <p className="mt-2 max-w-[56ch] font-mono text-[13px] leading-[1.55] text-ink-2">
              traits are scarce. a tiny global pool opens at 01:00 UTC, first come first served, and the whole
              network races for it. most days it is one or two boxes, some days none, a bonus day holds three. one
              claim per operator per day; some boxes come up empty. anything you win sticks to your active agent and
              unlocks a real, tier-scaled ability on its next runs.
            </p>
          </div>
        </div>

        <div className="flex flex-col items-start gap-2 sm:items-end">
          <TagButton variant="primary" size="md" onClick={roll} disabled={!canRoll || busy} arrow={canRoll && !busy}>
            {buttonLabel}
          </TagButton>
          {nextReset > Date.now() ? (
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
              RESETS IN {fmtRemaining(nextReset)} · 01:00 UTC
            </span>
          ) : null}
          {cd ? (
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
              {cd.totalClaims} TOTAL CLAIMS
            </span>
          ) : null}
        </div>
      </div>

      {pool ? (
        <div className="mt-5">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">TODAY'S POOL</span>
            <span className="font-mono text-[12px] tabular-nums text-ink">
              {dryDay ? "NONE TODAY" : `${pool.remaining} / ${pool.max} LEFT`}
            </span>
          </div>
          <div className="mt-2 h-2 w-full border border-[color:var(--hairline)] bg-canvas-2">
            <div
              className="h-full transition-[width] duration-500"
              style={{
                width: `${claimedPct}%`,
                backgroundColor: poolDrained ? "var(--err)" : "var(--accent)",
              }}
            />
          </div>
        </div>
      ) : null}

      {awarded ? (
        <div
          className="mt-5 flex items-center justify-between gap-4 border px-4 py-3 animate-stagger-in"
          style={{
            backgroundColor: RARITY_COLOR[awarded.rarity].bg,
            borderColor: RARITY_COLOR[awarded.rarity].border,
            animationFillMode: "both",
          }}
        >
          <div className="min-w-0">
            <div
              className="font-mono text-[10px] uppercase tracking-[0.16em]"
              style={{ color: RARITY_COLOR[awarded.rarity].text }}
            >
              NEW · {awarded.rarity.toUpperCase()}
            </div>
            <div
              className="mt-1 font-stencil uppercase"
              style={{
                color: RARITY_COLOR[awarded.rarity].text,
                fontSize: 20,
                lineHeight: 1,
                letterSpacing: "-0.01em",
              }}
            >
              {awarded.name}
            </div>
            <div className="mt-1 font-mono text-[12px] leading-[1.5] text-ink-2">{awarded.body}</div>
          </div>
        </div>
      ) : null}

      {rugged ? (
        <div
          className="mt-5 flex items-center gap-4 border px-4 py-3 animate-stagger-in"
          style={{
            backgroundColor: "rgba(224,52,90,0.06)",
            borderColor: "rgba(224,52,90,0.30)",
            animationFillMode: "both",
          }}
        >
          <span className="font-stencil text-[24px]" aria-hidden style={{ color: "var(--err)" }}>
            ■
          </span>
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--err)]">RUGGED</div>
            <div
              className="mt-1 font-stencil uppercase text-[color:var(--err)]"
              style={{ fontSize: 20, lineHeight: 1, letterSpacing: "-0.01em" }}
            >
              NOTHING THIS TIME
            </div>
            <div className="mt-1 font-mono text-[12px] leading-[1.5] text-ink-2">
              the box was empty. your daily claim is spent; come back at the next reset.
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--err)]">{error}</p>
      ) : null}
    </BracketedCell>
  );
}
