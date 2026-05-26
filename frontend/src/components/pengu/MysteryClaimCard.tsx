"use client";

import { useCallback, useEffect, useState } from "react";
import { AgentMascot } from "@/components/pengu/AgentMascot";
import {
  claimMystery,
  fetchMysteryCooldown,
  RARITY_COLOR,
  type CooldownStatus,
  type Trait,
} from "@/lib/traits";

/// The daily mystery card on the dashboard. One claim per 24h binds a random
/// trait (rarity-weighted) to the active agent. Shows a live countdown when on
/// cooldown and reveals the awarded trait with a small flourish on success.

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
  const [busy, setBusy] = useState(false);
  const [awarded, setAwarded] = useState<Trait | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);

  const refresh = useCallback(async () => {
    setCd(await fetchMysteryCooldown());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Tick once a second so the countdown updates in place.
  useEffect(() => {
    if (cd?.ready) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [cd?.ready]);

  async function roll() {
    if (!activeAgentId) return;
    setBusy(true);
    setError(null);
    setAwarded(null);
    const res = await claimMystery(activeAgentId);
    if ("trait" in res) {
      setAwarded(res.trait);
      await onClaimed?.(res.trait);
      await refresh();
    } else {
      setError(res.error);
      if (res.nextAvailable) {
        setCd({ ready: false, lastClaim: null, nextAvailable: res.nextAvailable, totalClaims: cd?.totalClaims ?? 0 });
      }
    }
    setBusy(false);
  }

  const ready = !!cd && (cd.ready || Date.now() >= cd.nextAvailable);
  const countdown = cd && !ready ? fmtRemaining(cd.nextAvailable) : null;

  return (
    <div className="rounded-card border border-pengu-blue/15 bg-white p-6 shadow-[0_10px_30px_rgba(70,45,150,0.08)]">
      <div className="flex flex-wrap items-center gap-5">
        <span className="flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-full border border-pengu-blue/15 bg-pengu-bg">
          <AgentMascot color="#7c4dff" className="h-[68%] w-auto" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-display text-xs uppercase tracking-wide text-pengu-blue">mystery event</div>
          <h3 className="mt-1 font-bubble text-xl uppercase text-pengu-dark">claim a trait</h3>
          <p className="mt-1 max-w-[44ch] text-sm text-pengu-dark/65">
            once a day, roll for a random trait and bind it to your active agent. rarity is weighted; legendaries are
            rare. traits stick forever.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {activeAgentId == null ? (
            <span className="font-mono text-xs text-pengu-dark/45">no active agent</span>
          ) : ready ? (
            <button onClick={roll} disabled={busy} className={chunkyBtn}>
              {busy ? "rolling…" : "claim mystery"}
            </button>
          ) : (
            <div className="flex flex-col items-end">
              <span className="rounded-pill border border-pengu-blue/20 px-4 py-2 font-mono text-xs text-pengu-dark/55">
                next roll in {countdown}
              </span>
              <span className="mt-1 font-mono text-[10px] text-pengu-dark/40">
                {cd?.totalClaims ?? 0} total rolls
              </span>
            </div>
          )}
        </div>
      </div>

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

      {error ? <p className="mt-3 font-mono text-xs text-[#e0466e]">{error}</p> : null}
    </div>
  );
}
