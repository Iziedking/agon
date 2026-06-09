import type { CSSProperties, ReactNode } from "react";

/// The product's surface primitive. 1px ink hairline on all four sides plus
/// four 12px L-shaped corner brackets in heavier ink. Sharp corners only,
/// no rounded card. Default surface is `--canvas`; pass `tone` to fill the
/// card with one of the brand swatches (black, dark grey, light grey, pink).
/// Solid-filled tones flip the text color and bracket color to remain
/// readable on the dark fills.
///
/// Hover variant (opt-in) thickens the brackets from 1px to 1.5px over
/// 120ms. No scale, no shadow.

type Tone = "canvas" | "canvas-alt" | "ink" | "dark-grey" | "light-grey" | "accent";

interface Props {
  /// Legacy boolean. `true` is equivalent to `tone="canvas-alt"`. Kept for
  /// back-compat with existing callers that pass `alt`.
  alt?: boolean;
  /// Solid fill option. Default keeps the existing transparent-over-canvas
  /// look. The filled tones (ink, dark-grey, light-grey, accent) give cards
  /// a quality solid feel for hero blocks, callouts, and stats bands.
  tone?: Tone;
  hover?: boolean;
  pad?: "sm" | "md" | "lg";
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

const BRACKET_LEN = 14;
const BRACKET_WEIGHT = 1.5;

interface ToneStyle {
  bg: string;
  border: string;
  bracket: string;
  text: string;
}

const TONE_STYLE: Record<Tone, ToneStyle> = {
  canvas:        { bg: "bg-canvas",          border: "border-[color:var(--hairline)]",        bracket: "var(--ink)",     text: "text-ink" },
  "canvas-alt":  { bg: "bg-canvas-2",        border: "border-[color:var(--hairline)]",        bracket: "var(--ink)",     text: "text-ink" },
  ink:           { bg: "bg-[#1A1612]",       border: "border-[#1A1612]",                       bracket: "var(--canvas)",  text: "text-canvas" },
  "dark-grey":   { bg: "bg-[#4D4D4D]",       border: "border-[#4D4D4D]",                       bracket: "var(--canvas)",  text: "text-canvas" },
  "light-grey":  { bg: "bg-[#DEDEDE]",       border: "border-[color:var(--hairline-strong)]",  bracket: "var(--ink)",     text: "text-ink" },
  accent:        { bg: "bg-accent",          border: "border-accent",                          bracket: "var(--accent-ink)", text: "text-accent-ink" },
};

function Corner({ pos, color }: { pos: "tl" | "tr" | "bl" | "br"; color: string }) {
  const common: CSSProperties = {
    position: "absolute",
    width: BRACKET_LEN,
    height: BRACKET_LEN,
    pointerEvents: "none",
  };
  const styles: Record<typeof pos, CSSProperties> = {
    tl: {
      top: -1,
      left: -1,
      borderTop: `${BRACKET_WEIGHT}px solid ${color}`,
      borderLeft: `${BRACKET_WEIGHT}px solid ${color}`,
    },
    tr: {
      top: -1,
      right: -1,
      borderTop: `${BRACKET_WEIGHT}px solid ${color}`,
      borderRight: `${BRACKET_WEIGHT}px solid ${color}`,
    },
    bl: {
      bottom: -1,
      left: -1,
      borderBottom: `${BRACKET_WEIGHT}px solid ${color}`,
      borderLeft: `${BRACKET_WEIGHT}px solid ${color}`,
    },
    br: {
      bottom: -1,
      right: -1,
      borderBottom: `${BRACKET_WEIGHT}px solid ${color}`,
      borderRight: `${BRACKET_WEIGHT}px solid ${color}`,
    },
  };
  return <span aria-hidden style={{ ...common, ...styles[pos] }} />;
}

export function BracketedCell({ alt, tone, hover, pad = "md", className = "", style, children }: Props) {
  const resolvedTone: Tone = tone ?? (alt ? "canvas-alt" : "canvas");
  const t = TONE_STYLE[resolvedTone];
  const padCls = pad === "sm" ? "p-4" : pad === "lg" ? "p-8" : "p-6";
  // Filled tones drop the hover-darken behavior to keep the brand color steady.
  const isFilled = resolvedTone === "ink" || resolvedTone === "dark-grey" || resolvedTone === "accent";
  const hoverCls = hover && !isFilled ? "transition-colors duration-150 hover:bg-canvas-2" : "";
  return (
    <div
      className={`relative border ${t.border} ${t.bg} ${t.text} ${padCls} ${hoverCls} ${className}`}
      style={style}
    >
      <Corner pos="tl" color={t.bracket} />
      <Corner pos="tr" color={t.bracket} />
      <Corner pos="bl" color={t.bracket} />
      <Corner pos="br" color={t.bracket} />
      {children}
    </div>
  );
}
