import type { ReactNode } from "react";
import { BracketedCell } from "./BracketedCell";

/// A single metric inside a BracketedCell. Top eyebrow label in mono caps
/// `--ink-3`, large numeral in stencil display face `--ink`, optional mono
/// small caption underneath. Left-aligned. Reserve `accent` for at most one
/// stat per page, never on every numeral.

interface Props {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  accent?: boolean;
  alt?: boolean;
  /// Use for long values (e.g. a 7-digit chain id). The stencil face is wide,
  /// so a smaller clamp keeps the numeral inside its bracket instead of
  /// spilling past the right edge in a tight grid cell.
  fit?: boolean;
}

export function StatBlock({ label, value, caption, accent, alt, fit }: Props) {
  return (
    <BracketedCell alt={alt}>
      <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">{label}</div>
      <div
        className={`mt-3 whitespace-nowrap font-stencil leading-none ${accent ? "text-accent" : "text-ink"}`}
        style={{ fontSize: fit ? "clamp(22px, 2.8vw, 32px)" : "clamp(28px, 4vw, 44px)" }}
      >
        {value}
      </div>
      {caption ? (
        <div className="mt-2 font-mono text-xs text-ink-2">{caption}</div>
      ) : null}
    </BracketedCell>
  );
}
