/// The product logomark. A pink notched square (echoing the TagButton shape)
/// containing a white stencil "A" cutout. Sits to the left of the ARCRUN
/// wordmark. Replaces the previous bare `■` pink square.

interface Props {
  size?: number;
  className?: string;
  /// Render the wordmark next to the mark. Defaults to true.
  showWordmark?: boolean;
}

export function ArcRunMark({ size = 28, className = "", showWordmark = true }: Props) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        role="img"
        aria-label="ArcRun"
        className="flex-none"
      >
        {/* notched-corner badge in flat pink */}
        <polygon points="0,0 26,0 32,6 32,32 0,32" fill="var(--accent)" />
        {/* stencil 'A' cut out in canvas color */}
        <g fill="var(--canvas)">
          {/* left leg */}
          <polygon points="3,28 8,28 14,9 11,9" />
          {/* right leg */}
          <polygon points="21,9 18,9 24,28 29,28" />
          {/* crossbar with stencil gap */}
          <rect x="8" y="19" width="16" height="3" />
        </g>
        {/* gap in the crossbar to read as stencil */}
        <rect x="14.5" y="19" width="3" height="3" fill="var(--accent)" />
      </svg>
      {showWordmark ? (
        <span
          className="font-stencil text-ink"
          style={{ fontSize: 20, letterSpacing: "0.08em", lineHeight: 1 }}
        >
          ARCRUN
        </span>
      ) : null}
    </span>
  );
}
