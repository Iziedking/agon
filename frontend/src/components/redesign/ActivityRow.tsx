import type { ReactNode } from "react";

/// One row per arena event. 36px tall. Hairline between rows. Leading
/// square marker colored per event type. Right-aligned `tx ↗` link in
/// `--ink-3` mono. Replaces every pastel chip activity feed.
///
/// Layout:
///   [■ event-color] [LABEL caps] [description, ink-2]  ...  [right ctx] [tx ↗]

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
  /// Internal same-tab nav. When set the whole row is a link, used so an
  /// activity ledger row opens its focused stage on /live without forcing a
  /// new tab.
  href?: string;
  /// External tx link rendered as `tx ↗`. Opens in a new tab; keep it for
  /// arcscan / explorer links, not for SPA navigation.
  txHref?: string;
}

export function ActivityRow({ tone = "ink", label, description, right, href, txHref }: RowProps) {
  const inner = (
    <>
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
          onClick={(e) => e.stopPropagation()}
          className="font-mono text-[12px] text-ink-3 hover:text-ink whitespace-nowrap"
        >
          tx ↗
        </a>
      ) : null}
    </>
  );

  const base = "flex items-center gap-3 border-b border-[color:var(--hairline)] py-2.5 last:border-0";
  const style = { minHeight: 36 };
  if (href) {
    return (
      <a href={href} className={`${base} transition-colors hover:bg-canvas-2`} style={style}>
        {inner}
      </a>
    );
  }
  return (
    <div className={base} style={style}>
      {inner}
    </div>
  );
}

/// Container for a stack of ActivityRows so callers don't repeat the border
/// styling. Renders inside a BracketedCell on the page.
export function ActivityLedger({ children }: { children: ReactNode }) {
  return <div className="flex flex-col">{children}</div>;
}
