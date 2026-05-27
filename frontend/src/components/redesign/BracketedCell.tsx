import type { CSSProperties, ReactNode } from "react";

/// The product's surface primitive. 1px ink hairline on all four sides plus
/// four 12px L-shaped corner brackets in heavier ink. Sharp corners only,
/// no rounded card. Background defaults to `--canvas`; pass `alt` for the
/// alternate `--canvas-2` stripe used in row groups.
///
/// Hover variant (opt-in) thickens the brackets from 1px to 1.5px over
/// 120ms. No scale, no shadow.

interface Props {
  alt?: boolean;
  hover?: boolean;
  pad?: "sm" | "md" | "lg";
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

const BRACKET_LEN = 14;
const BRACKET_WEIGHT = 1.5;

function Corner({ pos }: { pos: "tl" | "tr" | "bl" | "br" }) {
  const common: CSSProperties = {
    position: "absolute",
    width: BRACKET_LEN,
    height: BRACKET_LEN,
    pointerEvents: "none",
  };
  const inkStr = "var(--ink)";
  const styles: Record<typeof pos, CSSProperties> = {
    tl: {
      top: -1,
      left: -1,
      borderTop: `${BRACKET_WEIGHT}px solid ${inkStr}`,
      borderLeft: `${BRACKET_WEIGHT}px solid ${inkStr}`,
    },
    tr: {
      top: -1,
      right: -1,
      borderTop: `${BRACKET_WEIGHT}px solid ${inkStr}`,
      borderRight: `${BRACKET_WEIGHT}px solid ${inkStr}`,
    },
    bl: {
      bottom: -1,
      left: -1,
      borderBottom: `${BRACKET_WEIGHT}px solid ${inkStr}`,
      borderLeft: `${BRACKET_WEIGHT}px solid ${inkStr}`,
    },
    br: {
      bottom: -1,
      right: -1,
      borderBottom: `${BRACKET_WEIGHT}px solid ${inkStr}`,
      borderRight: `${BRACKET_WEIGHT}px solid ${inkStr}`,
    },
  };
  return <span aria-hidden style={{ ...common, ...styles[pos] }} />;
}

export function BracketedCell({ alt, hover, pad = "md", className = "", style, children }: Props) {
  const padCls = pad === "sm" ? "p-4" : pad === "lg" ? "p-8" : "p-6";
  const bg = alt ? "bg-canvas-2" : "bg-canvas";
  const hoverCls = hover ? "transition-colors duration-150 hover:bg-canvas-2" : "";
  return (
    <div
      className={`relative border border-[color:var(--hairline)] ${bg} ${padCls} ${hoverCls} ${className}`}
      style={style}
    >
      <Corner pos="tl" />
      <Corner pos="tr" />
      <Corner pos="bl" />
      <Corner pos="br" />
      {children}
    </div>
  );
}
