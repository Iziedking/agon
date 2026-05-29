"use client";

import { useEffect, useState } from "react";

/// Workshop strength breakdown panel: shows tier × training × traits per
/// contest type, with the actual numbers the runner uses to multiply
/// score. No magic, no hidden math.

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

type ContestType = "solver" | "analyst" | "scout";

interface Strength {
  tier: number;
  tierBase: number;
  training: number;
  traits: number;
  effective: number;
  routing: "stochastic" | "momentum" | "calibrated" | null;
}

interface StrengthResponse {
  agentId: number;
  traits: string[];
  breakdown: Record<ContestType, Strength>;
}

export function StrengthBreakdown({ agentId }: { agentId: number }) {
  const [data, setData] = useState<StrengthResponse | null>(null);
  const [tab, setTab] = useState<ContestType>("solver");

  useEffect(() => {
    let live = true;
    void fetch(`${AUTH_URL}/agents/${agentId}/strength`, { cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (live && d) setData(d as StrengthResponse); })
      .catch(() => {});
    return () => { live = false; };
  }, [agentId]);

  if (!data) return null;
  const s = data.breakdown[tab];

  return (
    <div className="mt-4 border-t border-[color:var(--hairline)] pt-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">STRENGTH</span>
        <div className="flex gap-1">
          {(["solver", "analyst", "scout"] as ContestType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className="border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em]"
              style={{
                borderColor: tab === t ? "var(--accent)" : "var(--ink-3)",
                background: tab === t ? "var(--accent)" : "transparent",
                color: tab === t ? "var(--accent-ink)" : "var(--ink)",
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-1 font-mono text-[11px] uppercase tracking-[0.12em]">
        <Row label={`TIER ${s.tier}`} value={`${s.tierBase.toFixed(2)} ×`} />
        <Row label="TRAINED" value={`${s.training.toFixed(2)} ×`} />
        <Row label="TRAITS" value={`${s.traits.toFixed(2)} ×`} />
        <div className="mt-1 flex items-center justify-between border-t border-[color:var(--hairline)] pt-2">
          <span className="text-ink">EFFECTIVE</span>
          <span className="font-stencil text-[18px] text-accent">{s.effective.toFixed(2)} ×</span>
        </div>
        {s.routing ? (
          <p className="mt-1 font-mono text-[10px] text-ink-3">
            routing: {s.routing} (scoring algorithm swap)
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-3">{label}</span>
      <span className="text-ink">{value}</span>
    </div>
  );
}
