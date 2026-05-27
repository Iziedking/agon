/// Monochrome line-art "sketches" of the three platforms we build on. NOT
/// the real brand logos — those are full-color and clashed with our flat
/// ink-on-canvas palette plus pushed the row out of alignment when they
/// wrapped. These are simple ink strokes that read as ARC / CIRCLE / USDC
/// at a glance, follow the redesign skill rule against gradient/stock
/// brand marks, and lay out cleanly on every viewport.
///
/// Layout: 3-column grid above md (so the three slots stay equal width and
/// always align on the same horizontal baseline) and a 1-column stack
/// below. No flex-wrap orphan rows. Each slot is its own bracketed cell so
/// the row reads as three measured panels, not a logo-soup band.

import { BracketedCell } from "./BracketedCell";

function ArcSketch() {
  return (
    <svg viewBox="0 0 40 40" className="h-9 w-9" aria-label="Arc Network">
      <g stroke="var(--ink)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none">
        {/* shield outline */}
        <path d="M20 4 L34 10 L34 22 Q34 32 20 36 Q6 32 6 22 L6 10 Z" />
        {/* stylized A */}
        <path d="M14 26 L20 12 L26 26" />
        <line x1="16" y1="22" x2="24" y2="22" />
      </g>
    </svg>
  );
}

function CircleSketch() {
  return (
    <svg viewBox="0 0 40 40" className="h-9 w-9" aria-label="Circle">
      <g stroke="var(--ink)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <circle cx="20" cy="20" r="14" />
        <circle cx="20" cy="20" r="7" />
        <line x1="20" y1="6" x2="20" y2="34" />
        <line x1="6" y1="20" x2="34" y2="20" />
      </g>
    </svg>
  );
}

function UsdcSketch() {
  return (
    <svg viewBox="0 0 40 40" className="h-9 w-9" aria-label="USDC">
      <g stroke="var(--ink)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <circle cx="20" cy="20" r="14" />
        {/* dollar mark, stencilled */}
        <line x1="20" y1="9" x2="20" y2="31" />
        <path d="M26 14 Q22 11 18 12 Q14 13 14 17 Q14 20 18 21 L22 21 Q26 22 26 25 Q26 28 22 29 Q18 30 14 27" />
      </g>
    </svg>
  );
}

function Slot({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <BracketedCell pad="sm">
      <div className="flex items-center gap-4">
        {children}
        <span
          className="font-stencil uppercase text-ink"
          style={{ fontSize: 24, lineHeight: 1, letterSpacing: "0.02em" }}
        >
          {label}
        </span>
      </div>
    </BracketedCell>
  );
}

export function BuiltOnLogos() {
  return (
    <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
      <Slot label="ARC"><ArcSketch /></Slot>
      <Slot label="CIRCLE"><CircleSketch /></Slot>
      <Slot label="USDC"><UsdcSketch /></Slot>
    </div>
  );
}
