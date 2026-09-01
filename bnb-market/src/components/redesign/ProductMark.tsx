interface Props {
  name: "Agon" | "ArcRun";
  size?: number;
  className?: string;
  showWordmark?: boolean;
}

export function ProductMark({ name, size = 28, className = "", showWordmark = true }: Props) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        role="img"
        aria-label={name}
        className="flex-none"
      >
        <polygon points="0,0 26,0 32,6 32,32 0,32" fill="var(--accent)" />
        <g fill="var(--canvas)">
          <polygon points="3,28 8,28 14,9 11,9" />
          <polygon points="21,9 18,9 24,28 29,28" />
          <rect x="8" y="19" width="16" height="3" />
        </g>
        <rect x="14.5" y="19" width="3" height="3" fill="var(--accent)" />
      </svg>
      {showWordmark ? (
        <span
          className="font-stencil text-ink"
          style={{ fontSize: 20, letterSpacing: "0.08em", lineHeight: 1 }}
        >
          {name.toUpperCase()}
        </span>
      ) : null}
    </span>
  );
}

