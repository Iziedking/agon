"use client";

import { useEffect, useState } from "react";
import {
  MAX_EQUIPPED,
  clashInLoadout,
  fetchLoadout,
  fetchTraitPool,
  saveLoadout,
  type TraitDef,
} from "@/lib/loadouts";

/// Inline EQUIP TRAITS step rendered above the ENTER / JOIN button.
/// Shows the operator's owned trait pool, lets them pick up to 3, warns
/// inline on clashes. Auto-saves on change so the runner reads the
/// current loadout at scoring time. Self-hides when the operator owns
/// no traits yet.

const RARITY_COLOR: Record<TraitDef["rarity"], string> = {
  common: "var(--ink-3)",
  rare: "#3a82c9",
  epic: "#8b5cf6",
  legendary: "var(--accent)",
};

export function EquipTraitsPanel({
  address,
  source,
  eventId,
  agentId,
  disabled,
  onLoadoutChange,
}: {
  address: `0x${string}`;
  source: "contest" | "challenge";
  eventId: number;
  agentId: number;
  disabled?: boolean;
  /// Fires whenever the equipped set changes so the parent can show
  /// "3 traits equipped" status text near the ENTER button.
  onLoadoutChange?: (traitIds: string[]) => void;
}) {
  const [pool, setPool] = useState<{ owned: string[]; catalogue: TraitDef[] } | null>(null);
  const [equipped, setEquipped] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([fetchTraitPool(address), fetchLoadout(source, eventId, agentId)]).then(
      ([p, l]) => {
        if (!live) return;
        setPool({ owned: p.owned, catalogue: p.catalogue });
        setEquipped(l);
        onLoadoutChange?.(l);
      },
    );
    return () => { live = false; };
  }, [address, source, eventId, agentId, onLoadoutChange]);

  async function toggle(id: string) {
    if (disabled || saving) return;
    setErr(null);
    let next: string[];
    if (equipped.includes(id)) {
      next = equipped.filter((t) => t !== id);
    } else {
      if (equipped.length >= MAX_EQUIPPED) {
        setErr(`max ${MAX_EQUIPPED} traits equipped`);
        return;
      }
      const clash = clashInLoadout(id, equipped);
      if (clash) {
        setErr(`${id} clashes with ${clash}`);
        return;
      }
      next = [...equipped, id];
    }
    setEquipped(next);
    onLoadoutChange?.(next);
    setSaving(true);
    const res = await saveLoadout(source, eventId, agentId, next);
    setSaving(false);
    if (!res.ok) setErr(res.error ?? "could not save loadout");
  }

  if (!pool) return null;
  const ownedDefs = pool.catalogue.filter((t) => pool.owned.includes(t.id));
  if (ownedDefs.length === 0) return null;

  return (
    <div className="mt-4 border-t border-[color:var(--hairline)] pt-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">
          EQUIP TRAITS
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
          {equipped.length} / {MAX_EQUIPPED}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {ownedDefs.map((t) => {
          const on = equipped.includes(t.id);
          const tooMany = !on && equipped.length >= MAX_EQUIPPED;
          const clash = !on && clashInLoadout(t.id, equipped);
          const muted = tooMany || !!clash;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => toggle(t.id)}
              disabled={disabled || saving}
              title={clash ? `clashes with ${clash}` : t.body}
              className="inline-flex items-center gap-1.5 border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors disabled:opacity-60"
              style={{
                borderColor: on ? "var(--accent)" : muted ? "var(--hairline)" : "var(--ink-3)",
                background: on ? "var(--accent)" : "transparent",
                color: on ? "var(--accent-ink)" : muted ? "var(--ink-3)" : "var(--ink)",
              }}
            >
              <span aria-hidden style={{ color: on ? "var(--accent-ink)" : RARITY_COLOR[t.rarity] }}>■</span>
              {t.name}
            </button>
          );
        })}
      </div>
      {err ? (
        <p className="mt-2 font-mono text-[10px] text-[#e0466e]">{err}</p>
      ) : null}
    </div>
  );
}
