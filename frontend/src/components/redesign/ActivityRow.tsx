import type { ReactNode } from "react";

/// One row per arena event. 36px tall. Hairline between rows. Leading
/// square marker colored per event type. Right-aligned `tx ↗` link in
/// `--ink-3` mono. Replaces every pastel chip activity feed.
///
/// Layout:
///   [■ event-color] [LABEL caps] — [description, ink-2]  ...  [right ctx] [tx ↗]

type Tone = "ok" | "warn" | "err" | "accent" | "violet" | "gold" | "mint" | "crimson" | "ink";

const TONE_VAR: Record<Tone, string> = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  err: "var(--err)",
  accent: "var(--accent)",
  violet: "var(--syn-violet)",
  gold: "var(--syn-gold)",
  mint: "var(--syn-mint)",
  crimson: "var(--syn-crimson)",
  ink: "var(--ink)",
};

interface RowProps {
  tone?: Tone;
  label: string;
  description?: ReactNode;
  right?: ReactNode;
  txHref?: string;
}

export function ActivityRow({ tone = "ink", label, description, right, txHref }: RowProps) {
  return (
    <div
      className="flex items-center gap-3 border-b border-[color:var(--hairline)] py-2.5 last:border-0"
      style={{ minHeight: 36 }}
    >
      <span aria-hidden className="font-mono text-sm" style={{ color: TONE_VAR[tone] }}>■</span>
      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink whitespace-nowrap">{label}</span>
      {description ? (
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-2">{description}</span>
      ) : (
        <span className="flex-1" />
      )}
      {right ? <span className="font-mono text-[12px] text-ink whitespace-nowrap">{right}</span> : null}
      {txHref ? (
        <a
          href={txHref}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[12px] text-ink-3 hover:text-ink whitespace-nowrap"
        >
          tx ↗
        </a>
      ) : null}
    </div>
  );
}

/// Container for a stack of ActivityRows so callers don't repeat the border
/// styling. Renders inside a BracketedCell on the page.
export function ActivityLedger({ children }: { children: ReactNode }) {
  return <div className="flex flex-col">{children}</div>;
}
