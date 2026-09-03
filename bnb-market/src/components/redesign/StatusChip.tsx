import type { ReactNode } from "react";

type Tone = "ok" | "warn" | "err";

const toneClass: Record<Tone, string> = {
  ok: "text-[color:var(--ok)] border-[color:var(--ok)]",
  warn: "text-[color:var(--warn)] border-[color:var(--warn)]",
  err: "text-[color:var(--err)] border-[color:var(--err)]",
};

export function StatusChip({ tone = "ok", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${toneClass[tone]}`}
    >
      {children}
    </span>
  );
}
