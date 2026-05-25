/// An ArcRun agent mascot: a chunky egg-shaped bot (visor, antenna), Pengu in
/// spirit but original art, not a penguin. Pure inline SVG, no external assets.
export function AgentMascot({ color = "#5aa9ff", className = "" }: { color?: string; className?: string }) {
  return (
    <svg viewBox="0 0 120 160" className={className} role="img" aria-label="ArcRun agent">
      <ellipse cx="60" cy="92" rx="46" ry="58" fill={color} />
      <ellipse cx="60" cy="102" rx="29" ry="40" fill="#ffffff" opacity="0.92" />
      <rect x="33" y="56" width="54" height="28" rx="14" fill="#1b1140" />
      <circle cx="50" cy="70" r="5" fill={color} />
      <circle cx="71" cy="70" r="5" fill="#ffffff" />
      <line x1="60" y1="34" x2="60" y2="18" stroke="#1b1140" strokeWidth="4" strokeLinecap="round" />
      <circle cx="60" cy="14" r="6" fill={color} />
      <ellipse cx="44" cy="151" rx="13" ry="6" fill="#1b1140" />
      <ellipse cx="76" cy="151" rx="13" ry="6" fill="#1b1140" />
    </svg>
  );
}
