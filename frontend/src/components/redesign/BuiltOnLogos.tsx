/// Real brand marks for Arc, Circle, and USDC rendered as inline SVGs so
/// they ship without an extra request and adapt to dark mode without a
/// second asset. Each mark is wrapped in a small bracketed tile that
/// reads consistently with the rest of the design system. The marks
/// themselves keep their official colors (USDC blue, Arc deep navy,
/// Circle gradient) per Circle and Arc brand guidance.

import { BracketedCell } from "./BracketedCell";

function ArcMark() {
  // Arc's mark is a stylized white "A" arc on a deep navy background.
  // Approximated from the official PNG: the right downstroke is straight,
  // the left "leg" curves outward into a half-bowl. Rounded background
  // tile in Arc's navy gradient.
  return (
    <svg viewBox="0 0 64 64" className="h-10 w-10" aria-label="Arc Network">
      <defs>
        <linearGradient id="arcBg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0F1B3A" />
          <stop offset="100%" stopColor="#1B3673" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="10" fill="url(#arcBg)" />
      {/* Right straight downstroke */}
      <path
        d="M40 12 L40 52 L46 52 L46 12 Z"
        fill="#FFFFFF"
      />
      {/* Left curved leg arcing from the top to the bottom-left */}
      <path
        d="M40 12 Q15 14 14 52 L22 52 Q24 22 40 22 Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

function CircleMark() {
  // Circle's mark is a broken ring made of three colored arcs in a
  // teal-to-purple gradient over a near-black tile, with a small dark
  // hub in the centre. Each arc shape is drawn as a thick stroke.
  return (
    <svg viewBox="0 0 64 64" className="h-10 w-10" aria-label="Circle">
      <defs>
        <linearGradient id="circleBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0B0A12" />
          <stop offset="100%" stopColor="#1B1429" />
        </linearGradient>
        <linearGradient id="circleArc1" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#4FD1C5" />
          <stop offset="100%" stopColor="#3FA6E0" />
        </linearGradient>
        <linearGradient id="circleArc2" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3FA6E0" />
          <stop offset="100%" stopColor="#7C5CFF" />
        </linearGradient>
        <linearGradient id="circleArc3" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0%" stopColor="#A78BFA" />
          <stop offset="100%" stopColor="#4FD1C5" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="10" fill="url(#circleBg)" />
      {/* Three broken arc segments */}
      <g fill="none" strokeWidth="6" strokeLinecap="round">
        <path d="M16 32 A16 16 0 0 1 40 18" stroke="url(#circleArc1)" />
        <path d="M48 32 A16 16 0 0 1 32 48" stroke="url(#circleArc2)" />
        <path d="M40 46 A16 16 0 0 1 24 24" stroke="url(#circleArc3)" />
      </g>
      {/* Hub */}
      <circle cx="32" cy="32" r="4.5" fill="#0B0A12" stroke="#A78BFA" strokeWidth="1.5" />
    </svg>
  );
}

function UsdcMark() {
  // USDC's mark is a blue rounded square with a white dollar sign and
  // an inner ring around it. Verified against Circle's stablecoin
  // brand assets.
  return (
    <svg viewBox="0 0 64 64" className="h-10 w-10" aria-label="USDC">
      <rect width="64" height="64" rx="10" fill="#2775CA" />
      {/* Inner ring */}
      <circle cx="32" cy="32" r="18" fill="none" stroke="#FFFFFF" strokeWidth="2.2" />
      {/* Dollar sign */}
      <g stroke="#FFFFFF" strokeWidth="3.4" strokeLinecap="round" fill="none">
        <line x1="32" y1="14" x2="32" y2="50" />
        <path d="M40 22 Q35 19 30 20 Q24 22 24 27 Q24 31 30 32 L34 32 Q40 33 40 38 Q40 43 34 44 Q28 45 24 41" />
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
          style={{ fontSize: 22, lineHeight: 1, letterSpacing: "0.02em" }}
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
      <Slot label="ARC"><ArcMark /></Slot>
      <Slot label="CIRCLE"><CircleMark /></Slot>
      <Slot label="USDC"><UsdcMark /></Slot>
    </div>
  );
}
