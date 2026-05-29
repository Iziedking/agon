"use client";

import { useCallback, useEffect, useState } from "react";
import { AgentMascot } from "@/components/pengu/AgentMascot";
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

/// The mystery card on the dashboard. One UTC day, one claim per operator,
/// drawn from a finite global pool. Rarity-weighted; some boxes come up empty.
/// What you win sticks to the active agent and feeds the runner score multiplier
/// the coordinator applies on the next contest.

const chunkyBtn =
  "rounded-pill bg-pengu-blue px-6 py-3 font-display text-sm uppercase tracking-wide text-white shadow-[0_4px_0_0_#5b34d6] transition-all duration-100 hover:translate-y-[2px] hover:shadow-[0_2px_0_0_#5b34d6] active:translate-y-[3px] disabled:opacity-60";

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
    // Keep the pool count fresh while the page is open so people see boxes
    // tick down in close to real time when others are claiming.
    const poll = setInterval(() => {
      void fetchMysteryPool().then((p) => setPool(p));
    }, 10000);
    return () => clearInterval(poll);
  }, [refresh]);

  // Tick once a second so the countdown stays accurate.
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

  let buttonLabel = "claim mystery";
  if (busy) buttonLabel = "rolling…";
  else if (!activeAgentId) buttonLabel = "no active agent";
  else if (poolDrained) buttonLabel = "pool drained";
  else if (!operatorReady) buttonLabel = "claimed today";

  return (
    <div className="rounded-card border border-pengu-blue/15 bg-pengu-card p-6 shadow-[0_10px_30px_rgba(70,45,150,0.08)]">
      <div className="flex flex-wrap items-start gap-5">
        <span className="flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-full border border-pengu-blue/15 bg-pengu-bg">
          <AgentMascot color="#7c4dff" className="h-[68%] w-auto" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-display text-xs uppercase tracking-wide text-pengu-blue">mystery event</div>
          <h3 className="mt-1 font-bubble text-xl uppercase text-pengu-dark">claim a trait</h3>
          <p className="mt-1 max-w-[52ch] text-sm text-pengu-dark/65">
            a global pool of mystery boxes opens once a day at 01:00 UTC, first come first served. each operator
            claims one box per day. rarities run common, rare, epic, legendary; some come up empty. anything you win
            sticks to your active agent and boosts its score in future contests.
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <button onClick={roll} disabled={!canRoll || busy} className={chunkyBtn}>
            {buttonLabel}
          </button>
          {nextReset > Date.now() ? (
            <span className="font-mono text-[10px] text-pengu-dark/45">
              resets in {fmtRemaining(nextReset)} (01:00 UTC)
            </span>
          ) : null}
          {cd ? (
            <span className="font-mono text-[10px] text-pengu-dark/40">{cd.totalClaims} total claims</span>
          ) : null}
        </div>
      </div>

      {/* Pool meter */}
      {pool ? (
        <div className="mt-5">
          <div className="flex items-baseline justify-between">
            <span className="font-display text-[11px] uppercase tracking-wide text-pengu-dark/45">today's pool</span>
            <span className="font-mono text-xs text-pengu-dark/75">
              {pool.remaining} / {pool.max} left
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-pengu-blue/10">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                poolDrained ? "bg-[#e0466e]" : "bg-pengu-blue"
              }`}
              style={{ width: `${claimedPct}%` }}
            />
          </div>
        </div>
      ) : null}

      {awarded ? (
        <div
          className="mt-5 flex items-center justify-between gap-4 rounded-2xl border px-4 py-3 animate-stagger-in"
          style={{
            backgroundColor: RARITY_COLOR[awarded.rarity].bg,
            borderColor: RARITY_COLOR[awarded.rarity].border,
            animationFillMode: "both",
          }}
        >
          <div className="min-w-0">
            <div
              className="font-display text-[10px] uppercase tracking-wide"
              style={{ color: RARITY_COLOR[awarded.rarity].text }}
            >
              new · {awarded.rarity}
            </div>
            <div className="mt-0.5 font-bubble text-lg uppercase" style={{ color: RARITY_COLOR[awarded.rarity].text }}>
              {awarded.name}
            </div>
            <div className="mt-0.5 font-mono text-xs text-pengu-dark/65">{awarded.body}</div>
          </div>
        </div>
      ) : null}

      {rugged ? (
        <div
          className="mt-5 flex items-center gap-4 rounded-2xl border border-[#e0466e]/30 bg-[#e0466e]/8 px-4 py-3 animate-stagger-in"
          style={{ animationFillMode: "both" }}
        >
          <span className="font-display text-[28px]" aria-hidden style={{ color: "#e0466e" }}>
            ✕
          </span>
          <div className="min-w-0">
            <div className="font-display text-[10px] uppercase tracking-wide text-[#e0466e]">rugged</div>
            <div className="mt-0.5 font-bubble text-lg uppercase text-[#e0466e]">nothing this time</div>
            <div className="mt-0.5 font-mono text-xs text-pengu-dark/65">
              the box was empty. your daily claim is spent; come back at the next reset.
            </div>
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-3 font-mono text-xs text-[#e0466e]">{error}</p> : null}
    </div>
  );
}
