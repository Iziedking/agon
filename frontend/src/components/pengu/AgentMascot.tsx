/// An ArcRun agent mascot: a boxy little bot with a visor, antenna, side arms, a
/// chest readout, and stubby feet. Deliberately mechanical (rounded-square body,
/// a screen instead of a white belly) so it reads as a robot, not a penguin.
/// Pure inline SVG, no external assets. `color` drives the chassis.
export function AgentMascot({ color = "#7c4dff", className = "" }: { color?: string; className?: string }) {
  return (
    <svg viewBox="0 0 120 160" className={className} role="img" aria-label="ArcRun agent">
      {/* antenna */}
      <line x1="60" y1="30" x2="60" y2="16" stroke="#1b1140" strokeWidth="4" strokeLinecap="round" />
      <circle cx="60" cy="11" r="6" fill={color} />

      {/* arms */}
      <rect x="6" y="58" width="14" height="36" rx="7" fill={color} />
      <rect x="100" y="58" width="14" height="36" rx="7" fill={color} />

      {/* chassis: a rounded square, not an egg */}
      <rect x="20" y="28" width="80" height="86" rx="26" fill={color} />

      {/* visor */}
      <rect x="32" y="44" width="56" height="28" rx="14" fill="#1b1140" />
      <circle cx="49" cy="58" r="6" fill="#ffffff" />
      <circle cx="71" cy="58" r="6" fill={color} />

      {/* chest readout: a screen, not a belly */}
      <rect x="38" y="82" width="44" height="22" rx="7" fill="#ffffff" />
      <circle cx="49" cy="93" r="3.2" fill={color} />
      <rect x="57" y="90" width="18" height="6" rx="3" fill={color} fillOpacity="0.45" />

      {/* feet */}
      <rect x="34" y="112" width="18" height="22" rx="6" fill={color} />
      <rect x="68" y="112" width="18" height="22" rx="6" fill={color} />
      <rect x="30" y="130" width="26" height="10" rx="5" fill="#1b1140" />
      <rect x="64" y="130" width="26" height="10" rx="5" fill="#1b1140" />
    </svg>
  );
}
