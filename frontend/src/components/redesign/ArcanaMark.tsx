"use client";

/// Flat-vector recreation of the Arcana Markets brand mark: blue rounded
/// square with a white diamond outline holding a smaller filled white
/// diamond at its centre. SVG only; no bitmap, no gradient, no glow.
/// Used on the prediction wait state and the active Arcana branch header
/// so the integration brand is visible the whole time agents are trading.
///
/// The wordmark sits to the right in stencil display face. Pass
/// showWordmark=false for icon-only contexts (chips, tight cells).

interface Props {
  /// Pixel height of the glyph; wordmark scales relative to this.
  size?: number;
  /// Show the wordmark to the right of the glyph. Default true.
  showWordmark?: boolean;
  className?: string;
}

const ARCANA_BLUE = "#1E5BFF";

export function ArcanaMark({ size = 22, showWordmark = true, className = "" }: Props) {
  const wordmarkSize = Math.round(size * 0.85);
  return (
    <span
      className={`inline-flex items-center gap-2 ${className}`}
      aria-label="Arcana Markets"
      role="img"
    >
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
        {/* rounded square plate */}
        <rect x="0" y="0" width="32" height="32" rx="7" ry="7" fill={ARCANA_BLUE} />
        {/* outer diamond — white outline */}
        <path
          d="M16 7 L25 16 L16 25 L7 16 Z"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="2.4"
          strokeLinejoin="miter"
        />
        {/* inner diamond — filled white */}
        <path d="M16 12 L20 16 L16 20 L12 16 Z" fill="#FFFFFF" />
      </svg>
      {showWordmark ? (
        <span
          className="font-stencil uppercase leading-none tracking-[-0.01em]"
          style={{ fontSize: wordmarkSize }}
        >
          ARCANA MARKETS
        </span>
      ) : null}
    </span>
  );
}
