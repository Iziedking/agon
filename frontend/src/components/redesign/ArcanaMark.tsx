"use client";

/// Flat-vector Arcana Markets wordmark + glyph. No bitmap, no gradient, no
/// glow. The glyph is a 1px-stroke square containing a horizontal line and
/// two stacked dots, reading as a market candle + entry/exit ticks. The
/// wordmark sits next to it in stencil display face. Used on the prediction
/// wait state and the active Arcana branch header so the integration brand
/// is visible the whole time agents are trading.

interface Props {
  /// Pixel height of the glyph; wordmark scales relative to this.
  size?: number;
  /// Show the wordmark to the right of the glyph. Default true.
  showWordmark?: boolean;
  className?: string;
}

export function ArcanaMark({ size = 22, showWordmark = true, className = "" }: Props) {
  const wordmarkSize = Math.round(size * 0.85);
  return (
    <span
      className={`inline-flex items-center gap-2 ${className}`}
      aria-label="Arcana Markets"
      role="img"
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        aria-hidden
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <rect x="2.5" y="2.5" width="19" height="19" />
        <line x1="6" y1="12" x2="18" y2="12" />
        <circle cx="9" cy="8" r="1.2" fill="currentColor" stroke="none" />
        <circle cx="15" cy="16" r="1.2" fill="currentColor" stroke="none" />
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
